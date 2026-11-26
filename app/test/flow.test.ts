/**
 * The app's whole flow against the real Crumena contract on a local chain (anvil, from Foundry):
 * statements come from the contract, are checked line by line here, "signed" by a fake QoreX, relayed, and verified on chain.
 *
 * anvil has no QoreChain precompiles, so the test doubles from contracts/test/mocks are placed at their addresses:
 * they check which key and which bytes, with a stand-in signature of the right size. Real ML-DSA-87 is covered by
 * server/test (QoreX's exact format, verified offline) and server/scripts/testnet-run.ts (the chain's own precompile).
 *
 * Needs `forge build` (contracts/out) and anvil on PATH; skipped otherwise.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CRUMENA_ABI, CRUMENA_BYTECODE } from "../../shared/crumena-abi";
import { NO_RULES, createCrumena, explain, type Crumena, type Pot } from "../src/lib/crumena";
import { toQor } from "../src/lib/format";
import type { Me, Qorex } from "../src/lib/qorex";

const OUT = new URL("../../contracts/out/", import.meta.url);
const ready = existsSync(new URL("MockPqc.sol/MockVerify.json", OUT)) && spawnSync("anvil", ["--version"]).status === 0;

const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const chain = { id: 9800, name: "local", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3d71f8be03e5b8c3",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
] as const;
const [relayerAcct, funderAcct, spenderAcct, shopAcct, otherAcct] = KEYS.map((k) => privateKeyToAccount(k)) as [Acct, Acct, Acct, Acct, Acct];
type Acct = ReturnType<typeof privateKeyToAccount>;
const FUSD = 1_000_000n;

const artifact = (path: string) => JSON.parse(readFileSync(new URL(path, OUT), "utf8")) as { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const pqKey = (a: Address) => {
  let out: Hex[] = [];
  let h = keccak256(toBytes(`mock key ${a}`));
  for (let i = 0; i < 81; i++) out.push((h = keccak256(h)));
  return concat(out); // 81 × 32 = 2592 bytes
};
/** MockSig.sign from contracts/test/mocks/MockPqc.sol: keccak(key ‖ message) repeated to 4627 bytes. */
function mockSign(key: Hex, message: Uint8Array): string {
  const h = toBytes(keccak256(concat([key, toHex(message)])));
  const sig = new Uint8Array(4627).map((_, i) => h[i % 32]!);
  return btoa(String.fromCharCode(...sig));
}

/** A QoreX stand-in: signs exactly what QoreX would, `qorechain-msg-v1|qorechain-diana|` + the statement. */
function fakeQorex(who: { address: Address }, seen: string[]): Qorex {
  return {
    native: {
      capabilities: ["signArbitrary"],
      enable: async () => undefined,
      getKey: async () => ({ algo: "ethsecp256k1", bech32Address: toQor(who.address) }),
      signArbitrary: async (_chain, _signer, data) => {
        seen.push(data);
        return { signatureType: "ml-dsa-87-hybrid", pq: { algorithmId: 1, signature: mockSign(pqKey(who.address), toBytes(`qorechain-msg-v1|qorechain-diana|${data}`)) } };
      },
    },
  };
}
const meOf = (a: { address: Address }): Me => ({ qor: toQor(a.address), evm: a.address, kind: "ethereum" });

describe.skipIf(!ready)("the app against the real contract (local chain)", () => {
  let anvil: ChildProcess;
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
  const wallet = (acct: Acct) => createWalletClient({ chain, account: acct, transport: http(RPC) });
  let crumena: Address;
  let token: Address;
  let app: Crumena;
  const seen: string[] = [];
  let tamper: ((s: string) => string) | undefined;

  /** What the browser's fetch reaches: /rpc goes to the chain, /api/relay sends the call like the relayer does. */
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/rpc")) {
      const r = await fetch(RPC, init);
      if (!tamper) return r;
      const text = tamper(await r.text());
      return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/api/relay")) {
      const { data } = JSON.parse(String(init!.body)) as { data: Hex };
      try {
        await pub.call({ account: relayerAcct.address, to: crumena, data });
      } catch (e) {
          return Response.json({ error: "refused", reason: errorName(e) }, { status: 400 });
      }
      const hash = await wallet(relayerAcct).sendTransaction({ to: crumena, data, gas: 3_000_000n });
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      let potId: string | undefined;
      for (const log of rcpt.logs) {
        try {
          const ev = decodeEventLog({ abi: CRUMENA_ABI, data: log.data, topics: log.topics });
          if (ev.eventName === "PotCreated") potId = String((ev.args as { potId: bigint }).potId);
        } catch {}
      }
      return Response.json({ hash, block: Number(rcpt.blockNumber), potId });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", "9800", "--silent", "--code-size-limit", "50000"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        await pub.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    for (const a of [relayerAcct, funderAcct, spenderAcct, shopAcct, otherAcct]) await test.setBalance({ address: a.address, value: 10n ** 21n });

    // The QoreChain precompiles' test doubles, at their real addresses.
    const status = "0x0000000000000000000000000000000000000a02" as Address;
    await test.setCode({ address: "0x0000000000000000000000000000000000000a01", bytecode: artifact("MockPqc.sol/MockVerify.json").deployedBytecode.object });
    await test.setCode({ address: status, bytecode: artifact("MockPqc.sol/MockKeyStatus.json").deployedBytecode.object });
    const ks = artifact("MockPqc.sol/MockKeyStatus.json");
    for (const a of [funderAcct, spenderAcct, shopAcct, otherAcct]) {
      const h = await wallet(relayerAcct).writeContract({ address: status, abi: ks.abi, functionName: "set", args: [a.address, true, 1, pqKey(a.address), true] });
      await pub.waitForTransactionReceipt({ hash: h });
    }

    const tok = artifact("MockToken.sol/MockToken.json");
    const t1 = await wallet(relayerAcct).deployContract({ abi: tok.abi, bytecode: tok.bytecode.object });
    token = (await pub.waitForTransactionReceipt({ hash: t1 })).contractAddress!;
    const t2 = await wallet(relayerAcct).deployContract({ abi: CRUMENA_ABI, bytecode: CRUMENA_BYTECODE, args: ["qorechain-diana", 9800n] });
    crumena = (await pub.waitForTransactionReceipt({ hash: t2 })).contractAddress!;

    app = createCrumena({ chainId: "qorechain-diana", evmChainId: 9800, crumena, fusd: token, relayer: toQor(relayerAcct.address), fromBlock: 0 }, { base: "http://app.test", fetch: fakeFetch });
  }, 30_000);

  afterAll(() => anvil?.kill());

  const mint = async (to: Address, amount: bigint) => {
    const tok = artifact("MockToken.sol/MockToken.json");
    await pub.waitForTransactionReceipt({ hash: await wallet(relayerAcct).writeContract({ address: token, abi: tok.abi, functionName: "mint", args: [to, amount] }) });
  };
  const fusdOf = async (a: Address) =>
    (await pub.readContract({ address: token, abi: artifact("MockToken.sol/MockToken.json").abi, functionName: "balanceOf", args: [a] })) as bigint;
  const chainNow = async () => (await pub.getBlock()).timestamp;

  let pot: Pot;

  it("creates a pot from the funder's signed statement; the vault matches the one shown before signing", async () => {
    const endsAt = (await chainNow()) + 14n * 86400n;
    const nonce = await app.nonceOf(funderAcct.address);
    const predicted = await app.vaultFor(funderAcct.address, nonce);
    const sent = await app.createPot(fakeQorex(funderAcct, seen), meOf(funderAcct), {
      funder: funderAcct.address,
      recipient: spenderAcct.address,
      token,
      endsAt,
      confirmedOnly: false,
      rules: { maxPerPayment: 50n * FUSD, periodLimit: 0n, periodDays: 0 },
      purpose: "Office fit-out, phase 1",
      payees: [shopAcct.address],
      names: ["Halden Building Supplies"],
    });
    pot = await app.pot(BigInt(sent.potId!));
    expect(pot.vault).toBe(predicted);
    expect(seen.at(-1)).toContain(`Pot address: ${predicted.toLowerCase()}`);
    expect(seen.at(-1)!.split("\n")[0]).toBe("Crumena: create a pot");
    expect((await app.potsOf(spenderAcct.address)).map((p) => p.id)).toEqual([pot.id]);
  });

  it("the spender pays an approved shop; the shop is paid and the pot's balance drops", async () => {
    await mint(pot.vault, 100n * FUSD);
    pot = await app.pot(pot.id);
    expect(pot.balance).toBe(100n * FUSD);
    await app.pay(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, shopAcct.address, 25_500_000n, "PO-1042 materials");
    expect(await fusdOf(shopAcct.address)).toBe(25_500_000n);
    expect(seen.at(-1)).toContain("Amount: 25.5 ");
    expect((await app.pot(pot.id)).balance).toBe(74_500_000n);
  });

  it("the shop confirms its address; a new shop is requested, approved, and paid", async () => {
    await app.confirmPayee(fakeQorex(shopAcct, seen), meOf(shopAcct), pot);
    await app.requestPayee(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, otherAcct.address, "Brightline Electrical");
    let list = await app.payees(pot.id);
    expect(list.find((p) => p.address === shopAcct.address)).toMatchObject({ approved: true, confirmed: true });
    expect(list.find((p) => p.address === otherAcct.address)).toMatchObject({ approved: false, requested: true });

    await app.addPayee(fakeQorex(funderAcct, seen), meOf(funderAcct), pot, otherAcct.address, "Brightline Electrical");
    await app.pay(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, otherAcct.address, 10n * FUSD, "");
    expect(await fusdOf(otherAcct.address)).toBe(10n * FUSD);
    expect(seen.at(-1)).toContain("Memo: -");
  });

  it("refuses an unapproved payee with a plain message from the contract's reason", async () => {
    await expect(app.pay(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, relayerAcct.address, FUSD, "")).rejects.toSatisfy(
      (e) => explain(e) === "That payee isn't approved for this pot.",
    );
  });

  it("won't hand QoreX a statement the server altered", async () => {
    const before = seen.length;
    // The "server" changes the amount in the statement the contract returned (same length, so it still decodes).
    tamper = (body) => body.replace(asciiHex("Amount: 1 "), asciiHex("Amount: 9 "));
    try {
      await expect(app.pay(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, shopAcct.address, FUSD, "")).rejects.toThrow(/didn't match/);
    } finally {
      tamper = undefined;
    }
    expect(seen.length).toBe(before);
  });

  it("refuses to sign with the wrong account before anything reaches QoreX", async () => {
    await expect(app.addPayee(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, relayerAcct.address, "Nope")).rejects.toThrow(/different account/);
  });

  it("the funder sets a weekly limit and freezes the pot; both are enforced", async () => {
    await app.setRules(fakeQorex(funderAcct, seen), meOf(funderAcct), pot, { maxPerPayment: 0n, periodLimit: 12n * FUSD, periodDays: 7 });
    expect(seen.at(-1)).toContain("Limit per period: 12 fUSD every 7 days");
    await app.pay(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, shopAcct.address, 10n * FUSD, "");
    await expect(app.pay(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, shopAcct.address, 3n * FUSD, "")).rejects.toSatisfy(
      (e) => explain(e) === "That's more than is left to spend in this period.",
    );
    expect((await app.periodSpending(pot.id)).spent).toBe(10n * FUSD);

    await app.setFrozen(fakeQorex(funderAcct, seen), meOf(funderAcct), pot, true);
    expect((await app.pot(pot.id)).frozen).toBe(true);
    await expect(app.pay(fakeQorex(spenderAcct, seen), meOf(spenderAcct), pot, shopAcct.address, FUSD, "")).rejects.toSatisfy((e) => explain(e).includes("frozen"));
    await app.setFrozen(fakeQorex(funderAcct, seen), meOf(funderAcct), pot, false);
  });

  it("the funder extends, then releases the rest to the spender", async () => {
    await app.extend(fakeQorex(funderAcct, seen), meOf(funderAcct), pot, pot.endsAt + 86400n);
    expect((await app.pot(pot.id)).endsAt).toBe(pot.endsAt + 86400n);
    const before = await fusdOf(spenderAcct.address);
    await app.release(fakeQorex(funderAcct, seen), meOf(funderAcct), pot);
    expect((await fusdOf(spenderAcct.address)) - before).toBe(54_500_000n);
    expect((await app.pot(pot.id)).closed).toBe(true);
  });

  it("after a pot's end date anyone can send the rest back to the funder, unsigned", async () => {
    const sent = await app.createPot(fakeQorex(funderAcct, seen), meOf(funderAcct), {
      funder: funderAcct.address,
      recipient: spenderAcct.address,
      token,
      endsAt: (await chainNow()) + 3600n,
      confirmedOnly: true,
      rules: NO_RULES,
      purpose: "Short pot",
      payees: [shopAcct.address],
      names: ["Halden Building Supplies"],
    });
    const short = await app.pot(BigInt(sent.potId!));
    await mint(short.vault, 5n * FUSD);
    await expect(app.reclaim(short)).rejects.toSatisfy((e) => explain(e).includes("only after the end date"));
    await test.increaseTime({ seconds: 3601 });
    await test.mine({ blocks: 1 });
    const before = await fusdOf(funderAcct.address);
    await app.reclaim(short);
    expect((await fusdOf(funderAcct.address)) - before).toBe(5n * FUSD);
  });
});

function errorName(e: unknown): string | undefined {
  const err = e as { walk?: (fn: (x: unknown) => boolean) => unknown };
  const data = (err.walk?.((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | undefined)?.data;
  if (!data || data.length < 10) return undefined;
  const sel = data.slice(0, 10);
  for (const item of CRUMENA_ABI) {
    if (item.type !== "error") continue;
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
    if (keccak256(toBytes(sig)).slice(0, 10) === sel) return item.name;
  }
  return undefined;
}
const asciiHex = (s: string) => Buffer.from(s).toString("hex");

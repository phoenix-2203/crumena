/**
 * The activity index against the real contract on a local chain (anvil): a pot is created, paid into,
 * and pays out; the index must list each step, once, newest first. Needs `forge build` and anvil.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { concat, createPublicClient, createTestClient, createWalletClient, encodeFunctionData, http, keccak256, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CRUMENA_ABI, CRUMENA_BYTECODE } from "../../shared/crumena-abi";
import { createActivityIndex } from "../src/activity";
import { FUSD } from "../src/chain";

const OUT = new URL("../../contracts/out/", import.meta.url);
const ready = existsSync(new URL("MockPqc.sol/MockVerify.json", OUT)) && spawnSync("anvil", ["--version"]).status === 0;
const PORT = 19545 + Math.floor(Math.random() * 500);
const RPC = `http://127.0.0.1:${PORT}`;
const chain = { id: 9800, name: "local", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const art = (p: string) => JSON.parse(readFileSync(new URL(p, OUT), "utf8")) as { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const keys = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3d71f8be03e5b8c3",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;
const [relayer, funder, spender, shop] = keys.map((k) => privateKeyToAccount(k)) as [ReturnType<typeof privateKeyToAccount>, ...ReturnType<typeof privateKeyToAccount>[]] & ReturnType<typeof privateKeyToAccount>[];
const pqKey = (a: Address) => {
  const out: Hex[] = [];
  let h = keccak256(toBytes(`key ${a}`));
  for (let i = 0; i < 81; i++) out.push((h = keccak256(h)));
  return concat(out);
};
const mockSig = (key: Hex, statement: string) => {
  const h = toBytes(keccak256(concat([key, toHex(toBytes(`qorechain-msg-v1|qorechain-diana|${statement}`))])));
  return toHex(new Uint8Array(4627).map((_, i) => h[i % 32]!));
};

let anvil: ChildProcess;
const pub = createPublicClient({ chain, transport: http(RPC) });
const testClient = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const wallet = createWalletClient({ chain, account: relayer, transport: http(RPC) });
let crumena: Address;
let fromBlock: bigint;

async function send(to: Address, data: Hex) {
  const r = await pub.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to, data, gas: 3_000_000n }) });
  if (r.status !== "success") {
    const reason = await pub.call({ account: relayer!.address, to, data }).then(() => "?", (e: Error) => e.message.split("\n")[0]);
    throw new Error(`reverted: ${reason}`);
  }
}
const read = <T>(fn: string, args: unknown[]) => pub.readContract({ address: crumena, abi: CRUMENA_ABI, functionName: fn as never, args: args as never }) as Promise<T>;

beforeAll(async () => {
  if (!ready) return;
  anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", "9800", "--silent", "--code-size-limit", "50000"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const status = "0x0000000000000000000000000000000000000a02" as Address;
  await testClient.setCode({ address: "0x0000000000000000000000000000000000000a01", bytecode: art("MockPqc.sol/MockVerify.json").deployedBytecode.object });
  await testClient.setCode({ address: status, bytecode: art("MockPqc.sol/MockKeyStatus.json").deployedBytecode.object });
  await testClient.setCode({ address: FUSD, bytecode: art("MockToken.sol/MockToken.json").deployedBytecode.object });
  await send(FUSD, encodeFunctionData({ abi: art("MockToken.sol/MockToken.json").abi, functionName: "setSymbol", args: ["fUSD"] })); // code only: storage starts empty
  for (const a of [funder, spender]) {
    await send(status, encodeFunctionData({ abi: art("MockPqc.sol/MockKeyStatus.json").abi, functionName: "set", args: [a!.address, true, 1, pqKey(a!.address), true] }));
  }
  const h = await wallet.deployContract({ abi: CRUMENA_ABI, bytecode: CRUMENA_BYTECODE, args: ["qorechain-diana", 9800n] });
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  crumena = rc.contractAddress!;
  fromBlock = rc.blockNumber;
}, 30_000);
afterAll(() => anvil?.kill());

it.skipIf(!ready)("lists a pot's history once each, newest first: created, approved, deposit, paid", async () => {
  const p = {
    funder: funder!.address,
    recipient: spender!.address,
    token: FUSD,
    endsAt: BigInt(Math.floor(Date.now() / 1000) + 86_400),
    confirmedOnly: false,
    rules: { maxPerPayment: 0n, periodLimit: 0n, periodDays: 0 },
    purpose: "School fees",
    payees: [shop!.address],
    names: ["Approved vendor"],
    limits: [0n],
  };
  const until = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const st = await read<string>("createStatement", [p, 0n, until]);
  await send(crumena, encodeFunctionData({ abi: CRUMENA_ABI, functionName: "createPot", args: [p, { nonce: 0n, validUntil: until, signature: mockSig(pqKey(funder!.address), st) }] }));
  const vault = (await read<{ vault: Address }>("potInfo", [1n])).vault;
  await send(FUSD, encodeFunctionData({ abi: art("MockToken.sol/MockToken.json").abi, functionName: "mint", args: [relayer!.address, 40_000_000n] }));
  await send(FUSD, encodeFunctionData({ abi: art("MockToken.sol/MockToken.json").abi, functionName: "transfer", args: [vault, 40_000_000n] }));
  const pst = await read<string>("payStatement", [1n, shop!.address, 15_000_000n, "Term 1", spender!.address, 0n, until]);
  await send(
    crumena,
    encodeFunctionData({
      abi: CRUMENA_ABI,
      functionName: "pay",
      args: [1n, shop!.address, 15_000_000n, "Term 1", spender!.address, { nonce: 0n, validUntil: until, signature: mockSig(pqKey(spender!.address), pst) }],
    }),
  );

  const idx = createActivityIndex({ crumena, fromBlock, client: pub as never });
  await idx.refresh();
  await idx.refresh(); // a second pass adds nothing
  const kinds = idx.of("1").map((e) => e.kind);
  expect(kinds).toEqual(["Paid", "Deposit", "PayeeApproved", "PotCreated"]);
  const paid = idx.of("1")[0]!;
  expect(paid.args).toMatchObject({ amount: "15000000", memo: "Term 1" });
  expect(idx.of("1")[1]!.args).toMatchObject({ from: relayer!.address, amount: "40000000" });
  expect(idx.of("2")).toEqual([]);
});

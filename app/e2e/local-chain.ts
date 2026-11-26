/**
 * The whole app on a local chain, for click-through checks and screenshots without QoreChain testnet:
 *   pnpm --filter @crumena/app build && node --import tsx app/e2e/local-chain.ts
 * then open http://127.0.0.1:8799.
 *
 * anvil runs the real Crumena contract. QoreChain's precompiles are stand-ins: pqcKeyStatus is a key
 * registry (the demo people's real ML-DSA-87 public keys go in it), and pqcVerify accepts any signature,
 * so here only the browser's own "Verify" check judges signatures. fUSD is a 6-decimal test token at
 * fUSD's real address. The server endpoints mirror server/src/main.ts.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { pqKeyFromSeed } from "@qorechain/qoresign";
import { Hono } from "hono";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, decodeEventLog, encodeFunctionData, http, toHex, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CRUMENA_ABI, CRUMENA_BYTECODE } from "../../shared/crumena-abi";
import { createActivityIndex } from "../../server/src/activity";
import { toQor } from "../src/lib/format";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
const PORT = Number(process.env.PORT ?? 8799);
const RPC_PORT = 18645;
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const chain = { id: 9800, name: "local", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const OUT = new URL("../../contracts/out/", import.meta.url);
const art = (p: string) => JSON.parse(readFileSync(new URL(p, OUT), "utf8")) as { abi: Abi; deployedBytecode: { object: Hex } };

spawn("anvil", ["--port", String(RPC_PORT), "--chain-id", "9800", "--silent", "--code-size-limit", "50000"], { stdio: "ignore" });
const pub = createPublicClient({ chain, transport: http(RPC) });
for (let i = 0; i < 50; i++) {
  try {
    await pub.getBlockNumber();
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
const testClient = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const relayer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const wallet = createWalletClient({ chain, account: relayer, transport: http(RPC) });
const send = async (to: Address, data: Hex) => {
  const r = await pub.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to, data, gas: 3_000_000n }) });
  return r;
};

const STATUS = "0x0000000000000000000000000000000000000a02" as const;
await testClient.setCode({ address: STATUS, bytecode: art("MockPqc.sol/MockKeyStatus.json").deployedBytecode.object });
await testClient.setCode({ address: "0x0000000000000000000000000000000000000a01", bytecode: "0x600160005260206000f3" });
await testClient.setCode({ address: FUSD, bytecode: art("MockToken.sol/MockToken.json").deployedBytecode.object });
const tok = art("MockToken.sol/MockToken.json").abi;
await send(FUSD, encodeFunctionData({ abi: tok, functionName: "setSymbol", args: ["fUSD"] }));
const dep = await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: CRUMENA_ABI, bytecode: CRUMENA_BYTECODE, args: ["qorechain-diana", 9800n] }) });
const CRUMENA = dep.contractAddress!;
const activity = createActivityIndex({ crumena: CRUMENA, fromBlock: dep.blockNumber, client: pub as never });
activity.start(1500);
const demoFunders = new Set<string>();

const app = new Hono();
app.get("/api/config", (c) => c.json({ chainId: "qorechain-diana", evmChainId: 9800, crumena: CRUMENA, fusd: FUSD, relayer: toQor(relayer.address), fromBlock: Number(dep.blockNumber) }));
app.post("/api/relay", async (c) => {
  const { data } = (await c.req.json()) as { data: Hex };
  try {
    await pub.call({ account: relayer.address, to: CRUMENA, data });
  } catch (e) {
    const err = e as { walk?: (f: (x: unknown) => boolean) => { data?: Hex } | undefined };
    const raw = err.walk?.((x) => typeof (x as { data?: unknown }).data === "string")?.data;
    let reason: string | undefined;
    try {
      reason = raw ? (await import("viem")).decodeErrorResult({ abi: CRUMENA_ABI, data: raw }).errorName : undefined;
    } catch {}
    return c.json({ error: "refused", reason }, 400);
  }
  const r = await send(CRUMENA, data);
  let potId: string | undefined;
  for (const l of r.logs) {
    try {
      const ev = decodeEventLog({ abi: CRUMENA_ABI, data: l.data, topics: l.topics });
      if (ev.eventName === "PotCreated") potId = String((ev.args as { potId: bigint }).potId);
    } catch {}
  }
  return c.json({ hash: r.transactionHash, block: Number(r.blockNumber), potId });
});
app.post("/rpc", async (c) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: await c.req.text() });
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
});
app.get("/api/pot/:id/activity", async (c) => {
  await activity.refresh();
  return c.json({ syncedTo: Number(activity.syncedTo), entries: activity.of(c.req.param("id")) });
});
app.get("/api/qorechain-tx/:hash", (c) => c.json({ hash: c.req.param("hash").slice(2).toUpperCase() }));
app.post("/api/demo/start", async (c) => {
  const personas = [];
  for (const role of ["funder", "spender", "shop"] as const) {
    const pk = generatePrivateKey();
    const a = privateKeyToAccount(pk);
    const pq = pqKeyFromSeed(crypto.getRandomValues(new Uint8Array(32)));
    await send(STATUS, encodeFunctionData({ abi: art("MockPqc.sol/MockKeyStatus.json").abi, functionName: "set", args: [a.address, true, 1, toHex(pq.publicKey), true] }));
    if (role === "funder") demoFunders.add(a.address.toLowerCase());
    personas.push({ role, qor: toQor(a.address), evm: a.address, privateKey: pk, pqSecretKey: Buffer.from(pq.secretKey).toString("base64") });
  }
  return c.json({ personas });
});
app.post("/api/demo/fund/:id", async (c) => {
  const pot = (await pub.readContract({ address: CRUMENA, abi: CRUMENA_ABI, functionName: "potInfo", args: [BigInt(c.req.param("id"))] })) as { vault: Address };
  const r = await send(FUSD, encodeFunctionData({ abi: tok, functionName: "mint", args: [pot.vault, 50_000_000n] }));
  return c.json({ tx: r.transactionHash });
});
app.use("/*", serveStatic({ root: new URL("../dist", import.meta.url).pathname.replace(process.cwd() + "/", "") }));
serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
console.log(`Crumena on a local chain: http://127.0.0.1:${PORT}  (contract ${CRUMENA})`);

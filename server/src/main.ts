/**
 * Crumena's server: the relayer, plus read-only proxies the browser needs (the
 * chain's REST API sends no CORS headers), and the built web app.
 *
 *   RELAYER_MNEMONIC="…" CRUMENA_ADDRESS=0x… pnpm --filter @crumena/server start
 *
 * RELAYER_MNEMONIC is a throwaway testnet account that only pays gas. It never
 * holds anyone's money, and its EVM window only reaches the Crumena contract.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import { CHAIN_ID, EVM_CHAIN_ID, EVM_RPC, FUSD, REST, bankBalance, cosmosHashOf, hasPqcKey, publicClient, registerPqcKey, useAccount } from "./chain";
import { createActivityIndex } from "./activity";
import { createDemo } from "./demo";
import { createDepositIndex } from "./deposits";
import { RelayError, createRelayer } from "./relay";

const PORT = Number(process.env.PORT ?? 8790);
const deployment = (() => {
  const file = new URL("../../deployments/testnet.json", import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { Crumena: string; block?: number }) : undefined;
})();
const CRUMENA = getAddress(process.env.CRUMENA_ADDRESS ?? deployment?.Crumena ?? "0x0000000000000000000000000000000000000000");
if (/^0x0{40}$/.test(CRUMENA)) throw new Error("No Crumena address: deployments/testnet.json is missing (update the code) or set CRUMENA_ADDRESS.");
const mnemonic = process.env.RELAYER_MNEMONIC?.trim();
if (!mnemonic) throw new Error("Set RELAYER_MNEMONIC to a throwaway testnet phrase (in server/.env).");

const account = await useAccount(mnemonic, { maxQor: 200n });
const relayer = createRelayer(account, CRUMENA);
console.log(`Crumena relayer ${account.qor} (${account.evm}) for ${CRUMENA} on ${CHAIN_ID}`);

// Bank-lane deposits into pots, from the deployment onwards.
const deployedAt = deployment?.block
  ? new Date(Number((await publicClient.getBlock({ blockNumber: BigInt(deployment.block) })).timestamp) * 1000)
  : new Date(Date.now() - 7 * 86_400_000);
const deposits = createDepositIndex({ since: deployedAt, log: console.log });
deposits.start();
const activity = createActivityIndex({ crumena: CRUMENA, fromBlock: BigInt(deployment?.block ?? 0), log: console.log });
activity.start();

// The relayer's own ML-DSA-87 key must be registered before it can sign anything (QoreChain requires the
// hybrid signature once a key exists, and EVM windows need it). A fresh relayer registers it as soon as it
// has gas for the fee; until then the relay and the demo answer "not ready".
let relayerReady = false;
void (async () => {
  for (;;) {
    try {
      if (!(await hasPqcKey(account.qor))) {
        const tx = await relayer.exclusive(() => registerPqcKey(account.unified));
        console.log(`registered the relayer's ML-DSA-87 key: ${tx}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      relayerReady = true;
      return;
    } catch (e) {
      console.log(`relayer key not registered yet (fund ${account.qor} with test QOR): ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
})();
const notReady = { error: "The relayer is still setting up (it needs test QOR for its first transaction). Try again in a minute." };

const demo = createDemo({ relayer: account, crumena: CRUMENA, exclusive: relayer.exclusive });
const clientIp = (h: (n: string) => string | undefined) => h("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

const app = new Hono();

app.get("/api/config", (c) =>
  c.json({ chainId: CHAIN_ID, evmChainId: EVM_CHAIN_ID, crumena: CRUMENA, fusd: FUSD, relayer: account.qor, fromBlock: deployment?.block ?? 0 }),
);

app.get("/api/health", async (c) => {
  const [w, uqor] = await Promise.all([account.window().catch(() => null), bankBalance(account.qor, "uqor").catch(() => -1n)]);
  return c.json({
    relayer: account.qor,
    gasQor: Number(uqor) / 1e6,
    ready: relayerReady,
    window: w && { live: w.live, remainingTxs: w.remainingTxs.toString(), remainingBlocks: w.remainingBlocks.toString(), allowedTargets: w.allowedTargets },
  });
});

// Small per-address rate limit: relaying spends the relayer's gas.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

app.post("/api/relay", async (c) => {
  if (!relayerReady) return c.json(notReady, 503);
  const ip = clientIp((n) => c.req.header(n));
  if (limited(ip)) return c.json({ error: "Too many requests. Wait a minute." }, 429);
  const body = (await c.req.json().catch(() => null)) as { data?: string } | null;
  if (!body?.data) return c.json({ error: "Send { data: 0x… }." }, 400);
  try {
    return c.json(await relayer.relay(body.data as Hex));
  } catch (e) {
    if (e instanceof RelayError) return c.json({ error: e.message, reason: e.reason }, e.status);
    console.error(e);
    return c.json({ error: "The relayer couldn't send it. Try again in a moment." }, 503);
  }
});

// Bank-lane deposits into a pot's address (ERC-20 transfers the browser reads from logs itself).
app.get("/api/deposits/:vault", (c) => {
  try {
    return c.json(deposits.of(c.req.param("vault")));
  } catch {
    return c.json({ error: "Not an address." }, 400);
  }
});

// A pot's history, newest first: Crumena's events, fUSD transfers in, and bank-lane deposits.
app.get("/api/pot/:id/activity", (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,9}$/.test(id)) return c.json({ error: "Not a pot number." }, 400);
  const entries: unknown[] = [...activity.of(id)];
  const created = activity.of(id).find((e) => e.kind === "PotCreated");
  if (created) {
    for (const d of deposits.of(String(created.args.vault))) {
      entries.push({ kind: "BankDeposit", potId: id, block: d.height, time: Math.floor(Date.parse(d.time) / 1000), tx: d.tx, logIndex: 0, args: { from: d.from, amount: d.amount } });
    }
  }
  (entries as { block: number; logIndex: number }[]).sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
  return c.json({ syncedTo: Number(activity.syncedTo), entries });
});

// The QoreChain hash of an EVM transaction: what the explorer links by.
const hashCache = new Map<string, string>();
app.get("/api/qorechain-tx/:hash", async (c) => {
  const h = c.req.param("hash").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(h)) return c.json({ error: "Not a transaction hash." }, 400);
  const known = hashCache.get(h) ?? (await cosmosHashOf(h));
  if (!known) return c.json({ error: "Not found yet." }, 404);
  hashCache.set(h, known);
  return c.json({ hash: known });
});

// The two-minute demo: three throwaway testnet people with registered ML-DSA-87 keys.
app.post("/api/demo/start", async (c) => {
  if (!relayerReady) return c.json(notReady, 503);
  const refused = demo.allow(clientIp((n) => c.req.header(n)));
  if (refused) return c.json({ error: refused }, 429);
  try {
    return c.json({ personas: await demo.start() });
  } catch (e) {
    console.error(e);
    return c.json({ error: "Couldn't set up the demo people. Try again in a moment." }, 503);
  }
});
app.post("/api/demo/fund/:potId", async (c) => {
  if (!/^\d{1,9}$/.test(c.req.param("potId"))) return c.json({ error: "Not a pot number." }, 400);
  try {
    return c.json({ tx: await demo.fund(BigInt(c.req.param("potId"))) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Read-only EVM JSON-RPC for the browser: reads and receipts, nothing that sends.
const READ_METHODS = new Set([
  "eth_call",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getBalance",
]);
app.post("/rpc", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { method?: string } | { method?: string }[] | null;
  const calls = Array.isArray(body) ? body : [body];
  if (!body || calls.length > 20 || calls.some((x) => !x?.method || !READ_METHODS.has(x.method))) return c.json({ error: "read-only RPC" }, 400);
  const r = await fetch(EVM_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
});

// Read-only REST for the browser: post-quantum key status, balances, transactions.
const READ_PATHS = [/^\/qorechain\/pqc\/v1\/account\/qor1[a-z0-9]{38}$/, /^\/cosmos\/bank\/v1beta1\/balances\/qor1[a-z0-9]{38}(\/by_denom)?$/, /^\/cosmos\/tx\/v1beta1\/txs\/[0-9A-F]{64}$/, /^\/cosmos\/auth\/v1beta1\/accounts\/qor1[a-z0-9]{38}$/];
app.get("/lcd/*", async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.slice("/lcd".length);
  if (!READ_PATHS.some((p) => p.test(path))) return c.json({ error: "not an allowed read" }, 400);
  const r = await fetch(`${REST}${path}${url.search}`);
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
});

// The web app, when built.
if (existsSync(new URL("../../app/dist", import.meta.url))) {
  app.use("/*", serveStatic({ root: "../app/dist" }));
  app.get("*", serveStatic({ path: "../app/dist/index.html" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
console.log(`listening on http://127.0.0.1:${PORT}`);

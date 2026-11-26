/**
 * Earmark's server: the relayer, plus read-only proxies the browser needs (the
 * chain's REST API sends no CORS headers), and the built web app.
 *
 *   RELAYER_MNEMONIC="…" EARMARK_ADDRESS=0x… pnpm --filter @earmark/server start
 *
 * RELAYER_MNEMONIC is a throwaway testnet account that only pays gas. It never
 * holds anyone's money, and its EVM window only reaches the Earmark contract.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import { CHAIN_ID, EVM_CHAIN_ID, EVM_RPC, FUSD, REST, bankBalance, useAccount } from "./chain";
import { RelayError, createRelayer } from "./relay";

const PORT = Number(process.env.PORT ?? 8790);
const deployment = (() => {
  const file = new URL("../../deployments/testnet.json", import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { Earmark: string; block?: number }) : undefined;
})();
const EARMARK = getAddress(process.env.EARMARK_ADDRESS ?? deployment?.Earmark ?? "0x0000000000000000000000000000000000000000");
const mnemonic = process.env.RELAYER_MNEMONIC?.trim();
if (!mnemonic) throw new Error("Set RELAYER_MNEMONIC to a throwaway testnet phrase (in server/.env).");

const account = await useAccount(mnemonic, { maxQor: 200n });
const relayer = createRelayer(account, EARMARK);
console.log(`Earmark relayer ${account.qor} (${account.evm}) for ${EARMARK} on ${CHAIN_ID}`);

const app = new Hono();

app.get("/api/config", (c) =>
  c.json({ chainId: CHAIN_ID, evmChainId: EVM_CHAIN_ID, earmark: EARMARK, fusd: FUSD, relayer: account.qor, fromBlock: deployment?.block ?? 0 }),
);

app.get("/api/health", async (c) => {
  const [w, uqor] = await Promise.all([account.window().catch(() => null), bankBalance(account.qor, "uqor").catch(() => -1n)]);
  return c.json({
    relayer: account.qor,
    gasQor: Number(uqor) / 1e6,
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
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
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

// Read-only EVM JSON-RPC for the browser: reads and receipts, nothing that sends.
const READ_METHODS = new Set(["eth_call", "eth_chainId", "eth_blockNumber", "eth_getLogs", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getCode", "eth_getBalance"]);
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

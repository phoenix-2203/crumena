/**
 * Each pot's history, for the app's timeline and receipts: Crumena's events, plus fUSD transfers
 * into each pot's address. The EVM RPC answers at most 10,000 blocks per log query, so the server
 * keeps this index (from the deployment block on) instead of every browser re-reading the chain.
 */
import { decodeEventLog, getAddress, parseAbiItem, type Address, type Hex, type Log } from "viem";
import { CRUMENA_ABI } from "../../shared/crumena-abi";
import { FUSD, publicClient } from "./chain";

export interface Entry {
  kind: string; // the event name, or "Deposit" for an fUSD transfer in
  potId: string;
  block: number;
  time: number; // unix seconds
  tx: Hex;
  logIndex: number;
  args: Record<string, string | boolean>;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SPAN = 9_999n;

const plain = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v)])) as Record<string, string | boolean>;

export function createActivityIndex(opts: { crumena: Address; fromBlock: bigint; client?: typeof publicClient; log?: (s: string) => void }) {
  const client = opts.client ?? publicClient;
  const log = opts.log ?? (() => {});
  const byPot = new Map<string, Entry[]>();
  const vaults = new Map<string, string>(); // vault (checksummed) -> potId
  const blockTime = new Map<bigint, number>();
  let next = opts.fromBlock;
  let running = false;

  async function timeOf(block: bigint): Promise<number> {
    const known = blockTime.get(block);
    if (known !== undefined) return known;
    const t = Number((await client.getBlock({ blockNumber: block })).timestamp);
    blockTime.set(block, t);
    return t;
  }

  async function push(potId: string, kind: string, l: Log, args: Record<string, unknown>) {
    const list = byPot.get(potId) ?? [];
    if (list.some((e) => e.tx === l.transactionHash && e.logIndex === l.logIndex)) return;
    list.push({ kind, potId, block: Number(l.blockNumber), time: await timeOf(l.blockNumber!), tx: l.transactionHash!, logIndex: l.logIndex!, args: plain(args) });
    list.sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
    byPot.set(potId, list);
  }

  async function scan(from: bigint, to: bigint) {
    const logs = await client.getLogs({ address: opts.crumena, fromBlock: from, toBlock: to });
    for (const l of logs) {
      let ev;
      try {
        ev = decodeEventLog({ abi: CRUMENA_ABI, data: l.data, topics: l.topics });
      } catch {
        continue;
      }
      const args = ev.args as Record<string, unknown>;
      if (!("potId" in args)) continue; // Signed(signer, nonce) belongs to no pot
      const potId = String(args.potId);
      if (ev.eventName === "PotCreated") vaults.set(getAddress(args.vault as string), potId);
      await push(potId, ev.eventName, l, args);
    }
    if (vaults.size === 0) return;
    const all = [...vaults.keys()] as Address[];
    for (let i = 0; i < all.length; i += 50) {
      const transfers = await client.getLogs({
        address: FUSD,
        event: TRANSFER,
        args: { to: all.slice(i, i + 50) },
        fromBlock: from,
        toBlock: to,
      });
      for (const t of transfers) {
        const potId = vaults.get(getAddress(t.args.to!));
        if (potId) await push(potId, "Deposit", t, { from: t.args.from, amount: t.args.value });
      }
    }
  }

  /** Reads everything new, 10,000 blocks at a time. */
  async function refresh(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const head = await client.getBlockNumber({ cacheTime: 0 });
      while (next <= head) {
        const to = next + SPAN > head ? head : next + SPAN;
        await scan(next, to);
        next = to + 1n;
      }
    } finally {
      running = false;
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    refresh,
    start(everyMs = 6_000) {
      const tick = () => refresh().catch((e) => log(`activity index: ${(e as Error).message}`));
      void tick();
      timer = setInterval(tick, everyMs);
    },
    stop: () => timer && clearInterval(timer),
    of: (potId: string): Entry[] => byPot.get(potId) ?? [],
    get syncedTo() {
      return next - 1n;
    },
  };
}

/**
 * Who paid into which pot from the bank lane.
 *
 * A pot's vault receives fUSD two ways: an ERC-20 transfer (an EVM log the browser reads itself),
 * or MsgConvertCoin from someone's bank balance. The second leaves no EVM log and no event naming
 * the receiver, so this keeps a small index of every MsgConvertCoin on the chain, newest first,
 * read from the REST API's decoded transactions. Testnet volume is small (hundreds in total).
 */
import { getAddress } from "viem";
import { CONVERT_COIN_TYPE_URL, FUSD_DENOM, rest } from "./chain";

export interface Deposit {
  from: string; // qor1… that converted it
  amount: string; // base units
  tx: string; // QoreChain tx hash
  time: string; // ISO
  height: number;
}

interface TxsPage {
  tx_responses?: {
    txhash: string;
    height: string;
    timestamp: string;
    code: number;
    tx: { body: { messages: { "@type": string; coin?: { denom: string; amount: string }; receiver?: string; sender?: string }[] } };
  }[];
}

export function createDepositIndex(opts: { since: Date; log?: (s: string) => void }) {
  const byVault = new Map<string, Deposit[]>();
  const seen = new Set<string>();
  const log = opts.log ?? (() => {});
  const query = encodeURIComponent(`message.action='${CONVERT_COIN_TYPE_URL}'`);

  function add(t: NonNullable<TxsPage["tx_responses"]>[number]) {
    if (t.code !== 0 || seen.has(t.txhash)) return;
    seen.add(t.txhash);
    for (const m of t.tx.body.messages) {
      if (m["@type"] !== CONVERT_COIN_TYPE_URL || m.coin?.denom !== FUSD_DENOM || !m.receiver || !m.sender) continue;
      let vault: string;
      try {
        vault = getAddress(m.receiver);
      } catch {
        continue;
      }
      const list = byVault.get(vault) ?? [];
      list.push({ from: m.sender, amount: m.coin.amount, tx: t.txhash, time: t.timestamp, height: Number(t.height) });
      list.sort((a, b) => b.height - a.height);
      byVault.set(vault, list);
    }
  }

  /** Reads pages newest first until it reaches transactions it has seen, or older than `since`. */
  async function refresh(): Promise<void> {
    for (let page = 1; page <= 50; page++) {
      const r = await rest<TxsPage>(`/cosmos/tx/v1beta1/txs?query=${query}&order_by=ORDER_BY_DESC&limit=50&page=${page}`);
      const txs = r.tx_responses ?? [];
      let reachedKnown = false;
      for (const t of txs) {
        if (seen.has(t.txhash) || new Date(t.timestamp) < opts.since) {
          reachedKnown = true;
          continue;
        }
        add(t);
      }
      if (reachedKnown || txs.length < 50) return;
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    refresh,
    start(everyMs = 20_000) {
      const tick = () => refresh().catch((e) => log(`deposit index: ${(e as Error).message}`));
      void tick();
      timer = setInterval(tick, everyMs);
    },
    stop: () => timer && clearInterval(timer),
    of: (vault: string): Deposit[] => byVault.get(getAddress(vault)) ?? [],
    /** For tests. */
    add,
  };
}

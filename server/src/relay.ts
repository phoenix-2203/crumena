/**
 * The relayer. People sign Crumena actions in QoreX (post-quantum, no gas, no EVM
 * window of their own); the relayer sends them. It can't change an action: the
 * contract checks every signature itself. What the relayer guards is its own gas:
 *
 * - it only sends calls to the Crumena contract, and only the functions people sign;
 * - it simulates each call first and refuses what would revert;
 * - it sends from an EVM window scoped to the Crumena contract alone, a limited
 *   number of transactions and blocks, and no value: its key can't be used for
 *   anything else on the EVM, even if the server is compromised;
 * - it sends one transaction at a time, and the same call only once.
 */
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, decodeEventLog, decodeFunctionData, type Hex } from "viem";
import { CRUMENA_ABI } from "../../shared/crumena-abi";
import { explainError } from "../../shared/errors";
import { MAX_FEE_PER_GAS, PRIORITY_FEE, publicClient, type Account } from "./chain";

/** The functions the relayer sends. Each is authorised inside the contract by a signature (reclaim needs none: its money only goes to the funder). */
export const RELAYED = ["createPot", "pay", "addPayee", "removePayee", "requestPayee", "confirmPayee", "extend", "setRules", "setFrozen", "release", "reclaim"] as const;
export type Relayed = (typeof RELAYED)[number];

const WINDOW_TXS = 40;
const WINDOW_BLOCKS = 1800;
const GAS_PER_TX = 3_000_000n;

export interface RelayResult {
  hash: Hex;
  block: number;
  fn: Relayed;
  potId?: string;
}

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 503,
    readonly reason?: string,
  ) {
    super(message);
  }
}

export function createRelayer(account: Account, crumena: Hex, log: (s: string) => void = console.log) {
  let queue: Promise<unknown> = Promise.resolve();
  const recent = new Map<string, { at: number; result: Promise<RelayResult> }>();

  /** Checks the calldata is a Crumena function the relayer sends, and which. */
  function parse(data: Hex): Relayed {
    let fn: string;
    try {
      fn = decodeFunctionData({ abi: CRUMENA_ABI, data }).functionName;
    } catch {
      throw new RelayError("That isn't a call to Crumena.", 400);
    }
    if (!(RELAYED as readonly string[]).includes(fn)) throw new RelayError(`The relayer doesn't send ${fn}.`, 400);
    return fn as Relayed;
  }

  /** Runs the call against the latest block; throws the contract's reason, in words, if it would revert. */
  async function simulate(data: Hex): Promise<bigint> {
    try {
      const gas = await publicClient.estimateGas({ account: account.evm, to: crumena, data });
      return (gas * 13n) / 10n;
    } catch (e) {
      const reason = revertName(e);
      throw new RelayError(explainError(reason), 400, reason);
    }
  }

  /** A window that admits one more call to Crumena, opening a new one when needed. */
  async function ensureWindow() {
    const w = await account.window().catch(() => null);
    const scoped = w?.allowedTargets.length === 1 && w.allowedTargets[0]!.toLowerCase() === crumena.toLowerCase() && !w.nativeOnly;
    const perTx = (GAS_PER_TX * MAX_FEE_PER_GAS + 999_999_999_999n) / 1_000_000_000_000n;
    if (w?.live && scoped && w.remainingTxs >= 1n && w.remainingBlocks > 5n && w.remainingValue >= perTx) return;
    const opened = await account.openWindow([crumena], WINDOW_TXS, GAS_PER_TX, WINDOW_BLOCKS);
    log(`opened an EVM window scoped to ${crumena}: ${WINDOW_TXS} txs, ${WINDOW_BLOCKS} blocks (${opened.transactionHash})`);
    await new Promise((r) => setTimeout(r, 2500));
  }

  async function send(data: Hex, fn: Relayed): Promise<RelayResult> {
    await ensureWindow();
    const gas = await simulate(data); // again: the chain may have moved while we waited
    const hash = await account.wallet.sendTransaction({
      account: account.wallet.account!,
      chain: account.wallet.chain,
      to: crumena,
      data,
      gas: gas > GAS_PER_TX ? GAS_PER_TX : gas,
      maxFeePerGas: MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: PRIORITY_FEE,
    });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (rcpt.status !== "success") throw new RelayError(`The transaction reverted on chain (${hash}).`, 409);
    let potId: string | undefined;
    for (const l of rcpt.logs) {
      try {
        const ev = decodeEventLog({ abi: CRUMENA_ABI, data: l.data, topics: l.topics });
        if (ev.eventName === "PotCreated") potId = (ev.args as { potId: bigint }).potId.toString();
      } catch {
        /* another contract's log */
      }
    }
    log(`${fn}: ${hash} (block ${rcpt.blockNumber})`);
    return { hash, block: Number(rcpt.blockNumber), fn, potId };
  }

  /** Validates, simulates, then queues the call; the same calldata within 10 minutes returns the first result. */
  async function relay(data: Hex): Promise<RelayResult> {
    if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length > 60_000) throw new RelayError("Malformed call.", 400);
    const fn = parse(data);
    const key = data.toLowerCase();
    const now = Date.now();
    for (const [k, v] of recent) if (now - v.at > 600_000) recent.delete(k);
    const seen = recent.get(key);
    if (seen) return seen.result;
    await simulate(data); // refuse early, before queueing
    const result = queue.then(() => send(data, fn));
    queue = result.catch(() => undefined);
    recent.set(key, { at: now, result });
    result.catch(() => recent.delete(key));
    return result;
  }

  /** Runs other work from the relayer's account (native transactions) in the same queue, so sequences never clash. */
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  }

  return { relay, parse, simulate, ensureWindow, exclusive };
}

/** The name of the contract error behind a failed call, if any. */
export function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName;
    const raw = e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null;
    if (raw?.data) {
      try {
        return decodeErrorName(raw.data);
      } catch {
        /* not ours */
      }
    }
  }
  return undefined;
}

function decodeErrorName(data: Hex): string | undefined {
  return decodeErrorResult({ abi: CRUMENA_ABI, data }).errorName;
}

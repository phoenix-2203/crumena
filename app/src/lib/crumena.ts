/**
 * Everything the app does with the Crumena contract.
 *
 * Reads go through the server's read-only RPC (/rpc). Every change follows the same four steps:
 *   1. read the signer's next nonce;
 *   2. ask the contract for the exact statement it will check (a view function), and check its key lines here;
 *   3. the signer approves that text in QoreX, which signs it with ML-DSA-87;
 *   4. hand the call to the relayer, which can only submit it: it can't change a byte without breaking the signature.
 */
import { createPublicClient, encodeFunctionData, erc20Abi, http, type Address, type Hex } from "viem";
import { CRUMENA_ABI } from "../../../shared/crumena-abi";
import { explainError } from "../../../shared/errors";
import { toQor, units, utc } from "./format";
import { signStatement, type Me, type Qorex } from "./qorex";

export interface Config {
  chainId: string;
  evmChainId: number;
  crumena: Address;
  fusd: Address;
  relayer: string;
  fromBlock: number;
}
export interface Pot {
  id: bigint;
  funder: Address;
  recipient: Address;
  token: Address;
  vault: Address;
  createdAt: bigint;
  endsAt: bigint;
  decimals: number;
  confirmedOnly: boolean;
  closed: boolean;
  frozen: boolean;
  periodDays: number;
  periodIndex: bigint;
  paidOut: bigint;
  maxPerPayment: bigint;
  periodLimit: bigint;
  spentInPeriod: bigint;
  symbol: string;
  purpose: string;
  balance: bigint;
}
/** Spending rules; zero means no rule. A period limit needs a period length in days. */
export interface Rules {
  maxPerPayment: bigint;
  periodLimit: bigint;
  periodDays: number;
}
export const NO_RULES: Rules = { maxPerPayment: 0n, periodLimit: 0n, periodDays: 0 };
export interface Payee {
  address: Address;
  approved: boolean;
  confirmed: boolean;
  requested: boolean;
  name: string;
  /** Most the pot may pay this payee in total; 0 means no limit beyond the pot's rules. */
  limit: bigint;
  /** Paid to this payee so far, by this pot. */
  paid: bigint;
  /** The amount the spender asked for when requesting this payee (0 once settled). */
  asked: bigint;
}
export interface NewPot {
  funder: Address;
  recipient: Address;
  token: Address;
  endsAt: bigint;
  confirmedOnly: boolean;
  rules: Rules;
  purpose: string;
  payees: Address[];
  names: string[];
  /** Per payee, most it may receive in total; 0 means no limit. */
  limits: bigint[];
}
export interface Sent {
  hash: Hex;
  block: number;
  potId?: string;
}

/** Signatures are asked to be valid for 30 minutes: plenty to approve, short enough not to linger. */
export const SIGNATURE_MINUTES = 30;

export class ActionError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export async function loadConfig(base = "", f: typeof fetch = fetch): Promise<Config> {
  const r = await f(`${base}/api/config`);
  if (!r.ok) throw new ActionError("Couldn't reach the Crumena server.");
  return (await r.json()) as Config;
}

export interface Options {
  base?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /**
   * Called with the exact text just before it goes to QoreX (after the line check), so the app can show it.
   * Return false to stop there.
   */
  onStatement?: (statement: string, fn: string) => Promise<boolean> | boolean;
}

export function createCrumena(config: Config, opts: Options = {}) {
  const base = opts.base ?? (typeof location === "undefined" ? "" : location.origin);
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const client = createPublicClient({ transport: http(`${base}/rpc`, { fetchFn: f, batch: true }) });
  const address = config.crumena;

  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address, abi: CRUMENA_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;

  // ------------------------------------------------------------------ reads

  async function pot(id: bigint): Promise<Pot> {
    const [p, balance] = await Promise.all([read<Omit<Pot, "id" | "balance">>("potInfo", [id]), read<bigint>("balanceOf", [id])]);
    return { ...p, id, balance };
  }

  async function payees(id: bigint): Promise<Payee[]> {
    const [addrs, info] = await read<[Address[], Omit<Payee, "address">[]]>("payeesOf", [id]);
    return addrs.map((a, i) => ({ address: a, ...info[i]! }));
  }

  /** Spending in the current period (all zero for a pot without a period limit). */
  async function periodSpending(id: bigint): Promise<{ spent: bigint; limit: bigint; resetsAt: bigint }> {
    const [spent, limit, resetsAt] = await read<[bigint, bigint, bigint]>("periodSpending", [id]);
    return { spent, limit, resetsAt };
  }

  async function tokenInfo(token: Address): Promise<{ decimals: number; symbol: string }> {
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    ]);
    return { decimals, symbol };
  }

  /** The pot behind a short link code (the first 8 bytes of its vault), checked against that vault. */
  async function potByCode(code: Hex): Promise<bigint | undefined> {
    const id = await read<bigint>("potOfCode", [code]);
    if (id === 0n) return undefined;
    const p = await read<{ vault: Address }>("potInfo", [id]);
    return p.vault.toLowerCase().startsWith(code.toLowerCase()) ? id : undefined;
  }

  /** Every pot an account funds, spends, or is a payee of, newest first. */
  async function potsOf(account: Address): Promise<Pot[]> {
    const ids = await read<bigint[]>("potsOf", [account]);
    return Promise.all([...ids].reverse().map(pot));
  }

  // ---------------------------------------------------------------- changes

  async function relay(data: Hex): Promise<Sent> {
    const r = await f(`${base}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) });
    const body = (await r.json().catch(() => ({}))) as Sent & { error?: string; reason?: string };
    if (!r.ok) throw new ActionError(body.error ?? "The relayer couldn't send it. Try again in a moment.", body.reason);
    return body;
  }

  /**
   * The shared flow: nonce → statement from the contract → checked here → signed in QoreX → relayed.
   */
  async function signed(
    q: Qorex,
    me: Me,
    signer: Address,
    statementFn: string,
    statementArgs: (nonce: bigint, validUntil: bigint) => readonly unknown[],
    fn: string,
    callArgs: (auth: { nonce: bigint; validUntil: bigint; signature: Hex }) => readonly unknown[],
    /** Lines the statement must contain exactly; the first is the action's header line. */
    mustSay: string[],
  ): Promise<Sent> {
    if (me.evm.toLowerCase() !== signer.toLowerCase()) throw new ActionError("This needs to be signed by a different account.");
    const nonce = await read<bigint>("nonceOf", [signer]);
    const validUntil = BigInt(Math.floor(now() / 1000) + SIGNATURE_MINUTES * 60);
    const statement = await read<string>(statementFn, statementArgs(nonce, validUntil));
    checkStatement(statement, [
      ...mustSay,
      `Signed by: ${toQor(signer)}`,
      `Nonce: ${nonce}`,
      `Valid until: ${utc(validUntil)}`,
      `Contract: ${address.toLowerCase()} on ${config.chainId}`,
    ]);
    if (opts.onStatement && !(await opts.onStatement(statement, fn))) throw new ActionError("Cancelled. Nothing was signed.");
    const signature = await signStatement(q, me, statement);
    const data = encodeFunctionData({ abi: CRUMENA_ABI, functionName: fn as never, args: callArgs({ nonce, validUntil, signature }) as never });
    return relay(data);
  }

  const amountLine = (amount: bigint, p: Pot) => `Amount: ${units(amount, p.decimals)} ${p.symbol}`;
  const upToLine = (limit: bigint, p: Pot) => `Up to: ${limit === 0n ? "no limit" : `${units(limit, p.decimals)} ${p.symbol} in total`}`;

  return {
    config,
    client,
    read,
    pot,
    payees,
    potsOf,
    potByCode,
    periodSpending,
    tokenInfo,
    nonceOf: (a: Address) => read<bigint>("nonceOf", [a]),
    vaultFor: (funder: Address, nonce: bigint) => read<Address>("vaultFor", [funder, nonce]),

    createPot: async (q: Qorex, me: Me, p: NewPot) => {
      const t = await tokenInfo(p.token);
      return signed(q, me, p.funder, "createStatement", (n, v) => [p, n, v], "createPot", (a) => [p, a], [
        "Crumena: create a pot",
        `Purpose: ${p.purpose}`,
        `Spent by: ${toQor(p.recipient)}`,
        `Ends: ${utc(p.endsAt)}`,
        `Pay only payees who confirmed: ${p.confirmedOnly ? "yes" : "no"}`,
        ...rulesLines(p.rules, t.decimals, t.symbol),
        ...p.payees.map((x, i) => `${i + 1}. ${p.names[i]}, ${x.toLowerCase()}${payeeLimitText(p.limits[i] ?? 0n, t.decimals, t.symbol)}`),
      ]);
    },

    pay: (q: Qorex, me: Me, p: Pot, payee: Address, amount: bigint, memo: string) =>
      signed(q, me, me.evm, "payStatement", (n, v) => [p.id, payee, amount, memo, me.evm, n, v], "pay", (a) => [p.id, payee, amount, memo, me.evm, a], [
        `Crumena: pay from pot #${p.id}`,
        amountLine(amount, p),
        `Address: ${payee.toLowerCase()}`,
        `Memo: ${memo || "-"}`,
      ]),

    addPayee: (q: Qorex, me: Me, p: Pot, payee: Address, name: string, limit: bigint) =>
      signed(q, me, p.funder, "addPayeeStatement", (n, v) => [p.id, payee, name, limit, n, v], "addPayee", (a) => [p.id, payee, name, limit, a], [
        `Crumena: approve a payee for pot #${p.id}`,
        `Payee: ${name}`,
        `Address: ${payee.toLowerCase()}`,
        upToLine(limit, p),
      ]),

    setPayeeLimit: (q: Qorex, me: Me, p: Pot, payee: Address, limit: bigint) =>
      signed(q, me, p.funder, "payeeLimitStatement", (n, v) => [p.id, payee, limit, n, v], "setPayeeLimit", (a) => [p.id, payee, limit, a], [
        `Crumena: change what pot #${p.id} may pay a payee`,
        `Address: ${payee.toLowerCase()}`,
        upToLine(limit, p),
      ]),

    removePayee: (q: Qorex, me: Me, p: Pot, payee: Address) =>
      signed(q, me, p.funder, "removePayeeStatement", (n, v) => [p.id, payee, n, v], "removePayee", (a) => [p.id, payee, a], [
        `Crumena: stop paying a payee from pot #${p.id}`,
        `Address: ${payee.toLowerCase()}`,
      ]),

    requestPayee: (q: Qorex, me: Me, p: Pot, payee: Address, name: string, amount: bigint) =>
      signed(q, me, p.recipient, "requestPayeeStatement", (n, v) => [p.id, payee, name, amount, n, v], "requestPayee", (a) => [p.id, payee, name, amount, a], [
        `Crumena: ask the funder to approve a payee for pot #${p.id}`,
        `Payee: ${name}`,
        `Address: ${payee.toLowerCase()}`,
        amountLine(amount, p),
      ]),

    confirmPayee: (q: Qorex, me: Me, p: Pot) =>
      signed(q, me, me.evm, "confirmPayeeStatement", (n, v) => [p.id, me.evm, n, v], "confirmPayee", (a) => [p.id, me.evm, a], [
        `Crumena: confirm this address is mine and can be paid from pot #${p.id}`,
        `Address: ${me.evm.toLowerCase()}`,
      ]),

    extend: (q: Qorex, me: Me, p: Pot, newEndsAt: bigint) =>
      signed(q, me, p.funder, "extendStatement", (n, v) => [p.id, newEndsAt, n, v], "extend", (a) => [p.id, newEndsAt, a], [
        `Crumena: move the end of pot #${p.id}`,
        `New end: ${utc(newEndsAt)}`,
      ]),

    setRules: (q: Qorex, me: Me, p: Pot, r: Rules) =>
      signed(q, me, p.funder, "rulesStatement", (n, v) => [p.id, r, n, v], "setRules", (a) => [p.id, r, a], [
        `Crumena: change the spending rules of pot #${p.id}`,
        ...rulesLines(r, p.decimals, p.symbol),
      ]),

    setFrozen: (q: Qorex, me: Me, p: Pot, frozen: boolean) =>
      signed(q, me, p.funder, "frozenStatement", (n, v) => [p.id, frozen, n, v], "setFrozen", (a) => [p.id, frozen, a], [
        frozen
          ? `Crumena: freeze pot #${p.id} (no payments until the funder unfreezes it)`
          : `Crumena: unfreeze pot #${p.id} (payments allowed again)`,
      ]),

    release: (q: Qorex, me: Me, p: Pot) =>
      signed(q, me, p.funder, "releaseStatement", (n, v) => [p.id, n, v], "release", (a) => [p.id, a], [
        `Crumena: give everything left in pot #${p.id} to the person who spends it, with no restrictions, and close the pot`,
        `To: ${toQor(p.recipient)}`,
      ]),

    /** No signature: after the end date (or once closed) anyone may send the rest back to the funder, and only there. */
    reclaim: (p: Pot) => relay(encodeFunctionData({ abi: CRUMENA_ABI, functionName: "reclaim", args: [p.id] })),
  };
}

export type Crumena = ReturnType<typeof createCrumena>;

/** How a payee's limit ends its line in the create statement, exactly as the contract writes it. */
export function payeeLimitText(limit: bigint, decimals: number, symbol: string): string {
  return limit === 0n ? ", no limit" : `, up to ${units(limit, decimals)} ${symbol}`;
}

/** The two rules lines exactly as the contract writes them. */
export function rulesLines(r: Rules, decimals: number, symbol: string): [string, string] {
  const perPayment = r.maxPerPayment === 0n ? "none" : `${units(r.maxPerPayment, decimals)} ${symbol}`;
  const perPeriod =
    r.periodLimit === 0n ? "none" : `${units(r.periodLimit, decimals)} ${symbol} every ${r.periodDays} ${r.periodDays === 1 ? "day" : "days"}`;
  return [`Limit per payment: ${perPayment}`, `Limit per period: ${perPeriod}`];
}

/**
 * Throws unless the statement's first line is the expected action and every expected line appears exactly.
 * The contract builds the text; this check means a tampered server can't put other words in front of the signer.
 */
export function checkStatement(statement: string, mustSay: string[]): void {
  const lines = statement.split("\n");
  if (lines[0] !== mustSay[0]) throw new ActionError("The text to sign was for a different action, so it wasn't sent to QoreX. Reload and try again.");
  for (const want of mustSay) {
    if (!lines.includes(want)) {
      throw new ActionError("The text to sign didn't match what you asked for, so it wasn't sent to QoreX. Reload and try again.");
    }
  }
}

/** A message to show a person for any failure. */
export function explain(e: unknown): string {
  if (e instanceof ActionError) return e.reason ? explainError(e.reason) : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

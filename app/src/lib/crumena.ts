/**
 * Everything the app does with the Crumena contract.
 *
 * Reads go through the server's read-only RPC (/rpc). Every change follows the same four steps:
 *   1. read the signer's next nonce;
 *   2. ask the contract for the exact statement it will check (a view function), and check its key lines here;
 *   3. the signer approves that text in QoreX, which signs it with ML-DSA-87;
 *   4. hand the call to the relayer, which can only submit it: it can't change a byte without breaking the signature.
 */
import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";
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
  paidOut: bigint;
  symbol: string;
  purpose: string;
  balance: bigint;
}
export interface Payee {
  address: Address;
  approved: boolean;
  confirmed: boolean;
  requested: boolean;
  name: string;
}
export interface NewPot {
  funder: Address;
  recipient: Address;
  token: Address;
  endsAt: bigint;
  confirmedOnly: boolean;
  purpose: string;
  payees: Address[];
  names: string[];
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

export function createCrumena(config: Config, opts: { base?: string; fetch?: typeof fetch; now?: () => number } = {}) {
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
    const signature = await signStatement(q, me, statement);
    const data = encodeFunctionData({ abi: CRUMENA_ABI, functionName: fn as never, args: callArgs({ nonce, validUntil, signature }) as never });
    return relay(data);
  }

  const amountLine = (amount: bigint, p: Pot) => `Amount: ${units(amount, p.decimals)} ${p.symbol}`;

  return {
    config,
    read,
    pot,
    payees,
    potsOf,
    nonceOf: (a: Address) => read<bigint>("nonceOf", [a]),
    vaultFor: (funder: Address, nonce: bigint) => read<Address>("vaultFor", [funder, nonce]),

    createPot: (q: Qorex, me: Me, p: NewPot) =>
      signed(q, me, p.funder, "createStatement", (n, v) => [p, n, v], "createPot", (a) => [p, a], [
        "Crumena: create a pot",
        `Purpose: ${p.purpose}`,
        `Spent by: ${toQor(p.recipient)}`,
        `Ends: ${utc(p.endsAt)}`,
        `Pay only payees who confirmed: ${p.confirmedOnly ? "yes" : "no"}`,
        ...p.payees.map((x, i) => `${i + 1}. ${p.names[i]}, ${x.toLowerCase()}`),
      ]),

    pay: (q: Qorex, me: Me, p: Pot, payee: Address, amount: bigint, memo: string) =>
      signed(q, me, me.evm, "payStatement", (n, v) => [p.id, payee, amount, memo, me.evm, n, v], "pay", (a) => [p.id, payee, amount, memo, me.evm, a], [
        `Crumena: pay from pot #${p.id}`,
        amountLine(amount, p),
        `Address: ${payee.toLowerCase()}`,
        `Memo: ${memo || "-"}`,
      ]),

    addPayee: (q: Qorex, me: Me, p: Pot, payee: Address, name: string) =>
      signed(q, me, p.funder, "addPayeeStatement", (n, v) => [p.id, payee, name, n, v], "addPayee", (a) => [p.id, payee, name, a], [
        `Crumena: approve a payee for pot #${p.id}`,
        `Payee: ${name}`,
        `Address: ${payee.toLowerCase()}`,
      ]),

    removePayee: (q: Qorex, me: Me, p: Pot, payee: Address) =>
      signed(q, me, p.funder, "removePayeeStatement", (n, v) => [p.id, payee, n, v], "removePayee", (a) => [p.id, payee, a], [
        `Crumena: stop paying a payee from pot #${p.id}`,
        `Address: ${payee.toLowerCase()}`,
      ]),

    requestPayee: (q: Qorex, me: Me, p: Pot, payee: Address, name: string) =>
      signed(q, me, p.recipient, "requestPayeeStatement", (n, v) => [p.id, payee, name, n, v], "requestPayee", (a) => [p.id, payee, name, a], [
        `Crumena: ask the funder to approve a payee for pot #${p.id}`,
        `Payee: ${name}`,
        `Address: ${payee.toLowerCase()}`,
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

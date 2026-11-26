/**
 * "Make this pot misbehave": a public pot on testnet that visitors try to misuse.
 *
 * The server holds the challenge pot's throwaway testnet people (funder, spender, two payees and an
 * outsider standing in for the visitor). Each attack is built exactly as an attacker would: a real
 * ML-DSA-87 signature where the attack has one, then the call is run against the live Crumena contract
 * (the relayer's own pre-flight check, estimateGas against the latest block). The contract's own error
 * comes back. Refused calls never reach a block, so they cost nothing. The one honest action, a 0.01 fUSD
 * payment to the approved payee, is relayed for real and gets a receipt.
 *
 * Setup is one-time and on chain: it registers the people's ML-DSA-87 keys, creates the pot (signed by
 * its funder) and pays 25 fUSD into it from the relayer. Its keys stay in server/data/challenge.json
 * (git-ignored, readable by the server only). Testnet throwaways, labelled as such.
 */
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { CRUMENA_ABI } from "../../shared/crumena-abi";
import { explainError } from "../../shared/errors";
import { FUSD, convertFusdMsg, publicClient, registerPqcKey, useAccount, type Account } from "./chain";
import { RelayError, type RelayResult } from "./relay";

const FUSD_UNIT = 1_000_000n;
export const HONEST_AMOUNT = 10_000n; // 0.01 fUSD
const CAP = 5n * FUSD_UNIT; // most per payment
const CAPPED_LIMIT = 1n * FUSD_UNIT; // what the second payee may receive in total
const FUNDING = 25n * FUSD_UNIT;
const QOR_EACH = 300_000n; // uqor, for each person's key registration

export const ATTACKS = {
  payStranger: "A properly signed payment to your own address, which the funder never approved",
  overCap: "Pay 6 fUSD in one go, over the pot's 5 fUSD cap per payment",
  overPayee: "Pay a payee 2 fUSD when the funder approved only 1 fUSD for them",
  tamper: "Sign a 0.01 fUSD payment, then change the amount to 4.99 before it's sent",
  replay: "Send an old, properly signed payment again",
  wrongKey: "Sign the spender's payment with another registered ML-DSA-87 key",
  approveSelf: "Approve yourself as a payee, signed by the spender instead of the funder",
  takeAll: "Give everything left to the spender, signed by the spender instead of the funder",
} as const;
export type Attack = keyof typeof ATTACKS;

interface Saved {
  potId: string;
  vault: Address;
  people: Record<"funder" | "spender" | "payee" | "capped" | "outsider", string>; // mnemonics (testnet throwaways)
  stats: { refused: Record<string, number>; honest: number; gotThrough: number };
  lastHonest?: { args: unknown[]; hash: string };
}

/** pay(potId, payee, amount, memo, signer, auth) arguments, with the numbers as bigints again. */
function revivePay(a: unknown[]): unknown[] {
  const auth = a[5] as { nonce: string | bigint; validUntil: string | bigint; signature: Hex };
  return [BigInt(a[0] as string), a[1], BigInt(a[2] as string), a[3], a[4], { nonce: BigInt(auth.nonce), validUntil: BigInt(auth.validUntil), signature: auth.signature }];
}

export interface TryResult {
  attack: Attack | "honest";
  what: string;
  refused: boolean;
  reason?: string;
  explanation: string;
  statement?: string;
  block?: string;
  hash?: string;
}

export function createChallenge(opts: {
  relayer: Account;
  crumena: Address;
  relay: (data: Hex) => Promise<RelayResult>;
  simulate: (data: Hex) => Promise<bigint>;
  exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  file?: URL;
  log?: (s: string) => void;
}) {
  const file = opts.file ?? new URL("../data/challenge.json", import.meta.url);
  const log = opts.log ?? console.log;
  let saved: Saved | undefined = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Saved) : undefined;
  let people: Record<keyof Saved["people"], Account> | undefined;
  let setting = false;

  const save = () => {
    mkdirSync(new URL(".", file), { recursive: true });
    writeFileSync(file, JSON.stringify(saved, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    chmodSync(file, 0o600);
  };
  const read = <T>(fn: string, args: unknown[]) =>
    publicClient.readContract({ address: opts.crumena, abi: CRUMENA_ABI, functionName: fn as never, args: args as never }) as Promise<T>;
  const until = () => BigInt(Math.floor(Date.now() / 1000) + 1800);
  const nonceOf = (a: Account) => read<bigint>("nonceOf", [a.evm]);
  const data = (fn: string, args: unknown[]) => encodeFunctionData({ abi: CRUMENA_ABI, functionName: fn as never, args: args as never });

  async function load() {
    if (people || !saved) return;
    const entries = await Promise.all(Object.entries(saved.people).map(async ([k, m]) => [k, await useAccount(m)] as const));
    people = Object.fromEntries(entries) as unknown as Record<keyof Saved["people"], Account>;
  }

  /** One-time, on chain: people with registered keys, the pot, and its money. */
  async function setup(): Promise<void> {
    if (saved || setting) return;
    setting = true;
    try {
      const mnemonics = { funder: generateMnemonic(256), spender: generateMnemonic(256), payee: generateMnemonic(256), capped: generateMnemonic(256), outsider: generateMnemonic(256) };
      const unified = Object.fromEntries(await Promise.all(Object.entries(mnemonics).map(async ([k, m]) => [k, await deriveUnifiedAccount(m)] as const)));
      const signers = ["funder", "spender", "outsider"] as const; // these need keys; payees are just addresses
      await opts.exclusive(() =>
        opts.relayer.native(
          "challenge: gas for key registration",
          signers.map((k) => ({ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: opts.relayer.qor, toAddress: unified[k]!.cosmos, amount: [{ denom: "uqor", amount: QOR_EACH.toString() }] } })),
        ),
      );
      await Promise.all(signers.map((k) => registerPqcKey(unified[k]!)));
      const p = Object.fromEntries(await Promise.all(Object.entries(mnemonics).map(async ([k, m]) => [k, await useAccount(m)] as const))) as Record<keyof Saved["people"], Account>;

      const newPot = {
        funder: p.funder.evm,
        recipient: p.spender.evm,
        token: FUSD,
        endsAt: BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400),
        confirmedOnly: false,
        rules: { maxPerPayment: CAP, periodLimit: 0n, periodDays: 0 },
        purpose: "Public challenge: make this pot misbehave",
        payees: [p.payee.evm, p.capped.evm],
        names: ["Approved payee", "Payee approved for 1 fUSD"],
        limits: [0n, CAPPED_LIMIT],
      };
      const n = await nonceOf(p.funder);
      const v = until();
      const statement = await read<string>("createStatement", [newPot, n, v]);
      const created = await opts.relay(data("createPot", [newPot, { nonce: n, validUntil: v, signature: p.funder.signText(statement) }]));
      const potId = created.potId!;
      const vault = (await read<{ vault: Address }>("potInfo", [BigInt(potId)])).vault;
      await opts.exclusive(() => opts.relayer.native(`challenge: ${FUNDING / FUSD_UNIT} fUSD into pot #${potId}`, [convertFusdMsg(opts.relayer.qor, vault, FUNDING)]));
      saved = { potId, vault, people: mnemonics, stats: { refused: {}, honest: 0, gotThrough: 0 } };
      people = p;
      save();
      log(`challenge pot #${potId} ready at ${vault}`);
      await new Promise((r) => setTimeout(r, 3000));
      await honest(); // so "replay" has a real old payment to replay
    } finally {
      setting = false;
    }
  }

  async function signedPay(by: Account, payee: Address, amount: bigint, signAmount = amount, signer: Account = by) {
    const potId = BigInt(saved!.potId);
    const n = await nonceOf(by);
    const v = until();
    const statement = await read<string>("payStatement", [potId, payee, signAmount, "", by.evm, n, v]);
    return { statement, args: [potId, payee, amount, "", by.evm, { nonce: n, validUntil: v, signature: signer.signText(statement) }] };
  }

  async function honest(): Promise<TryResult> {
    await load();
    const { statement, args } = await signedPay(people!.spender, people!.payee.evm, HONEST_AMOUNT);
    const sent = await opts.relay(data("pay", args));
    saved!.stats.honest++;
    saved!.lastHonest = { args, hash: sent.hash };
    save();
    return { attack: "honest", what: "Pay the approved payee 0.01 fUSD, properly signed by the spender", refused: false, explanation: "Paid: it follows every rule of the pot.", statement, hash: sent.hash, block: String(sent.block) };
  }

  /** Builds the attack, runs it against the live contract, and reports what the contract said. */
  async function attempt(attack: Attack): Promise<TryResult> {
    await load();
    const s = people!;
    const potId = BigInt(saved!.potId);
    let fn = "pay";
    let args: unknown[];
    let statement: string | undefined;
    switch (attack) {
      case "payStranger":
        ({ statement, args } = await signedPay(s.spender, s.outsider.evm, HONEST_AMOUNT));
        break;
      case "overCap":
        ({ statement, args } = await signedPay(s.spender, s.payee.evm, CAP + FUSD_UNIT));
        break;
      case "overPayee":
        ({ statement, args } = await signedPay(s.spender, s.capped.evm, 2n * FUSD_UNIT));
        break;
      case "tamper":
        ({ statement, args } = await signedPay(s.spender, s.payee.evm, 4_990_000n, HONEST_AMOUNT));
        break;
      case "replay":
        if (!saved!.lastHonest) throw new RelayError("There's no earlier payment to replay yet. Make the honest payment first.", 409);
        args = revivePay(saved!.lastHonest.args); // read back from JSON: numbers come back as strings
        break;
      case "wrongKey":
        ({ statement, args } = await signedPay(s.spender, s.payee.evm, HONEST_AMOUNT, HONEST_AMOUNT, s.outsider));
        break;
      case "approveSelf": {
        fn = "addPayee";
        const n = await nonceOf(s.funder);
        const v = until();
        statement = await read<string>("addPayeeStatement", [potId, s.outsider.evm, "Me", 0n, n, v]);
        args = [potId, s.outsider.evm, "Me", 0n, { nonce: n, validUntil: v, signature: s.spender.signText(statement) }];
        break;
      }
      case "takeAll": {
        fn = "release";
        const n = await nonceOf(s.funder);
        const v = until();
        statement = await read<string>("releaseStatement", [potId, n, v]);
        args = [potId, { nonce: n, validUntil: v, signature: s.spender.signText(statement) }];
        break;
      }
      default:
        throw new RelayError("Unknown attack.", 400);
    }
    const block = await publicClient.getBlockNumber({ cacheTime: 0 });
    try {
      await opts.simulate(data(fn, args));
    } catch (e) {
      const reason = e instanceof RelayError ? e.reason : undefined;
      if (!reason) throw e; // not the contract refusing: a network problem, say so as one
      saved!.stats.refused[attack] = (saved!.stats.refused[attack] ?? 0) + 1;
      save();
      return { attack, what: ATTACKS[attack], refused: true, reason, explanation: explainError(reason), statement, block: block.toString() };
    }
    // Should never happen: the contract would have accepted it. Say so plainly, and don't send it.
    saved!.stats.gotThrough++;
    save();
    log(`CHALLENGE: ${attack} was NOT refused by the contract`);
    return { attack, what: ATTACKS[attack], refused: false, explanation: "The contract would have accepted this. It was not sent.", statement, block: block.toString() };
  }

  async function state() {
    if (!saved) return { ready: false as const };
    const potId = BigInt(saved.potId);
    const [balance, paidOut] = await Promise.all([read<bigint>("balanceOf", [potId]), read<{ paidOut: bigint }>("potInfo", [potId]).then((p) => p.paidOut)]);
    const refused = Object.values(saved.stats.refused).reduce((a, b) => a + b, 0);
    return {
      ready: true as const,
      potId: saved.potId,
      vault: saved.vault,
      balance: balance.toString(),
      paidOut: paidOut.toString(),
      refused,
      gotThrough: saved.stats.gotThrough,
      honest: saved.stats.honest,
      attacks: Object.entries(ATTACKS).map(([id, what]) => ({ id, what, refused: saved!.stats.refused[id] ?? 0 })),
    };
  }

  return { setup, attempt, honest, state, isSetUp: () => !!saved };
}

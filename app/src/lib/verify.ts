/**
 * "Verify this" for any Crumena action, in the browser, without trusting Crumena's server:
 *  1. read the transaction and decode the call;
 *  2. ask the contract, as of the block before, for the exact statement that call stands for;
 *  3. read the signer's ML-DSA-87 key from QoreChain's pqcKeyStatus precompile, as of that block;
 *  4. check the signature over QoreX's message bytes with ML-DSA-87, here in the browser.
 * Same inputs as the contract's own check, done independently.
 */
import { messagePqSignBytes, pqVerify } from "@qorechain/qoresign";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, hexToBytes, sha256, type Address, type Hex } from "viem";
import { CRUMENA_ABI } from "../../../shared/crumena-abi";
import type { Crumena } from "./crumena";
import { toQor } from "./format";

const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02" as const;
const KEY_STATUS_ABI = [{ type: "function", name: "pqcKeyStatus", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [] }] as const;

type Auth = { nonce: bigint; validUntil: bigint; signature: Hex };
type PotView = { funder: Address; recipient: Address };

export interface Verification {
  fn: string;
  block: bigint;
  signed: boolean; // false for reclaim, which needs no signature
  signer?: Address;
  signerQor?: string;
  statement?: string;
  keyFingerprint?: string; // first 16 hex digits of sha256(public key)
  valid?: boolean;
  note?: string;
}

export async function verifyAction(c: Crumena, hash: Hex): Promise<Verification> {
  const client = c.client;
  const tx = await client.getTransaction({ hash });
  if (!tx.to || tx.to.toLowerCase() !== c.config.crumena.toLowerCase()) throw new Error("That transaction isn't a call to Crumena.");
  const block = tx.blockNumber!;
  const before = block - 1n;
  const { functionName: fn, args } = decodeFunctionData({ abi: CRUMENA_ABI, data: tx.input });
  const a = args as readonly unknown[];
  if (fn === "reclaim") return { fn, block, signed: false, note: "Sending what's left back to the funder needs no signature: the money can only go to the funder." };

  const at = (name: string, params: readonly unknown[]) =>
    client.readContract({ address: c.config.crumena, abi: CRUMENA_ABI, functionName: name as never, args: params as never, blockNumber: before }) as Promise<unknown>;
  const potOf = async (id: bigint) => (await at("potInfo", [id])) as PotView;

  let signer: Address;
  let statementFn: string;
  let statementArgs: readonly unknown[];
  let auth: Auth;
  switch (fn) {
    case "createPot":
      auth = a[1] as Auth;
      signer = (a[0] as { funder: Address }).funder;
      [statementFn, statementArgs] = ["createStatement", [a[0], auth.nonce, auth.validUntil]];
      break;
    case "pay":
      auth = a[5] as Auth;
      signer = a[4] as Address;
      [statementFn, statementArgs] = ["payStatement", [a[0], a[1], a[2], a[3], a[4], auth.nonce, auth.validUntil]];
      break;
    case "addPayee":
    case "requestPayee": {
      // (potId, payee, name, limit or amount, auth)
      auth = a[4] as Auth;
      const pot = await potOf(a[0] as bigint);
      signer = fn === "addPayee" ? pot.funder : pot.recipient;
      [statementFn, statementArgs] = [`${fn}Statement`, [a[0], a[1], a[2], a[3], auth.nonce, auth.validUntil]];
      break;
    }
    case "setPayeeLimit":
      // (potId, payee, limit, auth)
      auth = a[3] as Auth;
      signer = (await potOf(a[0] as bigint)).funder;
      [statementFn, statementArgs] = ["payeeLimitStatement", [a[0], a[1], a[2], auth.nonce, auth.validUntil]];
      break;
    case "removePayee":
      auth = a[2] as Auth;
      signer = (await potOf(a[0] as bigint)).funder;
      [statementFn, statementArgs] = ["removePayeeStatement", [a[0], a[1], auth.nonce, auth.validUntil]];
      break;
    case "confirmPayee":
      auth = a[2] as Auth;
      signer = a[1] as Address;
      [statementFn, statementArgs] = ["confirmPayeeStatement", [a[0], a[1], auth.nonce, auth.validUntil]];
      break;
    case "extend":
    case "setRules":
    case "setFrozen": {
      auth = a[2] as Auth;
      signer = (await potOf(a[0] as bigint)).funder;
      const name = fn === "extend" ? "extendStatement" : fn === "setRules" ? "rulesStatement" : "frozenStatement";
      [statementFn, statementArgs] = [name, [a[0], a[1], auth.nonce, auth.validUntil]];
      break;
    }
    case "release":
      auth = a[1] as Auth;
      signer = (await potOf(a[0] as bigint)).funder;
      [statementFn, statementArgs] = ["releaseStatement", [a[0], auth.nonce, auth.validUntil]];
      break;
    default:
      throw new Error(`Crumena's ${fn} isn't a signed action.`);
  }

  const statement = (await at(statementFn, statementArgs)) as string;
  const key = await keyAt(c, signer, before);
  if (!key) return { fn, block, signed: true, signer, signerQor: toQor(signer), statement, valid: false, note: "No ML-DSA-87 key was registered for the signer at that block." };
  const valid = pqVerify(hexToBytes(key), messagePqSignBytes(c.config.chainId, statement), hexToBytes(auth.signature));
  return { fn, block, signed: true, signer, signerQor: toQor(signer), statement, keyFingerprint: sha256(key).slice(2, 18), valid };
}

/** The signer's registered ML-DSA-87 public key as of `block`, from QoreChain's pqcKeyStatus precompile. */
export async function keyAt(c: Crumena, account: Address, block: bigint): Promise<Hex | undefined> {
  const data = encodeFunctionData({ abi: KEY_STATUS_ABI, functionName: "pqcKeyStatus", args: [account] });
  const { data: ret } = await c.client.call({ to: PQC_KEY_STATUS, data, blockNumber: block });
  if (!ret || ret === "0x") return undefined;
  // Current chains answer (registered, algorithm, key, possessionProven); older ones leave out the last.
  let registered: boolean, algorithm: number, key: Hex;
  try {
    [registered, algorithm, key] = decodeAbiParameters([{ type: "bool" }, { type: "uint8" }, { type: "bytes" }, { type: "bool" }], ret);
  } catch {
    [registered, algorithm, key] = decodeAbiParameters([{ type: "bool" }, { type: "uint8" }, { type: "bytes" }], ret);
  }
  return registered && algorithm === 1 && hexToBytes(key).length === 2592 ? key : undefined;
}

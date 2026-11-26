/**
 * QoreX, QoreChain's wallet. Crumena only asks it for two things:
 *  - which account is active (`native.getKey`), and
 *  - an ML-DSA-87 signature over a readable statement (`native.signArbitrary`).
 * Nobody needs gas or an EVM transaction to use Crumena: the relayer submits what people sign.
 *
 * QoreX signs `"qorechain-msg-v1|" + chainId + "|" + statement` with the account's ML-DSA-87 key, which is
 * exactly what the contract rebuilds and checks with the pqcVerify precompile (see contracts/src/Crumena.sol).
 * The optional ERC-20 transfer below uses QoreX's EVM provider and needs an Ethereum-type account.
 */
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { toEvm } from "./format";

export const CHAIN_ID = "qorechain-diana";
export const EVM_CHAIN_HEX = "0x2648"; // 9800
export const QOREX_INSTALL_URL = "https://chromewebstore.google.com/detail/qorex/cflpnggbnnifibblifgbeobogdpfjpcg";
export const ML_DSA_87 = 1;

interface QorexKey {
  algo: string;
  bech32Address: string;
}
interface SignArbitraryResult {
  signatureType: string;
  pq?: { algorithmId: number; signature: string };
}
export interface Qorex {
  native: {
    capabilities?: readonly string[];
    enable(chainId: string): Promise<unknown>;
    getKey(chainId: string): Promise<QorexKey>;
    signArbitrary(chainId: string, signer: string, data: string): Promise<SignArbitraryResult>;
  };
  evm?: { request(args: { method: string; params?: readonly unknown[] }): Promise<unknown> };
}

declare global {
  interface Window {
    qorex?: Qorex;
  }
}

export class WalletError extends Error {
  constructor(
    readonly code: "NOT_INSTALLED" | "REJECTED" | "UNSUPPORTED" | "WRONG_ACCOUNT" | "WRONG_NETWORK" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

export interface Me {
  qor: string;
  evm: Address;
  /** "ethereum" accounts can also send EVM transactions from QoreX; both kinds can sign. */
  kind: "ethereum" | "main";
}

/** QoreX injects a moment after the page loads. */
export async function findQorex(win: { qorex?: Qorex } = window, timeoutMs = 1500): Promise<Qorex | undefined> {
  const end = Date.now() + timeoutMs;
  while (!win.qorex?.native && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return win.qorex?.native ? win.qorex : undefined;
}

function plain(error: unknown): WalletError {
  if (error instanceof WalletError) return error;
  const m = String((error as { message?: unknown })?.message ?? error);
  if (/reject|denied|cancel/i.test(m)) return new WalletError("REJECTED", "You cancelled it in QoreX. Nothing was signed.");
  return new WalletError("FAILED", m.replace(/^QoreX:\s*/, ""));
}

/** Asks QoreX to connect this site and reports the active account. */
export async function connect(q: Qorex | undefined): Promise<Me> {
  if (!q) throw new WalletError("NOT_INSTALLED", "Install QoreX to sign in.");
  try {
    await q.native.enable(CHAIN_ID);
    const key = await q.native.getKey(CHAIN_ID);
    return { qor: key.bech32Address, evm: toEvm(key.bech32Address), kind: key.algo === "ethsecp256k1" ? "ethereum" : "main" };
  } catch (e) {
    throw plain(e);
  }
}

/**
 * Shows the statement in QoreX for approval and returns the bare ML-DSA-87 signature (4627 bytes) the contract checks.
 * Refuses to go on if QoreX has switched account since sign-in, so nobody signs as someone they didn't mean to be.
 */
export async function signStatement(q: Qorex, me: Me, statement: string): Promise<Hex> {
  if (q.native.capabilities && !q.native.capabilities.includes("signArbitrary")) {
    throw new WalletError("UNSUPPORTED", "Update QoreX: this version can't sign messages.");
  }
  try {
    const active = await q.native.getKey(CHAIN_ID);
    if (active.bech32Address !== me.qor) {
      throw new WalletError("WRONG_ACCOUNT", "QoreX has switched to another account. Sign in again with the account you mean to use.");
    }
    const r = await q.native.signArbitrary(CHAIN_ID, me.qor, statement);
    if (!r.pq || r.pq.algorithmId !== ML_DSA_87) {
      throw new WalletError("UNSUPPORTED", "QoreX returned no ML-DSA-87 signature. This account needs its post-quantum key set up in QoreX.");
    }
    const bytes = Uint8Array.from(atob(r.pq.signature), (c) => c.charCodeAt(0));
    if (bytes.length !== 4627) throw new WalletError("FAILED", "QoreX returned a post-quantum signature of the wrong size.");
    return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  } catch (e) {
    throw plain(e);
  }
}

/** Optional: pay fUSD (ERC-20) straight into a pot's address from QoreX's EVM side. Ethereum-type accounts only. */
export async function transferToPot(q: Qorex, me: Me, token: Address, vault: Address, amount: bigint): Promise<Hex> {
  if (me.kind !== "ethereum" || !q.evm) {
    throw new WalletError("UNSUPPORTED", "This account can't send EVM transactions. Send fUSD to the pot's address instead.");
  }
  try {
    const chain = (await q.evm.request({ method: "eth_chainId" })) as string;
    if (chain.toLowerCase() !== EVM_CHAIN_HEX) throw new WalletError("WRONG_NETWORK", "Switch QoreX to testnet.");
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [vault, amount] });
    return (await q.evm.request({ method: "eth_sendTransaction", params: [{ from: me.evm, to: token, data }] })) as Hex;
  } catch (e) {
    throw plain(e);
  }
}

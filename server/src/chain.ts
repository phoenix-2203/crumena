/**
 * QoreChain testnet plumbing shared by the relayer and the scripts: REST reads,
 * hybrid-signed native transactions, scoped EVM windows, fUSD conversion, and
 * ML-DSA-87 message signatures in QoreX's format.
 */
import { evmWindowCost, evmWindowStatus, qorechainTestnet, type EvmWindow } from "@qorechain/evm";
import { classicalKeyFromPrivate, signMessage } from "@qorechain/qoresign";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  openEvmWindowMsg,
  qorechainRegistry,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { BinaryReader, BinaryWriter } from "cosmjs-types/binary";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import { createPublicClient, createWalletClient, hexToBytes, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CHAIN_ID = "qorechain-diana";
export const EVM_CHAIN_ID = 9800;
export const REST = process.env.QORE_REST ?? "https://api-testnet.qore.host";
export const EVM_RPC = process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host";
export const EXPLORER = "https://explore.qore.network";
/** fUSD, the fest's test dollar: an ERC-20 with 6 decimals, also a bank coin under this denom. */
export const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
export const FUSD_DENOM = `erc20:${FUSD}`;
export const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "90000" }], gas: "600000" };
export const MAX_FEE_PER_GAS = 250_000_000_000n;
export const PRIORITY_FEE = 1_000_000_000n;

export const chain = { ...qorechainTestnet, rpcUrls: { default: { http: [EVM_RPC] } } };
export const publicClient = createPublicClient({ chain, transport: http(EVM_RPC) });

export async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${REST}${path}`, init);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export interface Included {
  code: number;
  transactionHash: string;
  rawLog?: string;
  height?: number;
}

/** Broadcasts a signed native tx and waits until the chain includes it. */
export const transport = {
  async broadcastTx(tx: Uint8Array): Promise<Included> {
    const res = await rest<{ tx_response: { code: number; txhash: string; raw_log: string } }>("/cosmos/tx/v1beta1/txs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: Buffer.from(tx).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
    });
    const { code, txhash, raw_log } = res.tx_response;
    if (code !== 0) return { code, transactionHash: txhash, rawLog: raw_log };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${txhash}`);
      if (got.ok) {
        const j = (await got.json()) as { tx_response: { code: number; raw_log: string; height: string } };
        return { code: j.tx_response.code, transactionHash: txhash, rawLog: j.tx_response.raw_log, height: Number(j.tx_response.height) };
      }
    }
    throw new Error(`Not included after 60 s: ${txhash}`);
  },
};

// ------------------------------------------------------- MsgConvertCoin (fUSD bank -> ERC-20)

/** cosmos/evm `MsgConvertCoin`: a bank coin of an ERC-20 token back into ERC-20, at any 0x `receiver`. */
export const CONVERT_COIN_TYPE_URL = "/cosmos.evm.erc20.v1.MsgConvertCoin";

interface MsgConvertCoin {
  coin: Coin;
  receiver: string;
  sender: string;
}

const MsgConvertCoinType = {
  encode(m: MsgConvertCoin, w: BinaryWriter = BinaryWriter.create()) {
    if (m.coin) Coin.encode(m.coin, w.uint32(10).fork()).ldelim();
    if (m.receiver) w.uint32(18).string(m.receiver);
    if (m.sender) w.uint32(26).string(m.sender);
    return w;
  },
  decode(input: Uint8Array | BinaryReader) {
    const r = input instanceof BinaryReader ? input : new BinaryReader(input);
    const m: MsgConvertCoin = { coin: Coin.fromPartial({}), receiver: "", sender: "" };
    while (r.pos < r.len) {
      const tag = r.uint32();
      if (tag >>> 3 === 1) m.coin = Coin.decode(r, r.uint32());
      else if (tag >>> 3 === 2) m.receiver = r.string();
      else if (tag >>> 3 === 3) m.sender = r.string();
      else r.skipType(tag & 7);
    }
    return m;
  },
  fromPartial(o: Partial<MsgConvertCoin>): MsgConvertCoin {
    return { coin: Coin.fromPartial(o.coin ?? {}), receiver: o.receiver ?? "", sender: o.sender ?? "" };
  },
};

export const registry = qorechainRegistry([[CONVERT_COIN_TYPE_URL, MsgConvertCoinType as never]]);

/** The message that puts `amount` fUSD (6 decimals) from `sender`'s bank balance into `receiver` as ERC-20. */
export function convertFusdMsg(sender: string, receiver: string, amount: bigint) {
  return { typeUrl: CONVERT_COIN_TYPE_URL, value: { coin: { denom: FUSD_DENOM, amount: amount.toString() }, receiver, sender } };
}

// ------------------------------------------------------------------------- accounts

export type Account = Awaited<ReturnType<typeof useAccount>>;

/**
 * A testnet account from a mnemonic, with what the scripts and relayer need.
 * `maxQor` refuses an account that looks like a real wallet.
 */
export async function useAccount(mnemonicOrAccount: string | UnifiedAccount, opts: { maxQor?: bigint } = {}) {
  const acc = typeof mnemonicOrAccount === "string" ? await deriveUnifiedAccount(mnemonicOrAccount) : mnemonicOrAccount;
  const max = opts.maxQor ?? 50n;
  const uqor = await bankBalance(acc.cosmos, "uqor");
  if (uqor > max * 1_000_000n) throw new Error(`${acc.cosmos} holds more than ${max} QOR. Use a throwaway testnet account.`);
  const hybrid = new EthNativeSigner(acc, { signMode: "hybrid", rest: REST, registry });
  const evm = acc.evm as Hex;

  async function native(label: string, messages: { typeUrl: string; value: unknown }[]): Promise<Included> {
    const a = await rest<{ account: { account_number: string; sequence: string } }>(`/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
    const res = (await hybrid.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber: BigInt(a.account.account_number),
      sequence: BigInt(a.account.sequence),
      fee: NATIVE_FEE,
      messages: messages as never,
      memo: `crumena: ${label}`,
    })) as Included;
    if (res.code !== 0) throw new Error(`${label} failed (code ${res.code}): ${res.rawLog}`);
    return res;
  }

  /** Opens an EVM window, hybrid-signed. With `targets`, only those contracts can be called (no deployments). */
  async function openWindow(targets: string[], maxTxs: number, gasPerTx: bigint, blocks = 600) {
    const maxValue = evmWindowCost({ gas: gasPerTx, maxFeePerGas: MAX_FEE_PER_GAS }) * BigInt(maxTxs);
    return native(`open EVM window (${maxTxs} tx, ${targets.length ? targets.join(",") : "any target"})`, [
      openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue: maxValue.toString(), allowedTargets: targets }),
    ]);
  }

  async function window(): Promise<EvmWindow> {
    return evmWindowStatus({ rest: REST, address: acc.cosmos });
  }

  /** Signs `text` the way QoreX's signArbitrary does; returns the ML-DSA-87 part as 0x hex. */
  function signText(text: string): Hex {
    const sig = signMessage({
      chainId: CHAIN_ID,
      signer: acc.cosmos,
      data: text,
      classicalKey: classicalKeyFromPrivate(hexToBytes(acc.privateKey as Hex), "eth_secp256k1"),
      pqKey: { secretKey: acc.pqc.secretKey },
    });
    if (!sig.pq) throw new Error("no post-quantum signature produced");
    return `0x${Buffer.from(sig.pq.signature, "base64").toString("hex")}`;
  }

  const wallet = createWalletClient({ account: privateKeyToAccount(acc.privateKey as Hex), chain, transport: http(EVM_RPC) });
  return { qor: acc.cosmos, evm, unified: acc, native, openWindow, window, signText, wallet };
}

export async function bankBalance(address: string, denom: string): Promise<bigint> {
  const b = await rest<{ balance?: { amount?: string } }>(`/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`);
  return BigInt(b.balance?.amount ?? "0");
}

export async function hasPqcKey(address: string): Promise<boolean> {
  const r = await rest<{ found?: boolean }>(`/qorechain/pqc/v1/account/${address}`).catch(() => ({ found: false }));
  return r.found === true;
}

/** Registers an account's ML-DSA-87 key with proof of possession: the one message the chain takes with only the classical signature. */
export async function registerPqcKey(acc: UnifiedAccount): Promise<string> {
  const a = await rest<{ account: { account_number: string; sequence: string } }>(`/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
  const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: acc.cosmos, keypair: acc.pqc });
  const res = (await new EthNativeSigner(acc, { signMode: "classical", rest: REST }).signAndBroadcast(transport, {
    chainId: CHAIN_ID,
    accountNumber: BigInt(a.account.account_number),
    sequence: BigInt(a.account.sequence),
    fee: NATIVE_FEE,
    messages: [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession })] as never,
    memo: "crumena: register post-quantum key",
  })) as Included;
  if (res.code !== 0) throw new Error(`Registering the post-quantum key failed (code ${res.code}): ${res.rawLog}`);
  return res.transactionHash;
}

/**
 * The explorer link for a transaction. The explorer (switched to Testnet) finds transactions by their
 * QoreChain hash, so a contract call's 0x hash is looked up first.
 */
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash.replace(/^0x/, "")}`;

/** The QoreChain transaction hash that carried an EVM transaction (what the explorer shows). */
export async function cosmosHashOf(evmHash: string): Promise<string | undefined> {
  const q = encodeURIComponent(`ethereum_tx.ethereumTxHash='${evmHash}'`);
  const r = await rest<{ tx_responses?: { txhash: string }[] }>(`/cosmos/tx/v1beta1/txs?query=${q}`).catch(() => undefined);
  return r?.tx_responses?.[0]?.txhash;
}

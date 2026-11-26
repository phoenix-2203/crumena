/**
 * The two-minute demo: fresh throwaway testnet people (a funder, a spender and a shop), each with a
 * registered ML-DSA-87 key, so anyone can try every role without a wallet. Their keys go to the
 * visitor's browser, which signs the same statements QoreX would. Labelled as demo everywhere.
 *
 * The relayer pays: a little QOR per person for registering their key, and 50 test fUSD into a demo pot.
 */
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { getAddress, type Address } from "viem";
import { CRUMENA_ABI } from "../../shared/crumena-abi";
import { convertFusdMsg, publicClient, registerPqcKey, type Account } from "./chain";

export interface Persona {
  role: "funder" | "spender" | "shop";
  qor: string;
  evm: Address;
  /** secp256k1 key, hex (testnet throwaway, for the demo only). */
  privateKey: string;
  /** ML-DSA-87 secret key, base64 (testnet throwaway, for the demo only). */
  pqSecretKey: string;
}

export const DEMO_QOR_EACH = 300_000n; // uqor: the key registration fee is 0.09 QOR
export const DEMO_POT_FUSD = 50_000_000n; // 50 fUSD (6 decimals)

export function createDemo(opts: {
  relayer: Account;
  crumena: Address;
  exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  perIpPerHour?: number;
  perDay?: number;
}) {
  const funders = new Set<string>(); // demo funders, lowercased 0x
  const fundedPots = new Set<string>();
  const ipHits = new Map<string, number[]>();
  let day = { start: Date.now(), count: 0 };

  function allow(ip: string): string | undefined {
    const now = Date.now();
    if (now - day.start > 86_400_000) day = { start: now, count: 0 };
    if (day.count >= (opts.perDay ?? 100)) return "The demo has been busy today. Try again tomorrow.";
    const list = (ipHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (list.length >= (opts.perIpPerHour ?? 3)) return "You've started a few demos this hour. Keep using the one you have, or try again later.";
    list.push(now);
    ipHits.set(ip, list);
    day.count++;
    return undefined;
  }

  async function start(): Promise<Persona[]> {
    const roles = ["funder", "spender", "shop"] as const;
    const accounts = await Promise.all(roles.map(async () => deriveUnifiedAccount(generateMnemonic(256))));
    await opts.exclusive(() =>
      opts.relayer.native(
        "demo: gas for three demo people",
        accounts.map((a) => ({
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: { fromAddress: opts.relayer.qor, toAddress: a.cosmos, amount: [{ denom: "uqor", amount: DEMO_QOR_EACH.toString() }] },
        })),
      ),
    );
    await Promise.all(accounts.map((a) => registerPqcKey(a)));
    funders.add(accounts[0]!.evm.toLowerCase());
    return accounts.map((a, i) => ({
      role: roles[i]!,
      qor: a.cosmos,
      evm: getAddress(a.evm),
      privateKey: a.privateKey,
      pqSecretKey: Buffer.from(a.pqc.secretKey).toString("base64"),
    }));
  }

  /** Pays 50 test fUSD into a demo funder's pot, once. */
  async function fund(potId: bigint): Promise<string> {
    const pot = (await publicClient.readContract({ address: opts.crumena, abi: CRUMENA_ABI, functionName: "potInfo", args: [potId] })) as {
      funder: Address;
      vault: Address;
    };
    if (!funders.has(pot.funder.toLowerCase())) throw new Error("Only demo pots get demo money.");
    if (fundedPots.has(potId.toString())) throw new Error("This demo pot already got its 50 fUSD.");
    fundedPots.add(potId.toString());
    try {
      const r = await opts.exclusive(() => opts.relayer.native(`demo: 50 fUSD into pot #${potId}`, [convertFusdMsg(opts.relayer.qor, pot.vault, DEMO_POT_FUSD)]));
      return r.transactionHash;
    } catch (e) {
      fundedPots.delete(potId.toString());
      throw e;
    }
  }

  return { allow, start, fund, isDemoFunder: (a: string) => funders.has(a.toLowerCase()) };
}

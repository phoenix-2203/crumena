/**
 * Demo people for the two-minute try-out. The server makes three throwaway testnet accounts with
 * registered ML-DSA-87 keys; their keys live in this browser only, and this signer signs exactly what
 * QoreX's signArbitrary would. Everything a demo person does is a real transaction on testnet.
 */
import { hexToBytes, type Address, type Hex } from "viem";
import { CHAIN_ID, type Me, type Qorex } from "./qorex";

export type Role = "funder" | "spender" | "shop";
export interface Persona {
  role: Role;
  qor: string;
  evm: Address;
  privateKey: string;
  pqSecretKey: string;
}

const KEY = "crumena:demo";
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function loadDemo(storage: Pick<Storage, "getItem"> = localStorage): Persona[] | undefined {
  try {
    const v = storage.getItem(KEY);
    return v ? (JSON.parse(v) as Persona[]) : undefined;
  } catch {
    return undefined;
  }
}

export function saveDemo(people: Persona[] | undefined, storage: Pick<Storage, "setItem" | "removeItem"> = localStorage) {
  try {
    if (people) storage.setItem(KEY, JSON.stringify(people));
    else storage.removeItem(KEY);
  } catch {
    /* private mode: the demo lasts this visit */
  }
}

export async function startDemo(base = "", f: typeof fetch = fetch): Promise<Persona[]> {
  const r = await f(`${base}/api/demo/start`, { method: "POST" });
  const body = (await r.json().catch(() => ({}))) as { personas?: Persona[]; error?: string };
  if (!r.ok || !body.personas) throw new Error(body.error ?? "Couldn't start the demo. Try again in a moment.");
  return body.personas;
}

export async function fundDemoPot(potId: bigint, base = "", f: typeof fetch = fetch): Promise<string> {
  const r = await f(`${base}/api/demo/fund/${potId}`, { method: "POST" });
  const body = (await r.json().catch(() => ({}))) as { tx?: string; error?: string };
  if (!r.ok || !body.tx) throw new Error(body.error ?? "Couldn't add the demo money.");
  return body.tx;
}

export const meOfPersona = (p: Persona): Me => ({ qor: p.qor, evm: p.evm, kind: "ethereum" });

/** A stand-in for QoreX that signs as one demo person, the same way QoreX does. */
export function demoSigner(p: Persona): Qorex {
  return {
    native: {
      capabilities: ["signArbitrary"],
      enable: async () => undefined,
      getKey: async () => ({ algo: "ethsecp256k1", bech32Address: p.qor }),
      signArbitrary: async (_chain, signer, data) => {
        if (signer !== p.qor) throw new Error("Wrong demo person.");
        const { classicalKeyFromPrivate, signMessage } = await import("@qorechain/qoresign"); // loaded only when a demo person signs
        const sig = signMessage({
          chainId: CHAIN_ID,
          signer: p.qor,
          data,
          classicalKey: classicalKeyFromPrivate(hexToBytes(p.privateKey as Hex), "eth_secp256k1"),
          pqKey: { secretKey: b64(p.pqSecretKey) },
        });
        return { signatureType: sig.signatureType, pq: sig.pq };
      },
    },
  };
}

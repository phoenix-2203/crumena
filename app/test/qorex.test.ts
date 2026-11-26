import { describe, expect, it, vi } from "vitest";
import { connect, findQorex, signStatement, transferToPot, type Qorex } from "../src/lib/qorex";

const QOR = "qor168yduth9d3hksddsd54qjt06v9gw9wn40yeg4h";
const EVM = "0xD1C8dE2EE56c6F6835B06D2A092DFa6150E2ba75";
const b64 = (n: number, fill = 7) => btoa(String.fromCharCode(...new Uint8Array(n).fill(fill)));

function fake(over: Partial<Qorex["native"]> = {}, algo = "ethsecp256k1"): Qorex {
  return {
    native: {
      capabilities: ["signArbitrary"],
      enable: vi.fn(async () => undefined),
      getKey: vi.fn(async () => ({ algo, bech32Address: QOR })),
      signArbitrary: vi.fn(async () => ({ signatureType: "ml-dsa-87-hybrid", pq: { algorithmId: 1, signature: b64(4627) } })),
      ...over,
    },
    evm: { request: vi.fn(async ({ method }: { method: string }) => (method === "eth_chainId" ? "0x2648" : "0xabc")) },
  };
}

describe("connect", () => {
  it("reports the account in both forms", async () => {
    expect(await connect(fake())).toEqual({ qor: QOR, evm: EVM, kind: "ethereum" });
    expect((await connect(fake({}, "secp256k1"))).kind).toBe("main");
  });
  it("says to install QoreX when it's missing", async () => {
    await expect(connect(undefined)).rejects.toMatchObject({ code: "NOT_INSTALLED" });
    expect(await findQorex({}, 0)).toBeUndefined();
  });
});

describe("signStatement", () => {
  const me = { qor: QOR, evm: EVM, kind: "ethereum" } as const;

  it("returns the bare 4627-byte ML-DSA-87 signature as hex, signed over the exact statement", async () => {
    const q = fake();
    const sig = await signStatement(q, me, "Crumena: pay from pot #1");
    expect(sig).toMatch(/^0x(07){4627}$/);
    expect(q.native.signArbitrary).toHaveBeenCalledWith("qorechain-diana", QOR, "Crumena: pay from pot #1");
  });
  it("won't sign if QoreX switched account since sign-in", async () => {
    const q = fake({ getKey: vi.fn(async () => ({ algo: "ethsecp256k1", bech32Address: "qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh" })) });
    await expect(signStatement(q, me, "x")).rejects.toMatchObject({ code: "WRONG_ACCOUNT" });
    expect(q.native.signArbitrary).not.toHaveBeenCalled();
  });
  it("turns a cancel into a plain message", async () => {
    const q = fake({ signArbitrary: vi.fn(async () => Promise.reject(new Error("User rejected the request"))) });
    await expect(signStatement(q, me, "x")).rejects.toMatchObject({ code: "REJECTED" });
  });
  it("refuses a classical-only or wrong-size signature", async () => {
    await expect(signStatement(fake({ signArbitrary: vi.fn(async () => ({ signatureType: "secp256k1" })) }), me, "x")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(signStatement(fake({ signArbitrary: vi.fn(async () => ({ signatureType: "ml-dsa-87-hybrid", pq: { algorithmId: 1, signature: b64(64) } })) }), me, "x")).rejects.toMatchObject({ code: "FAILED" });
  });
  it("says to update an old QoreX", async () => {
    await expect(signStatement(fake({ capabilities: [] }), me, "x")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

describe("transferToPot", () => {
  it("sends an ERC-20 transfer to the pot's address from an Ethereum account", async () => {
    const q = fake();
    await transferToPot(q, { qor: QOR, evm: EVM, kind: "ethereum" }, "0x97143B771D34ddb9130b807b135Ae675A5a963CA", EVM, 5n);
    const call = (q.evm!.request as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(call.method).toBe("eth_sendTransaction");
    expect(call.params[0].data.slice(0, 10)).toBe("0xa9059cbb");
  });
  it("refuses for a main account", async () => {
    await expect(transferToPot(fake(), { qor: QOR, evm: EVM, kind: "main" }, EVM, EVM, 5n)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

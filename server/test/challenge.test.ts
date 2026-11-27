import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeFunctionData, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRUMENA_ABI } from "../../shared/crumena-abi";

// The challenge talks to the chain through ./chain; here the chain is a stand-in that answers reads and signs
// with a marker, so each attack's call can be checked exactly, without testnet.
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Hex;
const PEOPLE: Record<string, Hex> = { funder: addr(1), spender: addr(2), payee: addr(3), capped: addr(4), outsider: addr(5) };
vi.mock("../src/chain", () => ({
  FUSD: "0x97143B771D34ddb9130b807b135Ae675A5a963CA",
  convertFusdMsg: vi.fn(),
  registerPqcKey: vi.fn(),
  useAccount: vi.fn(async (m: string) => ({ evm: PEOPLE[m]!, qor: `qor1${m}`, signText: (t: string) => `0x${Buffer.from(`${m}:${t.length}`).toString("hex")}` as Hex })),
  publicClient: {
    getBlockNumber: vi.fn(async () => 1234n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "nonceOf") return 7n;
      if (functionName === "potBalance") return 24_990_000n;
      if (functionName === "potInfo") return { paidOut: 10_000n, vault: addr(9) };
      return `statement from ${functionName}`;
    }),
  },
}));

const { ATTACKS, createChallenge } = await import("../src/challenge");
const { RelayError } = await import("../src/relay");

function setup(opts: { simulate?: (data: Hex) => Promise<bigint>; withHonest?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "challenge-"));
  const file = pathToFileURL(join(dir, "challenge.json"));
  const saved = {
    potId: "7",
    vault: addr(9),
    people: Object.fromEntries(Object.keys(PEOPLE).map((k) => [k, k])),
    stats: { refused: {}, honest: 0, gotThrough: 0 },
    ...(opts.withHonest ? { lastHonest: { args: ["7", PEOPLE.payee, "10000", "", PEOPLE.spender, { nonce: "3", validUntil: "1", signature: "0x01" }], hash: "0xabc" } } : {}),
  };
  writeFileSync(file, JSON.stringify(saved));
  const sent: Hex[] = [];
  const simulated: Hex[] = [];
  const ch = createChallenge({
    relayer: {} as never,
    crumena: addr(100),
    relay: async (data) => (sent.push(data), { hash: "0xpaid", block: 99, fn: "pay" }),
    simulate: async (data) => (simulated.push(data), (opts.simulate ?? refuse("NotApproved"))(data)),
    exclusive: (w) => w(),
    file,
    log: () => {},
  });
  return { ch, file, sent, simulated };
}
const refuse = (reason: string) => async () => {
  throw new RelayError("refused", 400, reason);
};
const decode = (data: Hex) => decodeFunctionData({ abi: CRUMENA_ABI, data });

describe("the public challenge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs each attack against the contract, never sends it, and counts the refusal", async () => {
    const { ch, file, sent } = setup({ simulate: refuse("BadPqcSignature") });
    const r = await ch.attempt("tamper");
    expect(r).toMatchObject({ attack: "tamper", refused: true, reason: "BadPqcSignature", block: "1234" });
    expect(r.explanation).toMatch(/post-quantum signature doesn't match/);
    expect(sent).toEqual([]);
    const stats = JSON.parse(readFileSync(file, "utf8")).stats;
    expect(stats.refused.tamper).toBe(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((await ch.state()).refused).toBe(1);
  });

  it("builds each attack as the call an attacker would make", async () => {
    const { ch, simulated } = setup();
    const calls: Record<string, ReturnType<typeof decode>> = {};
    for (const a of Object.keys(ATTACKS) as (keyof typeof ATTACKS)[]) {
      if (a === "replay") continue;
      await ch.attempt(a);
      calls[a] = decode(simulated.at(-1)!);
    }
    const arg = (a: string, i: number) => (calls[a]!.args as readonly unknown[])[i];
    // a properly signed payment to the visitor's own (unapproved) address
    expect(calls.payStranger!.functionName).toBe("pay");
    expect(arg("payStranger", 1)).toBe(PEOPLE.outsider);
    // 6 fUSD against a 5 fUSD cap; 2 fUSD to the payee approved for 1
    expect(arg("overCap", 2)).toBe(6_000_000n);
    expect([arg("overPayee", 1), arg("overPayee", 2)]).toEqual([PEOPLE.capped, 2_000_000n]);
    // signed for 0.01, sent as 4.99
    expect(arg("tamper", 2)).toBe(4_990_000n);
    // signed by the outsider's key
    expect((arg("wrongKey", 5) as { signature: Hex }).signature).toBe(`0x${Buffer.from(`outsider:${"statement from payStatement".length}`).toString("hex")}`);
    // the funder's actions, signed by the spender
    expect(calls.approveSelf!.functionName).toBe("addPayee");
    expect(arg("approveSelf", 1)).toBe(PEOPLE.outsider);
    expect((arg("approveSelf", 4) as { signature: Hex }).signature.startsWith(`0x${Buffer.from("spender:").toString("hex")}`)).toBe(true);
    expect(calls.takeAll!.functionName).toBe("release");
  });

  it("says so plainly if the contract would accept an attack, and doesn't send it", async () => {
    const { ch, sent, file } = setup({ simulate: async () => 100_000n });
    const r = await ch.attempt("overCap");
    expect(r.refused).toBe(false);
    expect(r.explanation).toMatch(/would have accepted/);
    expect(sent).toEqual([]);
    expect(JSON.parse(readFileSync(file, "utf8")).stats.gotThrough).toBe(1);
  });

  it("passes a network failure on as one, without counting it", async () => {
    const { ch, file } = setup({
      simulate: async () => {
        throw new Error("fetch failed");
      },
    });
    await expect(ch.attempt("overCap")).rejects.toThrow("fetch failed");
    expect(JSON.parse(readFileSync(file, "utf8")).stats.refused).toEqual({});
  });

  it("replays the last honest payment exactly, even after a restart (read back from the file)", async () => {
    const { ch, simulated } = setup({ withHonest: true, simulate: refuse("BadNonce") });
    const r = await ch.attempt("replay");
    expect(r).toMatchObject({ refused: true, reason: "BadNonce" });
    const call = decode(simulated[0]!);
    expect(call.functionName).toBe("pay");
    expect([call.args[0], call.args[1], call.args[2]]).toEqual([7n, PEOPLE.payee, 10_000n]);
    expect((call.args[5] as { nonce: bigint }).nonce).toBe(3n);
  });

  it("needs an earlier payment before it can replay one", async () => {
    await expect(setup().ch.attempt("replay")).rejects.toMatchObject({ status: 409 });
  });

  it("sends the honest payment for real and keeps it for replay", async () => {
    const { ch, sent, file } = setup();
    const r = await ch.honest();
    expect(r).toMatchObject({ attack: "honest", refused: false, hash: "0xpaid" });
    const call = decode(sent[0]!);
    expect(call.functionName).toBe("pay");
    expect([call.args[1], call.args[2]]).toEqual([PEOPLE.payee, 10_000n]);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.stats.honest).toBe(1);
    expect(saved.lastHonest.hash).toBe("0xpaid");
  });
});

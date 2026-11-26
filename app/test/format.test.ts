import { describe, expect, it } from "vitest";
import { parseUnits, printable, toEvm, toQor, units } from "../src/lib/format";

// The same pairs contracts/test/Statements.t.sol checks the contract's own conversion against.
const PAIRS = [
  ["0x7448BF4A7963E81AB4f93B118159A91b7caD9b22", "qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh"],
  ["0xD1C8dE2EE56c6F6835B06D2A092DFa6150E2ba75", "qor168yduth9d3hksddsd54qjt06v9gw9wn40yeg4h"],
  ["0xd3caC5c7F01f746fa3d1843fdc389643a52d8DfC", "qor1609vt3lsra6xlg73sslacwykgwjjmr0ua0tccg"],
] as const;

describe("addresses", () => {
  it.each(PAIRS)("matches the contract: %s ↔ %s", (evm, qor) => {
    expect(toQor(evm)).toBe(qor);
    expect(toEvm(qor)).toBe(evm);
    expect(toEvm(evm.toLowerCase())).toBe(evm);
  });
  it("refuses other chains and junk with a plain message", () => {
    expect(() => toEvm("cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a")).toThrow(/QoreChain|isn't/);
    expect(() => toEvm("hello")).toThrow(/isn't a QoreChain address/);
  });
});

describe("amounts", () => {
  it("prints like the contract's statements", () => {
    expect(units(250_500_000n, 6)).toBe("250.5");
    expect(units(25_000_000n, 6)).toBe("25");
    expect(units(1n, 6)).toBe("0.000001");
  });
  it("parses what people type", () => {
    expect(parseUnits("1,250.5", 6)).toBe(1_250_500_000n);
    expect(parseUnits(" 25 ", 6)).toBe(25_000_000n);
    expect(() => parseUnits("0", 6)).toThrow(/above zero/);
    expect(() => parseUnits("1.0000001", 6)).toThrow(/decimal places/);
    expect(() => parseUnits("-3", 6)).toThrow(/amount like/);
    expect(() => parseUnits("1e6", 6)).toThrow(/amount like/);
  });
});

it("accepts only printable ASCII, like the contract", () => {
  expect(printable("PO-1042 materials")).toBe(true);
  expect(printable("line\nbreak")).toBe(false);
  expect(printable("Pаypal")).toBe(false); // Cyrillic а
});

it("prints dates like the contract (minutes, UTC)", async () => {
  const { utc } = await import("../src/lib/format");
  expect(utc(1_795_683_600n)).toBe("2026-11-26 09:00 UTC"); // START in contracts/test/Base.t.sol
  expect(utc(1_795_683_659)).toBe("2026-11-26 09:00 UTC");
});

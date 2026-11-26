import { bech32 } from "@scure/base";
import { getAddress, isAddress, type Address } from "viem";

/** `qor1…` for a 20-byte account. QoreChain's two address forms share the same bytes. */
export function toQor(address: string): string {
  const hex = getAddress(address).slice(2);
  const bytes = Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  return bech32.encode("qor", bech32.toWords(bytes));
}

/** `0x…` for a `qor1…` or `0x…` address; throws a plain message on anything else. */
export function toEvm(address: string): Address {
  const a = address.trim();
  if (isAddress(a, { strict: false })) return getAddress(a);
  let decoded;
  try {
    decoded = bech32.decode(a as `${string}1${string}`);
  } catch {
    throw new Error("That isn't a QoreChain address (qor1…) or a 0x address.");
  }
  if (decoded.prefix !== "qor") throw new Error("That address isn't for QoreChain (it should start with qor1).");
  const bytes = bech32.fromWords(decoded.words);
  if (bytes.length !== 20) throw new Error("That address is the wrong length for an account.");
  return getAddress(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
}

export const short = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);

/** Whole units with trailing zeros trimmed, e.g. 250500000 at 6 decimals → "250.5". Matches the contract's statements. */
export function units(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  let frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Parses what a person types ("1,250.5") into base units; throws a plain message if it can't. */
export function parseUnits(input: string, decimals: number): bigint {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter an amount like 25 or 12.50.");
  const [whole, frac = ""] = s.split(".") as [string, string?];
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const v = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  if (v === 0n) throw new Error("Enter an amount above zero.");
  return v;
}

/** Same rule as the contract: plain printable ASCII only, so a statement can't gain lines or look-alike letters. */
export function printable(s: string): boolean {
  return /^[\x20-\x7e]*$/.test(s);
}

export const fromUnix = (t: bigint | number) => new Date(Number(t) * 1000);
export const toUnix = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));

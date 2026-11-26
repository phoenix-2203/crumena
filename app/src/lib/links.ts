/**
 * Short pot links. A pot's code is the first 8 bytes of its vault address, written in base58
 * (about 11 characters, e.g. #/p/7GqzTb3KxWd). The contract maps each code to its pot (potOfCode),
 * and the app checks the code against the pot's vault before showing it. Codes aren't secret,
 * since everything about a pot is public on chain; they just aren't a counter like #/pot/1, #/pot/2.
 */
import { base58 } from "@scure/base";
import type { Address, Hex } from "viem";

export function potCode(vault: Address): string {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = parseInt(vault.slice(2 + i * 2, 4 + i * 2), 16);
  return base58.encode(bytes);
}

/** The 0x-hex form the contract takes, or undefined if `code` isn't a valid pot code. */
export function codeToHex(code: string): Hex | undefined {
  try {
    const bytes = base58.decode(code);
    if (bytes.length !== 8) return undefined;
    return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return undefined;
  }
}

export const potPath = (vault: Address) => `/p/${potCode(vault)}`;
export const potHref = (vault: Address) => `#${potPath(vault)}`;
export const potUrl = (vault: Address) => `${location.origin}${location.pathname}${potHref(vault)}`;

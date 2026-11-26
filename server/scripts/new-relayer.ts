/**
 * Makes the relayer's throwaway testnet account on this machine, once: writes RELAYER_MNEMONIC to
 * server/.env (readable by its owner only) and prints only the address to fund. The phrase is never shown.
 *   node --import tsx scripts/new-relayer.ts
 */
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const file = new URL("../.env", import.meta.url);
const current = existsSync(file) ? readFileSync(file, "utf8") : "";
let phrase = /^RELAYER_MNEMONIC="([^"]+)"/m.exec(current)?.[1];
if (!phrase) {
  phrase = generateMnemonic(256);
  writeFileSync(file, `${current}${current && !current.endsWith("\n") ? "\n" : ""}RELAYER_MNEMONIC="${phrase}"\n`);
  chmodSync(file, 0o600);
}
const a = await deriveUnifiedAccount(phrase);
console.log(a.cosmos);

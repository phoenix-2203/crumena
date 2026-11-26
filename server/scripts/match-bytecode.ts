/**
 * Shows the deployed contract is this source. QoreChain's explorer has no source verification yet, so:
 * deploy the committed bytecode on a local chain with the same constructor arguments, then compare the
 * runtime code with the code at the testnet address. Needs anvil (Foundry).
 *   pnpm --filter @crumena/server exec node --import tsx scripts/match-bytecode.ts
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CRUMENA_ABI, CRUMENA_BYTECODE } from "../../shared/crumena-abi";
import { CHAIN_ID, EVM_CHAIN_ID, publicClient } from "../src/chain";

const deployment = JSON.parse(readFileSync(new URL("../../deployments/testnet.json", import.meta.url), "utf8")) as { Crumena: Hex };
const port = 18000 + Math.floor(Math.random() * 1000);
const anvil = spawn("anvil", ["--port", String(port), "--chain-id", String(EVM_CHAIN_ID), "--silent", "--code-size-limit", "50000"], { stdio: "ignore" });
try {
  const chain = { id: EVM_CHAIN_ID, name: "local", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } } } as const;
  const local = createPublicClient({ chain, transport: http() });
  for (let i = 0; i < 50; i++) await local.getBlockNumber().then(() => (i = 99), () => new Promise((r) => setTimeout(r, 100)));
  const wallet = createWalletClient({ chain, account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"), transport: http() });
  const r = await local.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: CRUMENA_ABI, bytecode: CRUMENA_BYTECODE, args: [CHAIN_ID, BigInt(EVM_CHAIN_ID)] }) });
  const mine = await local.getCode({ address: r.contractAddress! });
  const live = await publicClient.getCode({ address: deployment.Crumena });
  console.log(`built here:  ${keccak256(mine!)} (${(mine!.length - 2) / 2} bytes)`);
  console.log(`on testnet:  ${keccak256(live!)} (${(live!.length - 2) / 2} bytes) at ${deployment.Crumena}`);
  console.log(mine === live ? "MATCH: the testnet contract is this source." : "DIFFERENT");
  if (mine !== live) process.exitCode = 1;
} finally {
  anvil.kill();
}

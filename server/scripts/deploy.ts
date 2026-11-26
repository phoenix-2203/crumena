/**
 * Deploy Crumena to the QoreChain TESTNET from a throwaway account:
 *
 *   pnpm --filter @crumena/server deploy:testnet
 *
 * The phrase is read from server/.env.seed (git-ignored) as E2E_MNEMONIC="…".
 * Never use a phrase that holds real funds. The script:
 * 1. checks the account looks like a throwaway (at most 200 QOR) and has its
 *    ML-DSA-87 key registered (registering it if not);
 * 2. opens a 1-transaction EVM window, hybrid-signed (a scoped window refuses
 *    contract creation, so this one has no targets), and deploys;
 * 3. reads the deployed contract back and writes deployments/testnet.json.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { getAddress } from "viem";
import { CRUMENA_ABI, CRUMENA_BYTECODE } from "../../shared/crumena-abi";
import { CHAIN_ID, EVM_CHAIN_ID, MAX_FEE_PER_GAS, PRIORITY_FEE, explorerTx, hasPqcKey, publicClient, registerPqcKey, useAccount } from "../src/chain";

const GAS = 6_000_000n;
const mnemonic = process.env.E2E_MNEMONIC?.trim();
if (!mnemonic) throw new Error('Put a THROWAWAY testnet phrase in server/.env.seed as E2E_MNEMONIC="…".');

const me = await useAccount(mnemonic, { maxQor: 200n });
console.log(`Deploying Crumena from ${me.qor} (${me.evm}) to ${CHAIN_ID}`);
if (!(await hasPqcKey(me.qor))) {
  console.log(`  registering its ML-DSA-87 key: ${await registerPqcKey(me.unified)}`);
  await new Promise((r) => setTimeout(r, 3000));
}

const win = await me.openWindow([], 1, GAS, 100);
console.log(`  EVM window (1 tx): ${explorerTx(win.transactionHash)}`);
await new Promise((r) => setTimeout(r, 4000));

const hash = await me.wallet.deployContract({
  account: me.wallet.account!,
  chain: me.wallet.chain,
  abi: CRUMENA_ABI,
  bytecode: CRUMENA_BYTECODE,
  args: [CHAIN_ID, BigInt(EVM_CHAIN_ID)],
  gas: GAS,
  maxFeePerGas: MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: PRIORITY_FEE,
});
const rcpt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (rcpt.status !== "success" || !rcpt.contractAddress) throw new Error(`Deployment failed: ${hash}`);
const address = getAddress(rcpt.contractAddress);
console.log(`  deployed: ${address} (tx ${hash}, block ${rcpt.blockNumber}, ${rcpt.gasUsed} gas)`);

const [name, evmChainId, count] = await Promise.all([
  publicClient.readContract({ address, abi: CRUMENA_ABI, functionName: "chainName" }),
  publicClient.readContract({ address, abi: CRUMENA_ABI, functionName: "evmChainId" }),
  publicClient.readContract({ address, abi: CRUMENA_ABI, functionName: "potCount" }),
]);
if (name !== CHAIN_ID || evmChainId !== BigInt(EVM_CHAIN_ID) || count !== 0n) throw new Error("the deployed contract doesn't read back as expected");

const commit = (() => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
})();
mkdirSync(new URL("../../deployments", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../../deployments/testnet.json", import.meta.url),
  JSON.stringify(
    {
      chainId: CHAIN_ID,
      evmChainId: EVM_CHAIN_ID,
      Crumena: address,
      deployTx: hash,
      block: Number(rcpt.blockNumber),
      deployer: me.qor,
      window: win.transactionHash,
      compiler: "solc 0.8.28, optimizer 200 runs, via-IR, evm cancun (contracts/foundry.toml)",
      sourceCommit: commit,
    },
    null,
    2,
  ) + "\n",
);
console.log("\nWrote deployments/testnet.json.");

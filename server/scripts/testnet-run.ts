/**
 * The live testnet run: Crumena end to end on qorechain-diana, with real ML-DSA-87
 * signatures checked by the chain's own precompiles, then the attacks it must stop.
 *
 *   pnpm --filter @crumena/server testnet:run
 *
 * Uses the throwaway account in server/.env.seed (E2E_MNEMONIC), which needs about
 * 3 test QOR and 150 test fUSD from the faucet. It makes four fresh accounts (a
 * funder, the person who spends the pot, two shops) and an attacker, so every run
 * starts clean. Results go to drill-results/testnet-run.json (git-ignored).
 */
import { EthNativeSigner, deriveUnifiedAccount, generateMnemonic, openEvmWindowMsg } from "@qorechain/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { messagePqSignBytes, pqVerify } from "@qorechain/qoresign";
import { decodeAbiParameters, encodeFunctionData, getAddress, hexToBytes, parseAbi, type Hex } from "viem";
import { CRUMENA_ABI } from "../../shared/crumena-abi";
import {
  CHAIN_ID,
  FUSD,
  FUSD_DENOM,
  MAX_FEE_PER_GAS,
  NATIVE_FEE,
  PRIORITY_FEE,
  REST,
  convertFusdMsg,
  cosmosHashOf,
  explorerTx,
  publicClient,
  registerPqcKey,
  rest,
  transport,
  useAccount,
  type Account,
} from "../src/chain";
import { createRelayer, revertName } from "../src/relay";

const deployment = JSON.parse(readFileSync(new URL("../../deployments/testnet.json", import.meta.url), "utf8")) as { Crumena: Hex };
const CRUMENA = getAddress(deployment.Crumena);
const mnemonic = process.env.E2E_MNEMONIC?.trim();
if (!mnemonic) throw new Error('Put a THROWAWAY testnet phrase in server/.env.seed as E2E_MNEMONIC="…".');

type Step = { step: string; ok: boolean; detail: string; tx?: string };
const steps: Step[] = [];
function record(step: string, ok: boolean, detail: string, tx?: string) {
  steps.push({ step, ok, detail, tx });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}\n      ${detail}${tx ? `\n      ${tx.startsWith("0x") ? `EVM tx ${tx}` : explorerTx(tx)}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FUSD_UNIT = 1_000_000n;
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const fusdOf = (a: Hex) => publicClient.readContract({ address: FUSD, abi: erc20, functionName: "balanceOf", args: [a] });
const read = <T>(functionName: string, args: unknown[]) =>
  publicClient.readContract({ address: CRUMENA, abi: CRUMENA_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;

// ------------------------------------------------------------------ the cast

const main = await useAccount(mnemonic, { maxQor: 200n });
const relayer = createRelayer(main, CRUMENA, (s) => console.log(`      relayer: ${s}`));
console.log(`Crumena ${CRUMENA} on ${CHAIN_ID}\n  run by ${main.qor}\n`);

async function fresh(label: string, withKey: boolean, uqor = 400_000n): Promise<Account> {
  const u = await deriveUnifiedAccount(generateMnemonic(256));
  await main.native(`fund ${label}`, [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: main.qor, toAddress: u.cosmos, amount: [{ denom: "uqor", amount: uqor.toString() }] } }]);
  if (withKey) await registerPqcKey(u);
  const a = await useAccount(u);
  console.log(`  ${label}: ${a.qor} (${a.evm})${withKey ? ", ML-DSA-87 key registered" : ""}`);
  return a;
}

const funder = await fresh("funder", true, 1_500_000n);
const spender = await fresh("spends the pot", true);
const firstPayNonce = await read<bigint>("nonceOf", [spender.evm]);
const shopA = await fresh("Halden Building Supplies", true);
const shopB = await fresh("Brightline Electrical", false);
const attacker = await fresh("attacker", true);
console.log();

const until = () => BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonce = (a: Account) => read<bigint>("nonceOf", [a.evm]);

async function relay(fn: string, args: unknown[]) {
  const data = encodeFunctionData({ abi: CRUMENA_ABI, functionName: fn as never, args: args as never });
  return relayer.relay(data);
}

/** The relayer refuses before sending; returns the contract's reason. */
async function refused(fn: string, args: unknown[]): Promise<string | undefined> {
  try {
    await relay(fn, args);
    return undefined;
  } catch (e) {
    return (e as { reason?: string }).reason ?? revertName(e) ?? (e as Error).message;
  }
}

// ----------------------------------------------------------------- 1. create

const newPot = {
  funder: funder.evm,
  recipient: spender.evm,
  token: FUSD,
  endsAt: BigInt(Math.floor(Date.now() / 1000) + 14 * 86400),
  confirmedOnly: false,
  rules: { maxPerPayment: 30n * FUSD_UNIT, periodLimit: 60n * FUSD_UNIT, periodDays: 7 },
  purpose: "Office fit-out, phase 1",
  payees: [shopA.evm],
  names: ["Halden Building Supplies"],
  limits: [60n * FUSD_UNIT], // the most Halden may receive from this pot, in total
};
let n = await nonce(funder);
let v = until();
const createText = await read<string>("createStatement", [newPot, n, v]);
const created = await relay("createPot", [newPot, { nonce: n, validUntil: v, signature: funder.signText(createText) }]);
const potId = BigInt(created.potId!);
const pot = await read<{ vault: Hex; funder: Hex }>("potInfo", [potId]);
record("Funder creates a pot, signed with ML-DSA-87 and checked by pqcVerify", true, `pot #${potId}, vault ${pot.vault}, one approved payee (up to 60 fUSD)`, created.hash);
const code = pot.vault.slice(0, 18) as Hex;
const byCode = await read<bigint>("potOfCode", [code]);
record("The pot's short link code (the first 8 bytes of its vault) finds it", byCode === potId, `potOfCode(${code}) = ${byCode}`);

// ------------------------------------------------------------------- 2. fund

await main.native("fUSD to the funder", [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: main.qor, toAddress: funder.qor, amount: [{ denom: FUSD_DENOM, amount: (100n * FUSD_UNIT).toString() }] } }]);
const paidIn = await funder.native("pay into the pot", [convertFusdMsg(funder.qor, pot.vault, 100n * FUSD_UNIT)]);
await sleep(2000);
const bal = await read<bigint>("potBalance", [potId]);
record("Funder pays 100 fUSD into the pot's address from the bank lane (MsgConvertCoin, hybrid-signed)", bal === 100n * FUSD_UNIT, `pot balance ${bal / FUSD_UNIT} fUSD`, paidIn.transactionHash);

// --------------------------------------------------------------------- 3. pay

n = await nonce(spender);
v = until();
const payText = await read<string>("payStatement", [potId, shopA.evm, 25n * FUSD_UNIT, "PO-1042 materials", spender.evm, n, v]);
const paySig = spender.signText(payText);
const payUntil = v;
const paid = await relay("pay", [potId, shopA.evm, 25n * FUSD_UNIT, "PO-1042 materials", spender.evm, { nonce: n, validUntil: v, signature: paySig }]);
record("The person spending the pot pays the approved shop 25 fUSD, post-quantum signed", (await fusdOf(shopA.evm)) === 25n * FUSD_UNIT, `shop received 25 fUSD; the spender sent no transaction and paid no gas`, paid.hash);

// The same check, done independently of the contract (what the app's "Verify" does in the browser): the statement
// as of the block before, the signer's key from pqcKeyStatus at that block, and ML-DSA-87 verification here.
{
  const rcpt = await publicClient.getTransactionReceipt({ hash: paid.hash });
  const before = rcpt.blockNumber - 1n;
  const text = (await publicClient.readContract({
    address: CRUMENA,
    abi: CRUMENA_ABI,
    functionName: "payStatement",
    args: [potId, shopA.evm, 25n * FUSD_UNIT, "PO-1042 materials", spender.evm, firstPayNonce, payUntil],
    blockNumber: before,
  })) as string;
  const status = await publicClient.call({
    to: "0x0000000000000000000000000000000000000a02",
    data: encodeFunctionData({ abi: parseAbi(["function pqcKeyStatus(address)"]), functionName: "pqcKeyStatus", args: [spender.evm] }),
    blockNumber: before,
  });
  const [, , key] = decodeAbiParameters([{ type: "bool" }, { type: "uint8" }, { type: "bytes" }, { type: "bool" }], status.data!);
  const valid = pqVerify(hexToBytes(key), messagePqSignBytes(CHAIN_ID, text), hexToBytes(paySig));
  const changed = pqVerify(hexToBytes(key), messagePqSignBytes(CHAIN_ID, text.replace("Amount: 25 ", "Amount: 26 ")), hexToBytes(paySig));
  record(
    "Independent check of that payment: statement and key read from the chain at the block before, ML-DSA-87 verified off chain",
    valid && !changed,
    `signature valid: ${valid}; the same signature over "Amount: 26": ${changed}`,
  );
}

// --------------------------------------------------------- 4. payee confirms

n = await nonce(shopA);
v = until();
const confirmText = await read<string>("confirmPayeeStatement", [potId, shopA.evm, n, v]);
const confirmed = await relay("confirmPayee", [potId, shopA.evm, { nonce: n, validUntil: v, signature: shopA.signText(confirmText) }]);
record("The shop confirms the address is its own, with its own ML-DSA-87 key", true, "payee marked confirmed on chain", confirmed.hash);

// ------------------------------------------------- 5. request, approve, pay

n = await nonce(spender);
v = until();
const reqText = await read<string>("requestPayeeStatement", [potId, shopB.evm, "Brightline Electrical", 15n * FUSD_UNIT, n, v]);
const requested = await relay("requestPayee", [potId, shopB.evm, "Brightline Electrical", 15n * FUSD_UNIT, { nonce: n, validUntil: v, signature: spender.signText(reqText) }]);
const asked = (await read<{ asked: bigint }>("payeeInfo", [potId, shopB.evm])).asked;
record("The spender asks the funder to approve a new shop, for 15 fUSD", asked === 15n * FUSD_UNIT, "request recorded with its amount; the pot still can't pay it", requested.hash);

n = await nonce(funder);
v = until();
const addText = await read<string>("addPayeeStatement", [potId, shopB.evm, "Brightline Electrical", 12n * FUSD_UNIT, n, v]);
const added = await relay("addPayee", [potId, shopB.evm, "Brightline Electrical", 12n * FUSD_UNIT, { nonce: n, validUntil: v, signature: funder.signText(addText) }]);
const limitB = (await read<{ limit: bigint }>("payeeInfo", [potId, shopB.evm])).limit;
record("The funder approves it up to 12 fUSD, an amount of its own choice, post-quantum signed", limitB === 12n * FUSD_UNIT, "Brightline Electrical approved, up to 12 fUSD in total", added.hash);

n = await nonce(spender);
v = until();
const pay2Text = await read<string>("payStatement", [potId, shopB.evm, 10n * FUSD_UNIT, "", spender.evm, n, v]);
const paid2 = await relay("pay", [potId, shopB.evm, 10n * FUSD_UNIT, "", spender.evm, { nonce: n, validUntil: v, signature: spender.signText(pay2Text) }]);
record("The spender pays the new shop 10 fUSD", (await fusdOf(shopB.evm)) === 10n * FUSD_UNIT, "a shop with no post-quantum key of its own can still be paid", paid2.hash);

n = await nonce(spender);
v = until();
const overShopText = await read<string>("payStatement", [potId, shopB.evm, 5n * FUSD_UNIT, "", spender.evm, n, v]);
const overShop = await refused("pay", [potId, shopB.evm, 5n * FUSD_UNIT, "", spender.evm, { nonce: n, validUntil: v, signature: spender.signText(overShopText) }]);
record("Rule: a payment past what the funder approved for that shop is refused, even properly signed", overShop === "OverPayeeLimit", `refused: ${overShop} (2 fUSD left for this shop)`);

// ------------------------------------------------------------------ 6. attacks

// a. With only the funder's classical key, the chain won't open an EVM window.
const classicalOnly = new EthNativeSigner(funder.unified, { signMode: "classical", rest: REST });
const acct = await rest<{ account: { account_number: string; sequence: string } }>(`/cosmos/auth/v1beta1/accounts/${funder.qor}`);
// The chain refuses it before inclusion; the SDK reports that as a thrown error rather than a result with a code.
let winTry: { code: number; transactionHash?: string; rawLog?: string };
try {
  winTry = (await classicalOnly.signAndBroadcast(transport, {
    chainId: CHAIN_ID,
    accountNumber: BigInt(acct.account.account_number),
    sequence: BigInt(acct.account.sequence),
    fee: NATIVE_FEE,
    messages: [openEvmWindowMsg({ sender: funder.qor, blocks: 100, maxTxs: 1, maxValue: "1000000", allowedTargets: [CRUMENA] })] as never,
    memo: "crumena drill: window with the classical key only",
  })) as { code: number; transactionHash: string; rawLog?: string };
} catch (e) {
  const msg = (e as Error).message;
  winTry = { code: -1, rawLog: msg, transactionHash: /\(tx ([0-9A-F]{64})\)/.exec(msg)?.[1] };
}
const refusedForPq = winTry.code !== 0 && /hybrid PQC signature required/i.test(winTry.rawLog ?? "");
record(
  "Attack: open an EVM window with the funder's stolen classical key only",
  refusedForPq,
  `refused by the chain: ${/account \S+ has a registered PQC key[\s\S]*?hybrid PQC signature required/.exec(winTry.rawLog ?? "")?.[0] ?? (winTry.rawLog ?? "").slice(0, 200)}`,
);

// b. Even inside a window the funder opened, the classical key can't add a payee.
await funder.openWindow([CRUMENA], 1, 1_500_000n, 100);
await sleep(3000);
n = await nonce(funder);
const garbage = ("0x" + "00".repeat(4627)) as Hex;
const evmTry = await funder.wallet.sendTransaction({
  account: funder.wallet.account!,
  chain: funder.wallet.chain,
  to: CRUMENA,
  data: encodeFunctionData({ abi: CRUMENA_ABI, functionName: "addPayee", args: [potId, attacker.evm, "Totally legit", 0n, { nonce: n, validUntil: until(), signature: garbage }] }),
  gas: 1_500_000n,
  maxFeePerGas: MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: PRIORITY_FEE,
});
const evmRcpt = await publicClient.waitForTransactionReceipt({ hash: evmTry, timeout: 90_000 });
const stillNotPayee = !(await read<{ approved: boolean }>("payeeInfo", [potId, attacker.evm])).approved;
record("Attack: inside an open window, send addPayee from the funder's own address without its post-quantum signature", evmRcpt.status === "reverted" && stillNotPayee, `reverted on chain (BadPqcSignature): the attacker was not added`, evmTry);

// c. A real ML-DSA-87 signature, but by the attacker's own registered key.
n = await nonce(funder);
v = until();
const forgeText = await read<string>("addPayeeStatement", [potId, attacker.evm, "Totally legit", 0n, n, v]);
const c = await refused("addPayee", [potId, attacker.evm, "Totally legit", 0n, { nonce: n, validUntil: v, signature: attacker.signText(forgeText) }]);
record("Attack: the funder's statement signed with the attacker's own registered ML-DSA-87 key", c === "BadPqcSignature", `refused: ${c}`);

// d. Replay the spender's first payment. The relayer answers a repeat of the same call with the first result and
//    never sends it twice, so the replay also goes straight to the chain, from the attacker's own account.
const replayArgs = [potId, shopA.evm, 25n * FUSD_UNIT, "PO-1042 materials", spender.evm, { nonce: firstPayNonce, validUntil: payUntil, signature: paySig }];
const again = await relay("pay", replayArgs);
record("Replay to the relayer: it returns the first payment and sends nothing new", again.hash === paid.hash, `answered with ${again.hash}`);
let d: string | undefined;
try {
  await publicClient.call({ account: attacker.evm, to: CRUMENA, data: encodeFunctionData({ abi: CRUMENA_ABI, functionName: "pay", args: replayArgs as never }) });
} catch (e) {
  d = revertName(e);
}
record("Attack: replay the spender's signed payment straight to the chain", d === "BadNonce", `refused: ${d}`);

// e. A real signature from the spender, but to an address that isn't approved.
n = await nonce(spender);
v = until();
const strayText = await read<string>("payStatement", [potId, attacker.evm, 5n * FUSD_UNIT, "", spender.evm, n, v]);
const e = await refused("pay", [potId, attacker.evm, 5n * FUSD_UNIT, "", spender.evm, { nonce: n, validUntil: v, signature: spender.signText(strayText) }]);
record("Attack: a properly signed payment to an address the funder never approved", e === "NotApproved", `refused: ${e}`);

// f. Change the amount after signing.
const goodText = await read<string>("payStatement", [potId, shopA.evm, FUSD_UNIT, "", spender.evm, n, v]);
// 20 fUSD stays inside the pot's limits, so only the signature can refuse it.
const f = await refused("pay", [potId, shopA.evm, 20n * FUSD_UNIT, "", spender.evm, { nonce: n, validUntil: v, signature: spender.signText(goodText) }]);
record("Attack: raise the amount to 20 fUSD after the spender signed 1 fUSD", f === "BadPqcSignature", `refused: ${f}`);

// ------------------------------------------------------------- 7. the rules hold

async function signedPay(amount: bigint) {
  const n2 = await nonce(spender);
  const v2 = until();
  const text = await read<string>("payStatement", [potId, shopA.evm, amount, "", spender.evm, n2, v2]);
  return [potId, shopA.evm, amount, "", spender.evm, { nonce: n2, validUntil: v2, signature: spender.signText(text) }];
}
const overCap = await refused("pay", await signedPay(31n * FUSD_UNIT));
record("Rule: a payment over the 30 fUSD cap is refused, even properly signed", overCap === "OverPaymentLimit", `refused: ${overCap}`);

const within = await relay("pay", await signedPay(20n * FUSD_UNIT));
const spentNow = (await read<readonly [bigint, bigint, bigint]>("periodSpending", [potId]))[0];
record("Rule: payments count towards the 60 fUSD weekly limit", spentNow === 55n * FUSD_UNIT, `${spentNow / FUSD_UNIT} of 60 fUSD spent this week`, within.hash);

const overWeek = await refused("pay", await signedPay(6n * FUSD_UNIT));
record("Rule: a payment past the weekly limit is refused", overWeek === "OverPeriodLimit", `refused: ${overWeek} (5 fUSD left this week)`);

n = await nonce(funder);
v = until();
const freezeText = await read<string>("frozenStatement", [potId, true, n, v]);
const frozen = await relay("setFrozen", [potId, true, { nonce: n, validUntil: v, signature: funder.signText(freezeText) }]);
record("The funder freezes the pot (the lost-phone button), post-quantum signed", (await read<{ frozen: boolean }>("potInfo", [potId])).frozen, "frozen", frozen.hash);

const whileFrozen = await refused("pay", await signedPay(FUSD_UNIT));
record("A properly signed payment from a frozen pot is refused", whileFrozen === "PotFrozen", `refused: ${whileFrozen}`);

// ------------------------------------------------------ 8. leftovers go back

const shortPot = { ...newPot, endsAt: BigInt(Math.floor(Date.now() / 1000) + 120), purpose: "Short pot: leftovers return", payees: [shopA.evm] };
n = await nonce(funder);
v = until();
const shortCreated = await relay("createPot", [shortPot, { nonce: n, validUntil: v, signature: funder.signText(await read<string>("createStatement", [shortPot, n, v])) }]);
const shortId = BigInt(shortCreated.potId!);
const shortVault = (await read<{ vault: Hex }>("potInfo", [shortId])).vault;
await main.native("fUSD to the funder", [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: main.qor, toAddress: funder.qor, amount: [{ denom: FUSD_DENOM, amount: (5n * FUSD_UNIT).toString() }] } }]);
await funder.native("pay into the short pot", [convertFusdMsg(funder.qor, shortVault, 5n * FUSD_UNIT)]);
const before = await fusdOf(funder.evm);
console.log("      waiting for the short pot's end date (about 2 minutes)…");
while (BigInt(Math.floor(Date.now() / 1000)) <= shortPot.endsAt + 15n) await sleep(5000);
const reclaimed = await relay("reclaim", [shortId]);
const back = (await fusdOf(funder.evm)) - before;
record("After the end date, the rest goes back to the funder (anyone may trigger it)", back === 5n * FUSD_UNIT, `${back / FUSD_UNIT} fUSD back with the funder`, reclaimed.hash);

// -------------------------------------------------------------------- results

for (const s of steps) if (s.tx?.startsWith("0x")) (s as Step & { qorechainTx?: string }).qorechainTx = await cosmosHashOf(s.tx);
const passed = steps.filter((s) => s.ok).length;
console.log(`\n${passed} of ${steps.length} checks passed.`);
mkdirSync(new URL("../../drill-results", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../../drill-results/testnet-run.json", import.meta.url),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      chainId: CHAIN_ID,
      crumena: CRUMENA,
      potId: potId.toString(),
      accounts: { funder: funder.qor, spender: spender.qor, shopA: shopA.qor, shopB: shopB.qor, attacker: attacker.qor, relayer: main.qor },
      steps,
      passed,
      total: steps.length,
    },
    null,
    2,
  ) + "\n",
);
console.log("Wrote drill-results/testnet-run.json. Claude reads it from there.");
if (passed !== steps.length) process.exit(1);

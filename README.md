# Crumena

**Give money for a purpose, not just to a person.** Someone else does the spending, but only to the payees you approved, only up to the amounts you set, only until the date you chose. Whatever is left comes back to you. Every step is a plain sentence signed with a post-quantum key (ML-DSA-87) and checked on QoreChain.

A *crumena* was the Roman purse you carried for a purpose. Crumena makes that purse programmable on QoreChain: the funder, the spender and the payees each sign readable statements in QoreX with their **ML-DSA-87** key, and the contract checks every one with QoreChain's `pqcVerify` precompile against the key the chain has on record.

Built for QoreChain's *Build Before Q-Day* fest, Post-Quantum dApp track.

> **Live on QoreChain testnet** at `0xaF8Bed9f9e3C21F2E7a79c9968bFedA54d92E1F5`. The live run passed **23 of 23** checks with real ML-DSA-87 signatures: the whole flow, payee amounts, short links, the spending rules and freezing, an independent off-chain check of a payment's signature, and six attacks refused. Details and explorer links: [`docs/TESTNET_RUN.md`](docs/TESTNET_RUN.md). Tests: 166 contract, 20 server, 28 app. QCAI audit: 85/100 on v4, every finding across four reports answered in [`docs/AUDIT.md`](docs/AUDIT.md).

## Try it in two minutes

Open the app and press **Try it in two minutes**. You get three test people on QoreChain testnet (a funder, a spender and a payee), each with a real ML-DSA-87 key registered on chain. Switch between them at the top of the page; a **Start here** guide ticks off each step:

1. **As the funder,** create a pot (the form is filled in for you, the payee approved up to 30 fUSD), read the exact text you're signing, sign it, and add 50 test fUSD.
2. **As the spender,** pay the payee. Then try paying more than the cap or the payee's amount: the contract refuses. Need someone new? Ask the funder, with the amount you need.
3. **As the payee,** confirm the address is yours, with your own key.
4. **As the funder,** approve a request for an amount of your choice, change a payee's limit, freeze the pot, or give the rest to the spender. Open any payment's **receipt**, or press **Verify**, to check its signature yourself.

No wallet, no sign-up, no gas. With QoreX it's the same, with your own account.

Or go straight to **Make this pot misbehave** on the home page: a public pot on testnet where you play the spender and try eight ways to misuse the money. The live contract refuses each one, with its reason; one honest payment goes through, with a receipt.

## Who it's for

Money given for a purpose often isn't spent on it. Today the person giving it either trusts the spender completely or pays every bill themselves. Crumena sits in between. Pots hold stablecoins (fUSD on testnet), so the amounts mean the same tomorrow as today.

- **Grants and DAO budgets.** A foundation or DAO gives a grantee a pot that pays only the listed contributors and services until the grant ends. What's left goes back.
- **Team and project budgets.** A company funds a project lead, who pays approved freelancers and suppliers (paid in stablecoins) within a cap per payment. A new supplier needs the funder's approval, for an amount the funder decides.
- **Bounties, prize pools and group collections.** Anyone can pay into a pot's address. It pays out only to the addresses the organiser approved, each up to an amount, with a public receipt for every payment.
- **Allowances.** A parent or employer funds someone's spending with approved merchants that accept stablecoins, with a weekly limit and a freeze button.
- **Gifts with a purpose.** Give someone a pot for a course, a laptop or a trip, spendable only with the sellers you picked. What they don't use comes back to you, or you release the rest to them as a free gift.
- **Savings goals.** Be your own funder and spender: put stablecoins aside in a pot that pays only the seller you're saving for, with a weekly limit so it can't be drained on impulse. You can still unlock it yourself, so it's a guard against impulse spending rather than a vault.
- **Agent budgets.** The spender is just a key, so it can be a bot or an AI agent with its own post-quantum key. It can pay only the services you approved, up to your limits, and you can freeze it at once.

Today payees are QoreChain addresses paid in fUSD. As local stablecoins and payment providers arrive on QoreChain, the same pots can pay landlords, schools and clinics directly.

What it isn't: a shared wallet. One person funds the pot and gets the rest back (for a group collection, that's the organiser, who settles up with the group), one person spends, and the contract decides what's allowed.

| Role | Can | Can't |
|---|---|---|
| **Funder** | create a pot; approve or remove payees, **each up to an amount**, and change a payee's amount; set a cap per payment and a limit per day, week or month; **freeze** the pot at once; extend the end date; release the rest to the spender | take the money back before the end date, or pay anyone not approved |
| **Spender** | pay approved payees within the limits; ask the funder to approve someone new, **with the amount needed** | pay anyone else, go over a limit or a payee's amount, or keep the money |
| **Payee** (a vendor, a supplier, a landlord, a service) | receive payments, each with a receipt; confirm with its own key that the address is theirs (a pot can require this) | receive more than the funder approved for it |
| **Anyone** | pay into a pot's own address; after the end date, send what's left back to the funder | send it anywhere else |

## How it works

```
 person (QoreX)                  Crumena app                       relayer (EVM window scoped to Crumena)     Crumena contract
 ───────────────                 ───────────                       ──────────────────────────────────────     ────────────────
                                 1. read the nonce and the exact statement from the contract (a view call)
                                 2. check its lines match what the person asked for, then show it in full
 3. read and sign in QoreX ◄──── statement
    (ML-DSA-87)            ─────► signature ───────────────────► 4. submit the call ─────────────────────► 5. rebuild the statement,
                                                                                                           read the signer's key (pqcKeyStatus),
                                                                                                           verify (pqcVerify), check the rules, act
```

- **The statement is the authorisation.** For a payment it reads:
  ```
  Crumena: pay from pot #4
  Pot: Office fit-out, phase 1
  Amount: 25 fUSD
  To: Halden Building Supplies
  Address: 0x95c6764de6b29d3633d8a3f211d2995202e8f93e
  Memo: PO-1042 materials
  Signed by: qor1pz9zzqyn0uwu7mqndxxfyc05npq648lr8y48n7
  Nonce: 0
  Valid until: 2026-11-26 08:18 UTC
  Contract: 0x3a0039ac653f8876b8bef5debf56a0dab5aaa2b3 on qorechain-diana
  ```
  (a real one, from the live run). The contract builds this text from the call's arguments and checks the ML-DSA-87 signature over `qorechain-msg-v1|qorechain-diana|<statement>`, exactly what QoreX signs. Change one byte and the signature fails.
- **Rules are signed too.** A new pot's statement lists its limits (`Limit per payment: 20 fUSD`, `Limit per period: 40 fUSD every 7 days`); changing them or freezing the pot is its own signed statement.
- **The relayer can't act on its own.** It submits from an EVM window scoped to the Crumena contract only; every call is authorised inside the contract by someone else's post-quantum signature. The one unsigned call, `reclaim`, can only send money back to the funder.
- **Anyone can check.** Each history entry has **Verify**: the browser reads the transaction, asks the contract (as of the block before) for the statement, reads the signer's key from `pqcKeyStatus` at that block, and checks the ML-DSA-87 signature itself. No trust in Crumena's server.
- **Each pot has its own address** (a CREATE2 vault), shown in the funder's statement before signing. Anyone can pay in: an ERC-20 transfer, or straight from the bank lane with `MsgConvertCoin`.
- **Each payee has an amount.** The funder approves a payee up to an amount in total (`Up to: 30 fUSD in total`), in the create statement or later; the spender's request for a new payee carries the amount it needs (`Amount: 15 fUSD`), and the funder approves that or an amount of its choice. The contract counts what each payee was paid, across removal and re-approval, and refuses past it (`OverPayeeLimit`).
- **Receipts.** Every payment has a page (`#/r/<pot>/<transaction>`) with the amount, payee, signer, memo, time, the signed statement and the same in-browser signature check as **Verify**; print it or save it as PDF.
- **Short links.** A pot opens at `#/p/<code>`: 11 characters from the first 8 bytes of its vault, mapped on chain (`potOfCode`) and checked against the vault. Not secret (a pot is public on chain), just not a counter.

## QoreChain features used

| Feature | Where |
|---|---|
| `pqcVerify` precompile (`0x…0a01`), ML-DSA-87 | [`contracts/src/lib/Pqc.sol`](contracts/src/lib/Pqc.sol), on every signed action |
| `pqcKeyStatus` precompile (`0x…0a02`): registered, ML-DSA-87, possession proven | [`Pqc.sol`](contracts/src/lib/Pqc.sol) (both answer layouts, fails closed); read again at past blocks by the app's **Verify** ([`app/src/lib/verify.ts`](app/src/lib/verify.ts)) |
| QoreX `signArbitrary` (hybrid secp256k1 + ML-DSA-87) | [`app/src/lib/qorex.ts`](app/src/lib/qorex.ts) |
| EVM authorisation window scoped to one contract (`allowedTargets`) | [`server/src/relay.ts`](server/src/relay.ts) |
| `MsgConvertCoin`: bank fUSD to ERC-20 at a pot's address | [`server/src/chain.ts`](server/src/chain.ts), indexed in [`server/src/deposits.ts`](server/src/deposits.ts) |
| ML-DSA-87 key registration with proof of possession | demo people and the live run ([`server/src/chain.ts`](server/src/chain.ts)) |
| Hybrid-required accounts (the chain refuses a classical-only signature) | shown in the live run's first attack |
| fUSD on `qorechain-diana` | every pot |

QoreChain's AI risk precompiles (`0x…0b01`, `0x…0b02`) were checked too: on diana they hold no code yet, so Crumena doesn't rely on them.

## Security properties

- Only the funder's key can create a pot, approve or remove payees, set limits (per payment, per period, per payee), freeze, extend or release. Only the spender (or funder) can pay, only to approved payees, only within the limits, and never from a frozen pot.
- Limits hold across any spread of payments: fuzz tests check no period ever pays out more than its limit and no payee ever receives more than its amount, and an invariant checks each payee's count matches what it received.
- Statements are printable ASCII only (no line breaks, no look-alike letters) with length caps; addresses always sit on their own line.
- Nonces are per signer and sequential; signatures expire (at most 7 days; the app asks for 30 minutes). Statements name the contract and the chain, and the constructor checks `block.chainid`.
- The app refuses to pass QoreX a statement whose lines don't match the request (tested with a tampered server), and refuses if QoreX switched account since sign-in.
- The Crumena contract never holds money; each pot's vault moves money only when Crumena tells it to.

Full threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Proven on testnet

Contract `0xaF8Bed9f9e3C21F2E7a79c9968bFedA54d92E1F5` on `qorechain-diana`, deployed from commit `84ca8f6`; [`server/scripts/match-bytecode.ts`](server/scripts/match-bytecode.ts) shows the code on chain is exactly this source (QoreChain's explorer has no source verification yet). The live run, **23 of 23**:

| | Check | Result |
|---|---|---|
| ✓ | Funder creates a pot (cap 30 fUSD, 60 fUSD a week, one vendor approved up to 60 fUSD), signed with ML-DSA-87, checked by `pqcVerify` | [tx](https://explore.qore.network/tx/B9BBF0E3B72D34A71F19CC0BD6656335E0361F97A9E4B0AE626E545DA7779843) |
| ✓ | The pot's short link code (first 8 bytes of its vault) finds it on chain | `potOfCode` |
| ✓ | Funder pays 100 fUSD into the pot's address from the bank lane (`MsgConvertCoin`, hybrid-signed) | [tx](https://explore.qore.network/tx/7C7473CBDCFD62E811CFA6A52C096D46F88AD88105565B673AB8726F748226C0) |
| ✓ | The spender pays an approved vendor 25 fUSD; no gas, no transaction of their own | [tx](https://explore.qore.network/tx/87187494ABBECBD676C90CC4DBD13F3ACB199DD872C06DC5E4DD9E4406773FCA) |
| ✓ | The same payment checked off chain: statement and key from the chain, ML-DSA-87 verified; the signature over a changed amount fails | |
| ✓ | The vendor confirms its address with its own key | [tx](https://explore.qore.network/tx/9DD54E3773D04BBAB36C3C55CA86D4C179E4FBDEE4EF7A8D4D99FFBAFED2BCA6) |
| ✓ | The spender asks for a new vendor for 15 fUSD; the funder approves it up to 12 fUSD; it's paid 10 | [tx](https://explore.qore.network/tx/D4306AE66E32463799F057549A5BF20E07640C4DF9ABB0685F8CFFB1B8319A2D) · [tx](https://explore.qore.network/tx/448BA1968BF97976D14E5EF925D143FF0A23EE52867AD66B2E0DC659C1F73D6B) · [tx](https://explore.qore.network/tx/F39293A3D000AB1E3A6FFD014718126BE307A4B6E70F38884D1DE8D5279E1861) |
| ✓ | Paying that vendor 5 more, past the 12 approved, is refused | `OverPayeeLimit` |
| ✓ | A stolen classical key can't open an EVM window: the chain requires the hybrid signature | refused by the chain |
| ✓ | `addPayee` from the funder's own address without its post-quantum signature | [reverted on chain](https://explore.qore.network/tx/B3BE783CCC4F48216B0B3A834E64F0082340707DAD5D022841CAB1B44C1D6AF2) |
| ✓ | The attacker's own registered key; a replay; an unapproved payee; an amount raised after signing | `BadPqcSignature`, `BadNonce`, `NotApproved`, `BadPqcSignature` |
| ✓ | Over the per-payment cap; past the weekly limit (55 of 60 spent) | `OverPaymentLimit`, `OverPeriodLimit` |
| ✓ | The funder freezes the pot; a signed payment from it is refused | [tx](https://explore.qore.network/tx/46FF9D0F84ED08A7B65B3A80150C2C24C61913B1D7BB4F4BC49ACA0D87E5F2D3), `PotFrozen` |
| ✓ | After the end date, the rest goes back to the funder | [tx](https://explore.qore.network/tx/11DA653DD5ECB1C75F7070EE666E4BF38EE731302CDAACF89F09AA8FFC477901) |

Explorer links: switch QoreChain's explorer to **Testnet** at the top of the page. All 23 steps, accounts and hashes: [`docs/TESTNET_RUN.md`](docs/TESTNET_RUN.md).

## Repository

```
contracts/   Foundry: Crumena.sol, PotVault.sol, lib/Pqc.sol, lib/Text.sol; tests: unit, fuzz, invariants
server/      relayer, read-only RPC/REST proxy, pot history and bank-deposit indexes, demo people, the public challenge pot (Hono)
             scripts/: deploy, live testnet run, relayer account
app/         web app (Vite + React): QoreX adapter, demo signer, contract client, browser verification, screens
             e2e/: the whole app on a local chain, and a scripted click-through
shared/      generated ABI, error texts
deploy/      one-command setup for a server with Caddy
```

## Run it

Requirements: Foundry 1.5, Node 22, pnpm 10.

```bash
git clone --recursive https://github.com/phoenix-2203/crumena && cd crumena
pnpm install
pnpm build:contracts                 # forge build + regenerate shared/crumena-abi.ts
pnpm test                            # contracts, server, app

# the whole app on a local chain, no testnet needed:
pnpm --filter @crumena/app build && cd app && node --import tsx e2e/local-chain.ts   # then open http://127.0.0.1:8799
```

On testnet (throwaway accounts only; never paste a seed phrase anywhere):

```bash
cp server/.env.example server/.env.seed   # E2E_MNEMONIC, funded from the faucet
pnpm --filter @crumena/server deploy:testnet
pnpm --filter @crumena/server testnet:run
```

On a server with Caddy, as root: `bash <(curl -fsSL https://raw.githubusercontent.com/phoenix-2203/crumena/main/deploy/setup.sh)`. It makes the relayer's own throwaway account there and prints only its address to fund.

## Tests

- **Contracts** (`forge test`, 161): creating pots, paying, payees and their amounts (with a fuzz that no payee ever gets more than its amount), requests with amounts, link codes, lifecycle, spending rules and freezing (with a fuzz over periods), the exact statement texts, the PQC checks (both precompile answer layouts, missing or odd precompiles, rotated keys, another chain), 5 invariants (money accounted for, each payee's count exact and within its amount, an attacker gets nothing, the contract holds nothing, paid ≤ funded), and a regression test for each QCAI finding.
- **Server** (`vitest`, 19): what the relayer will and won't send, every contract error in plain words, a real ML-DSA-87 signature in QoreX's format, `MsgConvertCoin`, the deposit index, demo limits, the history index against the contract on anvil, and the public challenge (each attack's exact call, never sent; a would-be accept reported plainly; replay after a restart).
- **App** (`vitest`, 28): addresses, amounts and dates matching the contract; the QoreX adapter; the whole flow against the contract on anvil (create, fund, pay, confirm, request with an amount and approve a different one, the payee's amount enforced and raised, refusals, limits, freezing, a tampered statement that never reaches QoreX, short link codes, release, reclaim); and **Verify** with a real ML-DSA-87 signature on create, approve and limit changes (valid) and one from a different key (invalid).
- **Browser** (`app/e2e`): the scripted click-through of the demo, up to a receipt and the Start here guide at 4 of 4, and an accessibility check (axe-core, WCAG 2.1 AA) of every page in light and dark.
- **Live** (`testnet:run`): 21 checks against the chain's own precompiles: the flow, the rules and freezing, an off-chain signature check, and six attacks. Last run: 21 of 21 ([`docs/TESTNET_RUN.md`](docs/TESTNET_RUN.md)).

Precompile stand-ins: anvil has no QoreChain precompiles, so local tests place stand-ins at `0x…0a01`/`0x…0a02`. Real ML-DSA-87 is checked by the server tests, the app's Verify test and the live run.

## Audit

QoreChain's QCAI audit, "Ethereum (EVM/Solidity)" setting, on the deployed code as one file ([`docs/audit/Crumena.audit.sol`](docs/audit/Crumena.audit.sol)).

- **Stage 1** (26 Nov 2026): 82/100, five findings ([report](docs/audit/stage1-2026-11-26.pdf)). Each is answered in [`docs/AUDIT.md`](docs/AUDIT.md) with regression tests in [`contracts/test/Audit.t.sol`](contracts/test/Audit.t.sol). None needed a contract change: the nonce, overflow, return-value, loop and ordering concerns are each already prevented, and the tests show it.
- **Stage 2** (26 Nov 2026): 82/100 again, five findings ([report](docs/audit/stage2-2026-11-26.pdf)): two repeat Stage 1's, three are worded as new. All answered in [`docs/AUDIT.md`](docs/AUDIT.md#stage-2), with new tests for the new ones, including a token that tries to re-enter Crumena mid-transfer and gets nothing.

## Credits

- [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), Foundry, [viem](https://viem.sh), [Hono](https://hono.dev), React, Vite, Vitest, [@scure/base](https://github.com/paulmillr/scure-base), [uqr](https://github.com/unjs/uqr) (QR codes).
- QoreChain's [`@qorechain/sdk`, `@qorechain/evm`, `@qorechain/qoresign`](https://www.npmjs.com/org/qorechain) for accounts, windows, message signing and verification.
- The idea of money locked to a purpose: [AustinChris1/Earmark](https://github.com/AustinChris1/Earmark) (Celo) and the author's own [Earmark on Arc](https://github.com/phoenix-2203/earmark). Crumena is a new codebase written for QoreChain from 26 Nov 2026; no code was copied from either.
- Patterns studied from other QoreChain builders: handling both `pqcKeyStatus` answer layouts ([Heirloom](https://github.com/bigbenny1231/Heirloom)), `MsgConvertCoin` on diana ([rosca](https://github.com/nikhil-pn/rosca)), QoreX's `signArbitrary` behaviour ([Whisper](https://github.com/Investorquab/Whisper)), and the QCAI audit write-up layout ([pq-permit](https://github.com/JahanzaibMohsin9/pq-permit)).
- Built with AI assistance; see [`AI_USAGE.md`](AI_USAGE.md).

## Licence

[MIT](LICENSE)

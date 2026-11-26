# Crumena

**Money for one purpose. Fill a pot for someone; they spend it only with the people you approve, within the limits you set; whatever is left comes back to you. Every step is a plain sentence signed with a post-quantum key and checked on chain.**

A *crumena* was the Roman purse you carried for a purpose. Crumena makes that purse programmable on QoreChain: the funder, the spender and the payees each sign readable statements in QoreX with their **ML-DSA-87** key, and the contract checks every one with QoreChain's `pqcVerify` precompile against the key the chain has on record.

Built for QoreChain's *Build Before Q-Day* fest, Post-Quantum dApp track.

> **Status.** Contracts, relayer and app are built and tested (119 contract tests, 12 server, 27 app, including the app's whole flow against the real contract on a local chain). An earlier build of the contract ran live on testnet, 15 of 15 checks passed (below). The current build adds spending rules and freezing; its testnet redeploy, live run and the QCAI audit are next, and their results will replace the earlier ones here.

## Try it in two minutes

Open the app and press **Try it in two minutes**. You get three test people on QoreChain testnet (a funder, a spender and a shop), each with a real ML-DSA-87 key registered on chain. Switch between them at the top of the page:

1. **As the funder,** create a pot (the form is filled in for you), read the exact text you're signing, sign it, and add 50 test fUSD.
2. **As the spender,** pay the shop. Then try paying more than the cap: the contract refuses.
3. **As the shop,** confirm the address is yours, with your own key.
4. **As the funder,** freeze the pot, change the limits, or give the rest to the spender. Press **Verify** on any payment to check its signature yourself.

No wallet, no sign-up, no gas. With QoreX it's the same, with your own account.

## Who it's for

Money given for a purpose often isn't spent on it: a parent's school-fees transfer, a company's materials budget for a site manager, a student's weekly allowance, a grant for equipment. Today the funder either trusts the spender or pays every bill personally. Crumena sits in between.

| Role | Can | Can't |
|---|---|---|
| **Funder** | create a pot; approve or remove payees; set a cap per payment and a limit per day, week or month; **freeze** the pot at once; extend the end date; release the rest to the spender | take the money back before the end date, or pay anyone not approved |
| **Spender** | pay approved payees within the limits; ask the funder to approve someone new | pay anyone else, go over a limit, or keep the money |
| **Payee** | confirm with its own key that the address is theirs (a pot can require this) | anything else |
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

- Only the funder's key can create a pot, approve or remove payees, set limits, freeze, extend or release. Only the spender (or funder) can pay, only to approved payees, only within the limits, and never from a frozen pot.
- Limits hold across any spread of payments: a fuzz test checks no period ever pays out more than its limit.
- Statements are printable ASCII only (no line breaks, no look-alike letters) with length caps; addresses always sit on their own line.
- Nonces are per signer and sequential; signatures expire (at most 7 days; the app asks for 30 minutes). Statements name the contract and the chain, and the constructor checks `block.chainid`.
- The app refuses to pass QoreX a statement whose lines don't match the request (tested with a tampered server), and refuses if QoreX switched account since sign-in.
- The Crumena contract never holds money; each pot's vault moves money only when Crumena tells it to.

Full threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Proven on testnet

The earlier build (source `cc4b416`, without spending rules) was deployed to `qorechain-diana` at `0x3A0039AC653f8876b8BEF5deBf56A0dAB5aaa2b3` and the live run passed **15 of 15** checks with real ML-DSA-87 signatures, including: a pot created and funded from the bank lane; a gas-free payment; a payee confirming with its own key; a new payee requested and approved; and six attacks refused (a stolen classical key opening a window, a call without the post-quantum signature, the attacker's own key, a replay, an unapproved payee, an amount changed after signing). A payment from that run was also verified independently in a browser: real signature valid, the same signature over a changed amount invalid.

The current build's redeploy and run will be published in [`docs/TESTNET_RUN.md`](docs/TESTNET_RUN.md) with explorer links.

## Repository

```
contracts/   Foundry: Crumena.sol, PotVault.sol, lib/Pqc.sol, lib/Text.sol; tests: unit, fuzz, invariants
server/      relayer, read-only RPC/REST proxy, pot history and bank-deposit indexes, demo people (Hono)
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

- **Contracts** (`forge test`, 119): creating pots, paying, payees, lifecycle, spending rules and freezing (with a fuzz over periods), the exact statement texts, the PQC checks (both precompile answer layouts, missing or odd precompiles, rotated keys, another chain) and 4 invariants (money accounted for, an attacker gets nothing, the contract holds nothing, paid ≤ funded).
- **Server** (`vitest`, 12): what the relayer will and won't send, every contract error in plain words, a real ML-DSA-87 signature in QoreX's format, `MsgConvertCoin`, the deposit index, demo limits, and the history index against the contract on anvil.
- **App** (`vitest`, 27): addresses, amounts and dates matching the contract; the QoreX adapter; the whole flow against the contract on anvil (create, fund, pay, confirm, request and approve, refusals, limits, freezing, a tampered statement that never reaches QoreX, release, reclaim); and **Verify** with a real ML-DSA-87 signature (valid) and one from a different key (invalid).
- **Live** (`testnet:run`): the flow, the rules and six attacks against the chain's own precompiles.

Precompile stand-ins: anvil has no QoreChain precompiles, so local tests place stand-ins at `0x…0a01`/`0x…0a02`. Real ML-DSA-87 is checked by the server tests, the app's Verify test and the live run.

## Audit

QoreChain's QCAI audit, in two stages: reports in `docs/audit/`, each Stage 1 finding mapped to what was done in [`docs/AUDIT.md`](docs/AUDIT.md). *(Pending.)*

## Credits

- [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), Foundry, [viem](https://viem.sh), [Hono](https://hono.dev), React, Vite, Vitest, [@scure/base](https://github.com/paulmillr/scure-base), [uqr](https://github.com/unjs/uqr) (QR codes).
- QoreChain's [`@qorechain/sdk`, `@qorechain/evm`, `@qorechain/qoresign`](https://www.npmjs.com/org/qorechain) for accounts, windows, message signing and verification.
- The idea of money locked to a purpose: [AustinChris1/Earmark](https://github.com/AustinChris1/Earmark) (Celo) and the author's own [Earmark on Arc](https://github.com/phoenix-2203/earmark). Crumena is a new codebase written for QoreChain from 26 Nov 2026; no code was copied from either.
- Patterns studied from other QoreChain builders: handling both `pqcKeyStatus` answer layouts ([Heirloom](https://github.com/bigbenny1231/Heirloom)), `MsgConvertCoin` on diana ([rosca](https://github.com/nikhil-pn/rosca)), QoreX's `signArbitrary` behaviour ([Whisper](https://github.com/Investorquab/Whisper)), and the QCAI audit write-up layout ([pq-permit](https://github.com/JahanzaibMohsin9/pq-permit)).
- Built with AI assistance; see [`AI_USAGE.md`](AI_USAGE.md).

## Licence

[MIT](LICENSE)

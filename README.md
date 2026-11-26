# Crumena

**Money set aside for one purpose, spent only where the funder allows, with every action signed post-quantum on QoreChain.**

A *crumena* was the Roman purse you carried for a purpose. Crumena makes that purse programmable: a funder fills a pot, names who spends it and which payees it may pay, and whatever is left goes back to the funder after the end date. Every instruction is a plain-English statement the signer reads in QoreX and signs with their **ML-DSA-87** key, and the contract checks that signature on chain with QoreChain's `pqcVerify` precompile.

Built for QoreChain's *Build Before Q-Day* fest, Post-Quantum dApp track.

> Status: contracts, relayer and the app's logic are built and tested locally. The QoreChain testnet deployment, the live run and the QCAI audit are next; their results will be linked here once they exist. The screens and branding come after that.

## Who it's for

Money given for a purpose often isn't spent on it: a parent's school-fees transfer, a company's materials budget for a site manager, a grant for equipment, a group's pooled fund. Today the funder either trusts the spender or pays every bill personally. Crumena sits in between:

| Role | Can | Can't |
|---|---|---|
| **Funder** | create a pot, approve or remove payees, extend the end date, release the rest to the spender | spend from the pot to anyone not approved |
| **Spender** | pay approved payees any amount the pot holds, ask the funder to approve a new payee | pay anyone else, or keep the money |
| **Payee** | confirm with its own key that the address is really theirs (a pot can require this) | anything else |
| **Anyone** | pay into a pot's address; after the end date, send what's left back to the funder | send it anywhere else |

Nobody needs gas, an EVM transaction or a bridge to use it: they only sign readable text in QoreX.

## How it works

```
 person (QoreX)                  Crumena app                 relayer (scoped EVM window)        Crumena contract
 ───────────────                 ───────────                 ───────────────────────────        ────────────────
                                 1. read nonce + the exact statement from the contract (view call)
                                 2. check its lines match what the person asked for
 3. read + sign in QoreX  ◄───── statement
    (ML-DSA-87)           ─────► signature ─────────────► 4. submit the call ─────────────► 5. rebuild the statement,
                                                                                               read the signer's key (pqcKeyStatus),
                                                                                               verify (pqcVerify), then act
```

- **The statement is the authorisation.** For a payment it reads like:
  ```
  Crumena: pay from pot #1
  Pot: Office fit-out, phase 1
  Amount: 250.5 fUSD
  To: Halden Building Supplies
  Address: 0x…
  Memo: PO-1042 materials
  Signed by: qor1…
  Nonce: 3
  Valid until: 2026-11-26 09:30 UTC
  Contract: 0x… on qorechain-diana
  ```
  The contract builds this text itself from the call's arguments and checks the ML-DSA-87 signature over `qorechain-msg-v1|qorechain-diana|<statement>`, which is exactly what QoreX signs. Change one byte (amount, payee, pot, nonce, deadline, contract, chain) and the signature fails.
- **The relayer can't do anything on its own.** It submits from an EVM window scoped to the Crumena contract only, and every call it sends is authorised inside the contract by someone else's post-quantum signature. The one unsigned call, `reclaim`, can only send money back to the funder.
- **Each pot has its own address** (a CREATE2 vault), shown in the funder's statement before signing. Anyone can pay into it: an ERC-20 transfer, or straight from the bank lane with `MsgConvertCoin`.

## QoreChain features used

| Feature | Where |
|---|---|
| `pqcVerify` precompile (`0x…0a01`), ML-DSA-87 | [`contracts/src/lib/Pqc.sol`](contracts/src/lib/Pqc.sol), on every signed action |
| `pqcKeyStatus` precompile (`0x…0a02`): registered, ML-DSA-87, possession proven | [`Pqc.sol`](contracts/src/lib/Pqc.sol); both answer layouts handled, fails closed |
| QoreX `signArbitrary` (hybrid secp256k1 + ML-DSA-87) | [`app/src/lib/qorex.ts`](app/src/lib/qorex.ts) |
| EVM authorisation window scoped to one contract (`allowedTargets`) | [`server/src/relay.ts`](server/src/relay.ts) |
| `MsgConvertCoin`: bank fUSD to ERC-20 at the pot's address | [`server/src/chain.ts`](server/src/chain.ts) |
| fUSD on `qorechain-diana` | the pot token in the run and the app |

## Security properties

- Only the funder's key can create a pot, approve or remove payees, extend, or release; only the spender (or funder) can pay, and only to approved payees.
- Statements are printable ASCII only, so a name or memo can't add lines or use look-alike letters; lengths are capped.
- Nonces are per signer and sequential; signatures expire (at most 7 days, the app asks for 30 minutes).
- The contract checks `block.chainid` at deployment and names itself and the chain in every statement, so a signature can't be replayed elsewhere.
- The app refuses to pass QoreX a statement whose lines don't match the request, and refuses if QoreX switched account since sign-in.
- The Crumena contract never holds money; each pot's vault only moves money when Crumena tells it to.

The full threat model is in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Repository

```
contracts/   Foundry: Crumena.sol, PotVault.sol, lib/Pqc.sol, lib/Text.sol, tests (unit, fuzz, invariants)
server/      relayer + read-only RPC proxy (Hono), deploy script, live testnet run
app/         web app (Vite + React): QoreX adapter, contract client; screens to come
shared/      generated ABI, error texts
```

## Run it

Requirements: Foundry 1.5, Node 22, pnpm 10.

```bash
git clone --recursive https://github.com/phoenix-2203/crumena && cd crumena
pnpm install
pnpm build:contracts        # forge build + regenerate shared/crumena-abi.ts
pnpm test                   # contracts, server, app
```

Testnet (throwaway accounts only; never paste a seed phrase anywhere):

```bash
cp server/.env.example server/.env        # RELAYER_MNEMONIC
cp server/.env.example server/.env.seed   # E2E_MNEMONIC (fund it from the faucet)
pnpm --filter @crumena/server deploy:testnet
pnpm --filter @crumena/server testnet:run
pnpm --filter @crumena/server start       # relayer on 127.0.0.1:8790
pnpm --filter @crumena/app dev
```

## Tests

- **Contracts** (`forge test`): 99 tests, covering creating pots, paying, payees, the pot's lifecycle, the exact statement texts, the PQC checks (both precompile answer layouts, missing or odd precompiles, rotated keys, another chain) and 4 invariants (money accounted for, an attacker gets nothing, the contract holds nothing, paid ≤ funded).
- **Server** (`vitest`): what the relayer will and won't send, every contract error explained, and a real ML-DSA-87 signature in QoreX's exact format verified offline.
- **App** (`vitest`): addresses, amounts and dates matching the contract, the QoreX adapter, and the whole flow against the real contract on a local chain, including a tampered statement that never reaches QoreX.
- **Live** (`testnet:run`): the flow and six attacks against the chain's own precompiles. Results will be published in `docs/` after the run.

Precompile test doubles: anvil and Foundry's EVM have no QoreChain precompiles, so local tests place doubles at `0x…0a01`/`0x…0a02` that check which key and which bytes with a stand-in signature of the same size. Real ML-DSA-87 is checked by the server tests and the live run.

## Audit

QoreChain's QCAI audit, run in two stages: reports in `docs/audit/`, each Stage 1 finding mapped to what was done in [`docs/AUDIT.md`](docs/AUDIT.md). *(Pending.)*

## Credits

- [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), Foundry, [viem](https://viem.sh), [Hono](https://hono.dev), React, Vite, Vitest, [@scure/base](https://github.com/paulmillr/scure-base).
- QoreChain's [`@qorechain/sdk`, `@qorechain/evm`, `@qorechain/qoresign`](https://www.npmjs.com/org/qorechain) for accounts, windows, message signing and verification.
- The idea of money locked to a purpose: [AustinChris1/Earmark](https://github.com/AustinChris1/Earmark) (Celo) and the author's own [Earmark on Arc](https://github.com/phoenix-2203/earmark). Crumena is a new codebase written for QoreChain from 26 Nov 2026; no code was copied from either.
- Patterns studied from other QoreChain builders: handling both `pqcKeyStatus` answer layouts ([Heirloom](https://github.com/bigbenny1231/Heirloom)), `MsgConvertCoin` on diana ([rosca](https://github.com/nikhil-pn/rosca)), QoreX's `signArbitrary` behaviour ([Whisper](https://github.com/Investorquab/Whisper)), and the QCAI audit write-up layout ([pq-permit](https://github.com/JahanzaibMohsin9/pq-permit)).
- Built with AI assistance; see [`AI_USAGE.md`](AI_USAGE.md).

## Licence

[MIT](LICENSE)

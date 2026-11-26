# How AI was used to build Crumena

Crumena was built by one person, [phoenix-2203](https://github.com/phoenix-2203), working with **Claude** (Anthropic, Claude Opus 5.5) in the Claude desktop app's Cowork mode. This file sets out what the AI did, what the human did, and how the work was checked. It is kept up to date as the build goes on.

## Tools

| Tool | Used for |
|---|---|
| Claude (Cowork mode) | Research, design, the contracts, relayer, app logic, tests and docs, in small commits |
| Claude's browser pane | Checking the name against existing products and trademarks |
| Foundry (forge, anvil), Vitest | Contract tests, fuzzing and invariants; the app's flow against the contract on a local chain |
| QoreX (human) | Every real signature on testnet |

No AI service is called at runtime. Crumena has no model and no AI API key.

## Who did what

| Step | Human | AI |
|---|---|---|
| Idea | Chose to bring the purpose-bound money idea to QoreChain's Post-Quantum dApp track, aiming for a top score, and asked that it stay simple for people to use. Pointed to [AustinChris1/Earmark](https://github.com/AustinChris1/Earmark) as a winning example to learn from. | Studied that project, the builder's own Arc version, the fest's rules and scoring, QoreChain's docs and packages, and other QoreChain entries, to find what would score well. Proposed the design: funder, spender and payees, every action a readable statement signed with ML-DSA-87 and checked on chain, a relayer that can only submit, and a vault address per pot. |
| Name | Asked for a name as original as his earlier projects (Cista, Unyoke) and for trademark checks. Created the new repository. | Proposed names, searched each for existing products and marks, and reported clashes (Peculium is a crypto token, Fiscus and Corban are finance software, Sporran is a registered crypto-wallet mark). Recommended Crumena, which came back clear in the web checks. |
| Code | Asked for one small commit at a time, and pushes them himself. | Wrote the Solidity (Crumena, PotVault, the PQC and text libraries), the relayer and its proxies and indexes, the deploy and live-run scripts, and the app (QoreX adapter, demo signer, contract client, browser verification, screens). |
| Product | Set the bar: carry what made the winning Earmark entry work and do better, aiming for 95. | Studied that entry again and proposed the additions: spending limits and a freeze button in the contract, the two-minute demo with real test keys, "Verify" on every payment, pay-in by QR, and a CSV export. |
| Testing | Funded a throwaway testnet account from the faucet while away from his computer. | Made that account inside Claude's browser on the builder's Mac (its phrase never shown), deployed and ran the live test from there (15 of 15 for the first build; 21 of 21 for the current one, after the builder pushed it), fixed the three checks its first attempts got wrong (a refusal the SDK throws instead of returns; a replay the relayer answers from its cache; a raised amount that hit the new cap before the signature check), confirmed the code on chain matches the source byte for byte, and checked a live payment's signature independently in the browser. Wrote 119 contract tests, 12 server tests and 27 app tests, and a scripted click-through of the demo with screenshots. |
| Writing | Reviews the docs. | Wrote the README, the threat model and this file. |

## How the AI's work was checked

- **Tests and types on every commit**: `forge test`, `pnpm -r typecheck`, `pnpm -r test`, plus CI on GitHub that also checks the committed ABI matches the contract.
- **Exact-text tests**: the statements people sign are pinned word for word in `contracts/test/Statements.t.sol`, and the app checks them line by line.
- **Real cryptography where it can't be mocked**: the server tests verify a real ML-DSA-87 signature over QoreX's exact message format. The live testnet run checks signatures with the chain's own precompile.
- **No made-up results**: anything not yet run (the testnet deployment, the live run, the QCAI audit) is marked as pending in the README until its real output exists.

## Safety rules the AI followed

- It never asked for, saw or stored a seed phrase or private key. Real signing happens in QoreX.
- Scripts that need a key take a **throwaway testnet** phrase from a git-ignored `.env` / `.env.seed`, refuse accounts holding more than 200 QOR, and are run by the human on his own computer.

## What AI did not do

- Decide what to build, or when it was good enough.
- Sign anything, or hold any funds.

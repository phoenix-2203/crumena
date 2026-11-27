# Crumena on QoreChain testnet: the live run

The run in [`server/scripts/testnet-run.ts`](../server/scripts/testnet-run.ts), against the deployed contract, on 2026-11-27 at 04:53 UTC. **23 of 23 checks passed.** Every signature in it is a real ML-DSA-87 signature over the statement the contract builds, checked on chain by QoreChain's `pqcVerify` precompile. The raw output is [`testnet-run.json`](testnet-run.json).

**Explorer links:** QoreChain's explorer opens on mainnet; switch it to **Testnet** at the top of the page (it keeps the choice). Contract calls are linked by the QoreChain transaction that carried them, which is what the explorer finds.

## The contract

| | |
|---|---|
| Address | `0x08E9234d443CeF03ecf118dCa2D4f1002Abc9128` on `qorechain-diana` (EVM chain id 9800) |
| Deployed in | [0xfb9d5e596b317f51…](https://explore.qore.network/tx/773F5CB0A9C09F49EBB4E1060F56EA6151C6889DD27F37F902F17F5F8CE5307D), block 10,829,574 |
| Through | a 1-transaction EVM window, hybrid-signed: [02DEA8541783F428…](https://explore.qore.network/tx/02DEA8541783F428BB9DF317F4C07BAAC59B010EC56FCBB1569CA494FB285095) |
| Source | commit [`7b11386`](https://github.com/phoenix-2203/crumena/tree/7b113868da907a2704bc64559fd4d2ee55caf4d0); solc 0.8.28, optimizer 200 runs, via-IR, evm cancun (contracts/foundry.toml) |
| Code match | [`server/scripts/match-bytecode.ts`](../server/scripts/match-bytecode.ts) deploys this source locally and compares runtime code: 23,737 bytes, keccak `0x2e76b058…42a6` both here and on testnet |

## The people

Fresh throwaway accounts made by the run, each with an ML-DSA-87 key registered on chain with proof of possession (the second shop has none, on purpose).

| Role | Account |
|---|---|
| Funder | `qor1fw6npkakwmh249gw4ly0esjmj636yh6wqnlyfk` |
| Spends the pot | `qor1n87xp8zflgrhq80uy8af9dzjchretk6mzm4z6w` |
| Halden Building Supplies (payee, up to 60 fUSD) | `qor1qvnnznahhcue5k64h3k533j8msuzuqxhzahqtc` |
| Brightline Electrical (payee, no PQ key, up to 12 fUSD) | `qor1tktctly7gqvhgzv787rnn97h9pm0fx0twdg8gm` |
| Attacker | `qor1wftuugxct49z2g75ay3uv7ah5dnr8hussmu76m` |
| Relayer (pays gas only) | `qor1ey4prsgv94zc4gdf8dzdupagwj2mstz5tlh9xh` |

## The checks

| # | Check | Result | Transaction |
|---|---|---|---|
| 1 | Funder creates a pot, signed with ML-DSA-87 and checked by pqcVerify | ✓ pot #1, vault 0x40ac36BfD23Bf031EdC30F7560DB38b144baeF83, one approved payee (up to 60 fUSD) | [FC2C1E2252…](https://explore.qore.network/tx/FC2C1E225253478439B9192F46BE29A9A913F0EB38177D23CB6FBE551E8D4702) |
| 2 | The pot's short link code (the first 8 bytes of its vault) finds it | ✓ potOfCode(0x40ac36BfD23Bf031) = 1 |  |
| 3 | Funder pays 100 fUSD into the pot's address from the bank lane (MsgConvertCoin, hybrid-signed) | ✓ pot balance 100 fUSD | [AB26474F76…](https://explore.qore.network/tx/AB26474F76C50863CC6A326078D415A8FC09437842EE581E89F25E1D374B1432) |
| 4 | The person spending the pot pays the approved shop 25 fUSD, post-quantum signed | ✓ shop received 25 fUSD; the spender sent no transaction and paid no gas | [3F72B7870F…](https://explore.qore.network/tx/3F72B7870F6325C5EE72B13DE9FBAA279A1A47AD828813524433363813B748B1) |
| 5 | Independent check of that payment: statement and key read from the chain at the block before, ML-DSA-87 verified off chain | ✓ signature valid: true; the same signature over "Amount: 26": false |  |
| 6 | The shop confirms the address is its own, with its own ML-DSA-87 key | ✓ payee marked confirmed on chain | [1144E465C4…](https://explore.qore.network/tx/1144E465C47FCEB4048D72756FA8041F1E9F5D9CC6C6C8352528B7285EA80A95) |
| 7 | The spender asks the funder to approve a new shop, for 15 fUSD | ✓ request recorded with its amount; the pot still can't pay it | [2ED71735F5…](https://explore.qore.network/tx/2ED71735F5825AEA4629F417D8B2E1055F48A3339CEE4C9752ABB2F9D0DB879A) |
| 8 | The funder approves it up to 12 fUSD, an amount of its own choice, post-quantum signed | ✓ Brightline Electrical approved, up to 12 fUSD in total | [0637AC0729…](https://explore.qore.network/tx/0637AC0729E0DD23D961BE35E0471BF2A4C92AE234CD6FBB17E63984080D05DA) |
| 9 | The spender pays the new shop 10 fUSD | ✓ a shop with no post-quantum key of its own can still be paid | [A49A3B31CB…](https://explore.qore.network/tx/A49A3B31CB3F6AC80A86DBA647656E2B3C5B842E70D946F54F864CBEB57BEE8A) |
| 10 | Rule: a payment past what the funder approved for that shop is refused, even properly signed | ✓ refused: OverPayeeLimit (2 fUSD left for this shop) | refused before sending |
| 11 | Attack: open an EVM window with the funder's stolen classical key only | ✓ refused by the chain: account qor1fw6npkakwmh249gw4ly0esjmj636yh6wqnlyfk has a registered PQC key and must include the hybrid signature extension (hybrid mode: required): hybrid PQC signature required | refused before sending |
| 12 | Attack: inside an open window, send addPayee from the funder's own address without its post-quantum signature | ✓ reverted on chain (BadPqcSignature): the attacker was not added | [7D1635AD0C…](https://explore.qore.network/tx/7D1635AD0CE5FBC8DD80A7B1405767A33773BFA51EDC37548DA3FA2DF27FF63E) |
| 13 | Attack: the funder's statement signed with the attacker's own registered ML-DSA-87 key | ✓ refused: BadPqcSignature | refused before sending |
| 14 | Replay to the relayer: it returns the first payment and sends nothing new | ✓ answered with 0xa80aeb288e3deefc80902f7b1a60da0091cfe3da496c57be6adad2c20307b2a3 |  |
| 15 | Attack: replay the spender's signed payment straight to the chain | ✓ refused: BadNonce | refused before sending |
| 16 | Attack: a properly signed payment to an address the funder never approved | ✓ refused: NotApproved | refused before sending |
| 17 | Attack: raise the amount to 20 fUSD after the spender signed 1 fUSD | ✓ refused: BadPqcSignature | refused before sending |
| 18 | Rule: a payment over the 30 fUSD cap is refused, even properly signed | ✓ refused: OverPaymentLimit | refused before sending |
| 19 | Rule: payments count towards the 60 fUSD weekly limit | ✓ 55 of 60 fUSD spent this week | [0A8B9A452F…](https://explore.qore.network/tx/0A8B9A452F34AB989E7847B9BE6D99530FE5CE68FE0BEA59B916981E67C200A4) |
| 20 | Rule: a payment past the weekly limit is refused | ✓ refused: OverPeriodLimit (5 fUSD left this week) | refused before sending |
| 21 | The funder freezes the pot (the lost-phone button), post-quantum signed | ✓ frozen | [5B8E3D8BCA…](https://explore.qore.network/tx/5B8E3D8BCACC8468D045CF81A1CB7D6C712B038180B2C52AE001E6AC76C75044) |
| 22 | A properly signed payment from a frozen pot is refused | ✓ refused: PotFrozen | refused before sending |
| 23 | After the end date, the rest goes back to the funder (anyone may trigger it) | ✓ 5 fUSD back with the funder | [83B70D7DDE…](https://explore.qore.network/tx/83B70D7DDE67BA68287C83250B71293AE81EC3B3CF584FAF0ABE59DB4AEE1D7E) |

## What the refusals mean

- **Refused by the chain** (check 11): the funder's account has a registered ML-DSA-87 key, so QoreChain itself refuses a transaction signed with the classical key alone. A stolen ECDSA key can't even open an EVM window.
- **Reverted on chain** (check 12): sent from the funder's own address inside a window the funder opened, but without the funder's post-quantum signature over the statement. The contract's `pqcVerify` check rejects it; the payee list didn't change.
- **Refused** (checks 10, 13, 16–18, 20, 22): the relayer simulates every call first and doesn't send one the contract would reject, so these cost nothing. The reason is the contract's own error. Check 15 asks the chain directly, from the attacker's own account, what it would do with the replayed payment.
- **Check 2** finds the pot from its short link code (`/p/<code>` in the app): the code is the first 8 bytes of the pot's vault address, and the contract keeps the lookup.
- **Checks 7–10** are the payee amounts: the spender asks for a new shop with an amount (15 fUSD), the funder approves a different amount of its own choice (12 fUSD), and a properly signed payment that would take the shop past it is refused.
- **Check 5** does the contract's check again without the contract: it reads the statement and the spender's key from the chain as of the block before the payment, and verifies the ML-DSA-87 signature itself. The same signature over a changed amount fails. The app's **Verify** button does the same in the browser.

## Earlier runs

The previous build (`0xD98320A95030874498b92e9cf66f95F83dDe47af`, source `da53d0a`, before per-payee amounts and short links) passed 21 of 21 on 26 Nov 2026. Before spending rules and freezing were added, the first build (`0x3A0039AC653f8876b8BEF5deBf56A0dAB5aaa2b3`, source `cc4b416`) passed 15 of 15 of the same flow and attacks on 26 Nov 2026. Two of its first attempts failed because of the test, not the contract, and were fixed in the run script: the SDK throws (rather than returns) the chain's refusal of a classical-only window, and the relayer answers a repeated call from its cache, so a replay is now also sent straight to the chain.

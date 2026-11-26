# Crumena on QoreChain testnet: the live run

The run in [`server/scripts/testnet-run.ts`](../server/scripts/testnet-run.ts), against the deployed contract, on 2026-11-26 at 11:59 UTC. **21 of 21 checks passed.** Every signature in it is a real ML-DSA-87 signature over the statement the contract builds, checked on chain by QoreChain's `pqcVerify` precompile. The raw output is [`testnet-run.json`](testnet-run.json).

**Explorer links:** QoreChain's explorer opens on mainnet; switch it to **Testnet** at the top of the page (it keeps the choice). Contract calls are linked by the QoreChain transaction that carried them, which is what the explorer finds.

## The contract

| | |
|---|---|
| Address | `0xD98320A95030874498b92e9cf66f95F83dDe47af` on `qorechain-diana` (EVM chain id 9800) |
| Deployed in | [0x18f434fe6bf58e04…](https://explore.qore.network/tx/309EC56003BA91980271ED757250725390A6CA507F36B5CF6BEDFDA8BA3B9166), block 10,776,914 |
| Through | a 1-transaction EVM window, hybrid-signed: [58C3751E7D33E035…](https://explore.qore.network/tx/58C3751E7D33E03567D41F7CF6AD574134BF4097E61A3F519F9EB61959481AFE) |
| Source | commit [`da53d0a`](https://github.com/phoenix-2203/crumena/tree/da53d0a916b9772788034a690541ad6685f8efd6); solc 0.8.28, optimizer 200 runs, via-IR, evm cancun (contracts/foundry.toml) |
| Code match | [`server/scripts/match-bytecode.ts`](../server/scripts/match-bytecode.ts) deploys this source locally and compares runtime code: 21,609 bytes, keccak `0xe2e0556c…7a06` both here and on testnet |

## The people

Fresh throwaway accounts made by the run, each with an ML-DSA-87 key registered on chain with proof of possession (the second shop has none, on purpose).

| Role | Account |
|---|---|
| Funder | `qor1kvqpaqf87kzms2aaq4v6l7qm3vtqjrrfu00lpv` |
| Spends the pot | `qor1adahmfes7c6jaxuvfy56htaqyuat0kv4akgckn` |
| Halden Building Supplies (payee) | `qor1zap0x3dcdgmxrmku5nnpm27densr2r37tk77ma` |
| Brightline Electrical (payee, no PQ key) | `qor1vj7uaqsyxnrqz8t29ura9sk38v8xfl60aej8zk` |
| Attacker | `qor16xkhqrz76d6rwlhvhx300duwuy30fk3hygq5qr` |
| Relayer (pays gas only) | `qor1ey4prsgv94zc4gdf8dzdupagwj2mstz5tlh9xh` |

## The checks

| # | Check | Result | Transaction |
|---|---|---|---|
| 1 | Funder creates a pot, signed with ML-DSA-87 and checked by pqcVerify | ✓ pot #3, vault 0x9489Fe311305E7bFC4087a3D66ED53C16a6bf59F, one approved payee | [5AE33D0B8D…](https://explore.qore.network/tx/5AE33D0B8DF540B5F8E865E77B4788697B0B14C3D7EA1552C891838DE4BFD58D) |
| 2 | Funder pays 100 fUSD into the pot's address from the bank lane (MsgConvertCoin, hybrid-signed) | ✓ pot balance 100 fUSD | [47137D7E03…](https://explore.qore.network/tx/47137D7E03B2CB46B45A5B6E464232DA32892A4DA40CC855BE6A7F9B2F10B35F) |
| 3 | The person spending the pot pays the approved shop 25 fUSD, post-quantum signed | ✓ shop received 25 fUSD; the spender sent no transaction and paid no gas | [91C835422C…](https://explore.qore.network/tx/91C835422C9A539C72F7D827F86EC32D567198ABFCA87A9C8E9116646AACCE31) |
| 4 | Independent check of that payment: statement and key read from the chain at the block before, ML-DSA-87 verified off chain | ✓ signature valid: true; the same signature over "Amount: 26": false |  |
| 5 | The shop confirms the address is its own, with its own ML-DSA-87 key | ✓ payee marked confirmed on chain | [148CB96090…](https://explore.qore.network/tx/148CB9609005DB44ED0F273408BFF059D1524F7FF71A94D7558288A88E037A2A) |
| 6 | The spender asks the funder to approve a new shop | ✓ request recorded; the pot still can't pay it | [F4DEA06259…](https://explore.qore.network/tx/F4DEA06259DBDA9E5797773425EB315D36A6F5C3060E38F7BAC2B839B69ECDBC) |
| 7 | The funder approves it, post-quantum signed | ✓ Brightline Electrical approved | [59BC9C0368…](https://explore.qore.network/tx/59BC9C036860C36E13D68757A75189D2FDC9C6FBE912D02B53B7060EA84DE67D) |
| 8 | The spender pays the new shop 10 fUSD | ✓ a shop with no post-quantum key of its own can still be paid | [61B90D4B51…](https://explore.qore.network/tx/61B90D4B5127A37691A3577FC0AD5EC3EFBC943D2CDFB6BCCDA5979B9A72E0BE) |
| 9 | Attack: open an EVM window with the funder's stolen classical key only | ✓ refused by the chain: account qor1kvqpaqf87kzms2aaq4v6l7qm3vtqjrrfu00lpv has a registered PQC key and must include the hybrid signature extension (hybrid mode: required): hybrid PQC signature required | refused before sending |
| 10 | Attack: inside an open window, send addPayee from the funder's own address without its post-quantum signature | ✓ reverted on chain (BadPqcSignature): the attacker was not added | [37C1E57DB0…](https://explore.qore.network/tx/37C1E57DB0F981D06B6A693056673ABCD16F615197447CA0BAB06C66EB9D5D07) |
| 11 | Attack: the funder's statement signed with the attacker's own registered ML-DSA-87 key | ✓ refused: BadPqcSignature | refused before sending |
| 12 | Replay to the relayer: it returns the first payment and sends nothing new | ✓ answered with 0x0f21cd3d7df16981baee8ab26a411daea1e36f50fb554d3ad0ee496d3d6c4b6b |  |
| 13 | Attack: replay the spender's signed payment straight to the chain | ✓ refused: BadNonce | refused before sending |
| 14 | Attack: a properly signed payment to an address the funder never approved | ✓ refused: NotApproved | refused before sending |
| 15 | Attack: raise the amount to 20 fUSD after the spender signed 1 fUSD | ✓ refused: BadPqcSignature | refused before sending |
| 16 | Rule: a payment over the 30 fUSD cap is refused, even properly signed | ✓ refused: OverPaymentLimit | refused before sending |
| 17 | Rule: payments count towards the 60 fUSD weekly limit | ✓ 55 of 60 fUSD spent this week | [ACA3EC0CC3…](https://explore.qore.network/tx/ACA3EC0CC31BB93E168E8ADD802371C42D5AD0DC3D871994A8D9C0D7255E524D) |
| 18 | Rule: a payment past the weekly limit is refused | ✓ refused: OverPeriodLimit (5 fUSD left this week) | refused before sending |
| 19 | The funder freezes the pot (the lost-phone button), post-quantum signed | ✓ frozen | [5C108471FC…](https://explore.qore.network/tx/5C108471FC781D0EAE7F8D9583E8F19624F0E7F60C8258F8D547A97BF513D648) |
| 20 | A properly signed payment from a frozen pot is refused | ✓ refused: PotFrozen | refused before sending |
| 21 | After the end date, the rest goes back to the funder (anyone may trigger it) | ✓ 5 fUSD back with the funder | [5A9A277BAD…](https://explore.qore.network/tx/5A9A277BAD95A94BDEBC0A95BBFA0521939D7E21046F10D9E4EB1643A8B3CE45) |

## What the refusals mean

- **Refused by the chain** (check 9): the funder's account has a registered ML-DSA-87 key, so QoreChain itself refuses a transaction signed with the classical key alone. A stolen ECDSA key can't even open an EVM window.
- **Reverted on chain** (check 10): sent from the funder's own address inside a window the funder opened, but without the funder's post-quantum signature over the statement. The contract's `pqcVerify` check rejects it; the payee list didn't change.
- **Refused** (checks 11, 14–16, 18, 20): the relayer simulates every call first and doesn't send one the contract would reject, so these cost nothing. The reason is the contract's own error. Check 13 asks the chain directly, from the attacker's own account, what it would do with the replayed payment.
- **Check 4** does the contract's check again without the contract: it reads the statement and the spender's key from the chain as of the block before the payment, and verifies the ML-DSA-87 signature itself. The same signature over a changed amount fails. The app's **Verify** button does the same in the browser.

## An earlier run

Before spending rules and freezing were added, the first build (`0x3A0039AC653f8876b8BEF5deBf56A0dAB5aaa2b3`, source `cc4b416`) passed 15 of 15 of the same flow and attacks on 26 Nov 2026. Two of its first attempts failed because of the test, not the contract, and were fixed in the run script: the SDK throws (rather than returns) the chain's refusal of a classical-only window, and the relayer answers a repeated call from its cache, so a replay is now also sent straight to the chain.

# Crumena on QoreChain testnet: the live run

The run in [`server/scripts/testnet-run.ts`](../server/scripts/testnet-run.ts), against the deployed contract, on 2026-11-27 at 10:34 UTC. **23 of 23 checks passed.** Every signature in it is a real ML-DSA-87 signature over the statement the contract builds, checked on chain by QoreChain's `pqcVerify` precompile. The raw output is [`testnet-run.json`](testnet-run.json).

**Explorer links:** QoreChain's explorer opens on mainnet; switch it to **Testnet** at the top of the page (it keeps the choice). Contract calls are linked by the QoreChain transaction that carried them, which is what the explorer finds.

## The contract

| | |
|---|---|
| Address | `0xaF8Bed9f9e3C21F2E7a79c9968bFedA54d92E1F5` on `qorechain-diana` (EVM chain id 9800) |
| Deployed in | [0xec0ad89bccdfbd05…](https://explore.qore.network/tx/F7BC7536A200BDDE61F9668015B764CC54CB75D6C6FF03C11D82A89B2826D793), block 10,842,822 |
| Through | a 1-transaction EVM window, hybrid-signed: [7F6C7183E30944EF…](https://explore.qore.network/tx/7F6C7183E30944EFF8E1BE4B74189EDFBA2124C1AC0FE8C42645B6D4E3E24786) |
| Source | commit [`84ca8f6`](https://github.com/phoenix-2203/crumena/tree/84ca8f638da1f7fbe43d2fd82e41f38d4af134b6) (v4: v3 plus the QCAI v3 fixes, see [AUDIT.md](AUDIT.md#v3-and-the-v4-changes)); solc 0.8.28, optimizer 200 runs, via-IR, evm cancun (contracts/foundry.toml) |
| Code match | [`server/scripts/match-bytecode.ts`](../server/scripts/match-bytecode.ts) deploys this source locally and compares runtime code: 24,122 bytes, keccak `0x4e03ea50…f96c` both here and on testnet |

## The people

Fresh throwaway accounts made by the run, each with an ML-DSA-87 key registered on chain with proof of possession (the second shop has none, on purpose).

| Role | Account |
|---|---|
| Funder | `qor1fjvghvanvsg3r95kc5vyzu9gvat6970fv30w26` |
| Spends the pot | `qor1gfpt5tj69ec92e0jfrmjq0tn8afcgas9upxnla` |
| Halden Building Supplies (payee, up to 60 fUSD) | `qor17nqj3z88h2uwhatpufd7apvj9e2xak9wmkp860` |
| Brightline Electrical (payee, no PQ key, up to 12 fUSD) | `qor18mh8ms6s6mc405tyzu2an7krzqe04pfdpm2hr7` |
| Attacker | `qor146psv64vfxc78hpdk5c993jtw2fmdn5zfyests` |
| Relayer (pays gas only) | `qor1ey4prsgv94zc4gdf8dzdupagwj2mstz5tlh9xh` |

## The checks

| # | Check | Result | Transaction |
|---|---|---|---|
| 1 | Funder creates a pot, signed with ML-DSA-87 and checked by pqcVerify | ✓ pot #2, vault 0xccF2aeb474fbc953Df1509664d94Ec562d600CA7, one approved payee (up to 60 fUSD) | [B9BBF0E3B7…](https://explore.qore.network/tx/B9BBF0E3B72D34A71F19CC0BD6656335E0361F97A9E4B0AE626E545DA7779843) |
| 2 | The pot's short link code (the first 8 bytes of its vault) finds it | ✓ potOfCode(0xccF2aeb474fbc953) = 2 |  |
| 3 | Funder pays 100 fUSD into the pot's address from the bank lane (MsgConvertCoin, hybrid-signed) | ✓ pot balance 100 fUSD | [7C7473CBDC…](https://explore.qore.network/tx/7C7473CBDCFD62E811CFA6A52C096D46F88AD88105565B673AB8726F748226C0) |
| 4 | The person spending the pot pays the approved shop 25 fUSD, post-quantum signed | ✓ shop received 25 fUSD; the spender sent no transaction and paid no gas | [87187494AB…](https://explore.qore.network/tx/87187494ABBECBD676C90CC4DBD13F3ACB199DD872C06DC5E4DD9E4406773FCA) |
| 5 | Independent check of that payment: statement and key read from the chain at the block before, ML-DSA-87 verified off chain | ✓ signature valid: true; the same signature over "Amount: 26": false |  |
| 6 | The shop confirms the address is its own, with its own ML-DSA-87 key | ✓ payee marked confirmed on chain | [9DD54E3773…](https://explore.qore.network/tx/9DD54E3773D04BBAB36C3C55CA86D4C179E4FBDEE4EF7A8D4D99FFBAFED2BCA6) |
| 7 | The spender asks the funder to approve a new shop, for 15 fUSD | ✓ request recorded with its amount; the pot still can't pay it | [D4306AE66E…](https://explore.qore.network/tx/D4306AE66E32463799F057549A5BF20E07640C4DF9ABB0685F8CFFB1B8319A2D) |
| 8 | The funder approves it up to 12 fUSD, an amount of its own choice, post-quantum signed | ✓ Brightline Electrical approved, up to 12 fUSD in total | [448BA1968B…](https://explore.qore.network/tx/448BA1968BF97976D14E5EF925D143FF0A23EE52867AD66B2E0DC659C1F73D6B) |
| 9 | The spender pays the new shop 10 fUSD | ✓ a shop with no post-quantum key of its own can still be paid | [F39293A3D0…](https://explore.qore.network/tx/F39293A3D000AB1E3A6FFD014718126BE307A4B6E70F38884D1DE8D5279E1861) |
| 10 | Rule: a payment past what the funder approved for that shop is refused, even properly signed | ✓ refused: OverPayeeLimit (2 fUSD left for this shop) | refused before sending |
| 11 | Attack: open an EVM window with the funder's stolen classical key only | ✓ refused by the chain: account qor1fjvghvanvsg3r95kc5vyzu9gvat6970fv30w26 has a registered PQC key and must include the hybrid signature extension (hybrid mode: required): hybrid PQC signature required | refused before sending |
| 12 | Attack: inside an open window, send addPayee from the funder's own address without its post-quantum signature | ✓ reverted on chain (BadPqcSignature): the attacker was not added | [B3BE783CCC…](https://explore.qore.network/tx/B3BE783CCC4F48216B0B3A834E64F0082340707DAD5D022841CAB1B44C1D6AF2) |
| 13 | Attack: the funder's statement signed with the attacker's own registered ML-DSA-87 key | ✓ refused: BadPqcSignature | refused before sending |
| 14 | Replay to the relayer: it returns the first payment and sends nothing new | ✓ answered with 0x8e567f34378141c27f9e5904b29a6093535d62323500c201b4a6a90a9847fb10 |  |
| 15 | Attack: replay the spender's signed payment straight to the chain | ✓ refused: BadNonce | refused before sending |
| 16 | Attack: a properly signed payment to an address the funder never approved | ✓ refused: NotApproved | refused before sending |
| 17 | Attack: raise the amount to 20 fUSD after the spender signed 1 fUSD | ✓ refused: BadPqcSignature | refused before sending |
| 18 | Rule: a payment over the 30 fUSD cap is refused, even properly signed | ✓ refused: OverPaymentLimit | refused before sending |
| 19 | Rule: payments count towards the 60 fUSD weekly limit | ✓ 55 of 60 fUSD spent this week | [6E11D01931…](https://explore.qore.network/tx/6E11D01931E9FBDC56945D0AF0A94F515695182D4DE1F9DC99E6320AA39B66AE) |
| 20 | Rule: a payment past the weekly limit is refused | ✓ refused: OverPeriodLimit (5 fUSD left this week) | refused before sending |
| 21 | The funder freezes the pot (the lost-phone button), post-quantum signed | ✓ frozen | [46FF9D0F84…](https://explore.qore.network/tx/46FF9D0F84ED08A7B65B3A80150C2C24C61913B1D7BB4F4BC49ACA0D87E5F2D3) |
| 22 | A properly signed payment from a frozen pot is refused | ✓ refused: PotFrozen | refused before sending |
| 23 | After the end date, the rest goes back to the funder (anyone may trigger it) | ✓ 5 fUSD back with the funder | [11DA653DD5…](https://explore.qore.network/tx/11DA653DD5ECB1C75F7070EE666E4BF38EE731302CDAACF89F09AA8FFC477901) |

## What the refusals mean

- **Refused by the chain** (check 11): the funder's account has a registered ML-DSA-87 key, so QoreChain itself refuses a transaction signed with the classical key alone. A stolen ECDSA key can't even open an EVM window.
- **Reverted on chain** (check 12): sent from the funder's own address inside a window the funder opened, but without the funder's post-quantum signature over the statement. The contract's `pqcVerify` check rejects it; the payee list didn't change.
- **Refused** (checks 10, 13, 16–18, 20, 22): the relayer simulates every call first and doesn't send one the contract would reject, so these cost nothing. The reason is the contract's own error. Check 15 asks the chain directly, from the attacker's own account, what it would do with the replayed payment.
- **Check 2** finds the pot from its short link code (`/p/<code>` in the app): the code is the first 8 bytes of the pot's vault address, and the contract keeps the lookup.
- **Checks 7–10** are the payee amounts: the spender asks for a new shop with an amount (15 fUSD), the funder approves a different amount of its own choice (12 fUSD), and a properly signed payment that would take the shop past it is refused.
- **Check 5** does the contract's check again without the contract: it reads the statement and the spender's key from the chain as of the block before the payment, and verifies the ML-DSA-87 signature itself. The same signature over a changed amount fails. The app's **Verify** button does the same in the browser.

## Earlier runs

v3 (`0x08E9234d443CeF03ecf118dCa2D4f1002Abc9128`, source `7b11386`, before the QCAI v3 fixes) passed the same 23 of 23 on 27 Nov 2026 at 04:53 UTC. The build before that (`0xD98320A95030874498b92e9cf66f95F83dDe47af`, source `da53d0a`, before per-payee amounts and short links) passed 21 of 21 on 26 Nov 2026. Before spending rules and freezing were added, the first build (`0x3A0039AC653f8876b8BEF5deBf56A0dAB5aaa2b3`, source `cc4b416`) passed 15 of 15 of the same flow and attacks on 26 Nov 2026. Two of its first attempts failed because of the test, not the contract, and were fixed in the run script: the SDK throws (rather than returns) the chain's refusal of a classical-only window, and the relayer answers a repeated call from its cache, so a replay is now also sent straight to the chain.

# QCAI audit

The Post-Quantum dApp track asks for a two-stage audit with QoreChain's AI auditor (QCAI, at [dashboard.qorechain.io/audit](https://dashboard.qorechain.io/audit)). Both stages use the **"Ethereum (EVM/Solidity)"** setting. QCAI shows "Quantum readiness: not scored" for that setting; the post-quantum design is explained in the [README](../README.md#how-it-works) and the [threat model](THREAT_MODEL.md).

| Stage | Date | Report | Score | Findings |
|---|---|---|---|---|
| Stage 1 | 2026-11-26 | [`audit/stage1-2026-11-26.pdf`](audit/stage1-2026-11-26.pdf) | 82/100 (risk: medium) | 1 high, 2 medium, 1 low, 1 info |
| Stage 2 | 2026-11-26 | [`audit/stage2-2026-11-26.pdf`](audit/stage2-2026-11-26.pdf) | 82/100 (risk: medium) | 1 high, 2 medium, 1 low, 1 info |
| v3, stage 1 | 2026-11-27 | [`audit/v3-stage1-2026-11-27.pdf`](audit/v3-stage1-2026-11-27.pdf) | 72/100 (risk: high) | 2 high, 2 medium, 1 low |

**Audited code.** One file, [`audit/Crumena-v2.audit.sol`](audit/Crumena-v2.audit.sol): the contract's four sources (`lib/Text.sol`, `lib/Pqc.sol`, `PotVault.sol`, `Crumena.sol`) joined without changes, only their import, pragma and licence lines dropped. It is the previous build, deployed at `0xD98320A95030874498b92e9cf66f95F83dDe47af`. The current build (`0x08E9234d443CeF03ecf118dCa2D4f1002Abc9128`, [`TESTNET_RUN.md`](TESTNET_RUN.md)) adds per-payee amounts and short links; its joined file is [`audit/Crumena.audit.sol`](audit/Crumena.audit.sol), audited again below ([v3](#v3-the-current-build)). QCAI's line numbers don't point at the lines it describes in that file (line 658 is inside `addPayeeStatement`, for example), so findings are matched to the code by what they describe.

## Stage 1 findings and what we did

All five were worked through. None needed a change to the contract: each describes something the contract already prevents. Each now has regression tests in [`contracts/test/Audit.t.sol`](../contracts/test/Audit.t.sol) (18 tests for both stages, all passing), so the source and the live deployment stay as they are.

| # | QCAI finding | Severity | Resolution | Regression tests |
|---|---|---|---|---|
| QCAI-1 | Potential privilege escalation via incorrect nonce management | HIGH | **Already prevented.** See [QCAI-1](#qcai-1). | `test_qcai1_aSignatureWorksOnceAndOnlyAtTheSignersNextNonce`, `test_qcai1_noncesArePerSignerAndOnlyMoveForAValidSignature`, `test_qcai1_aStatementNamesItsContractSoItCantBeReplayedOnAnother`; plus the live run's replay check (`BadNonce` on testnet) |
| QCAI-2 | Potential overflow in period calculation | MEDIUM | **False positive.** See [QCAI-2](#qcai-2). | `test_qcai2_periodLengthIsBoundedAtCreationAndWhenChanged`, `test_qcai2_periodsStayCorrectCenturiesAhead`, `testFuzz_qcai2_periodSpendingNeverOverflows` |
| QCAI-3 | Unchecked return values from external calls (`PotVault`) | MEDIUM | **False positive: the return value is checked.** See [QCAI-3](#qcai-3). | `test_qcai3_aTransferThatReturnsFalseReverts`, `test_qcai3_aTransferThatRevertsReverts`, `test_qcai3_aTokenThatReturnsNothingStillWorks`, `test_qcai3_aPotsTokenAlwaysHasCode`, `test_qcai3_onlyCrumenaMovesAVaultsMoney` |
| QCAI-4 | Unbounded loop in payee listing | LOW | **Already bounded.** See [QCAI-4](#qcai-4). | `test_qcai4_thePayeeListIsCappedAndNeverGrowsTwiceForOneAddress` |
| QCAI-5 | Potential front-running in signature validation | INFO | **Already in the suggested order; front-running is harmless.** See [QCAI-5](#qcai-5). | `test_qcai5_aFailedSignatureChangesNothing`, `test_qcai5_whoeverSubmitsASignedActionGetsTheSignersEffectAndNothingElse` |

### QCAI-1

Every signed action goes through `_authorize`, which accepts a signature only if **all** of these hold:
- the nonce is exactly the signer's next one (`a.nonce == nonceOf[signer]`), so a signature works once and can't be used early;
- the signature hasn't expired, and was never valid for more than 7 days;
- the chain is the one the contract was deployed for;
- the ML-DSA-87 signature verifies, through QoreChain's `pqcVerify` precompile, against the key QoreChain has on record for **that** signer (`pqcKeyStatus`), over a statement that names the action, its every argument, the signer, the nonce, the deadline, the contract and the chain.

Only then is the nonce advanced, by exactly one. Nonces are per signer, so one person's signatures never touch another's. Who may sign is fixed by the contract for each action (the pot's funder; for a payment, its spender or funder, checked against the pot; or the payee itself), so there is nothing to escalate to.

### QCAI-2

Solidity 0.8 checks all arithmetic, so nothing can wrap silently. The period length is between 1 and 366 days (`BadRules` otherwise, at creation and when changed), the division is by at least one day, and `block.timestamp - createdAt` is never negative because a pot's creation time is in the past. The resulting period number fits `uint64` for longer than the universe will exist. The tests run payments 300 years ahead and fuzz up to 10,000 years.

### QCAI-3

`PotVault.send` does check the result: it reverts with `TransferFailed` if the call fails, or if the token returns anything other than nothing or `true`. Tokens that return nothing (older ERC-20s) are accepted, as is standard. A call to an address with no code would also "succeed", so the contract refuses any token without code when a pot is created (`BadToken`); a pot's token always has code. Only the Crumena contract that created a vault can call `send`.

### QCAI-4

There is no unbounded loop. A pot's payee list is capped: at most 10 at creation and 50 in total (`TooManyPayees`), and an address is listed once however often it is removed and approved again. The only loops over it are in view functions (`payeesOf`) and in `createPot`'s check of the 10 initial payees for duplicates (at most 45 comparisons).

### QCAI-5

The contract already does what QCAI suggests: in every action, the signature is checked (inside `_authorize`) before any state changes, and a failed check leaves everything as it was, the nonce included. Submitting someone else's signed action ahead of the relayer only produces the effect the signer asked for: the money goes to the payee they named, never to whoever submitted it, and the relayer's late copy fails harmlessly with `BadNonce`. That is what lets a relayer pay everyone's gas without being trusted.

## Stage 2

Same setting, same file, after Stage 1 was worked through. The contract is unchanged: no Stage 1 finding called for a change (see above), and the live deployment is this exact code. The score is again **82/100**, with five findings. QCAI's AI review isn't deterministic: two findings are Stage 1's again (period overflow; the payee loop, now located in `_checkNewPot`), one Stage 1 finding didn't come back (front-running), and three are worded as new. All five are answered below; the new ones have their own tests.

| # | Stage 2 finding | Severity | Same as | Resolution | Regression tests |
|---|---|---|---|---|---|
| S2-1 | Missing access control on `PotVault.send()` | HIGH | new (related to QCAI-3) | **Already in place.** See [S2-1](#s2-1). | `test_s2_1_anotherCrumenaCantMoveThisCrumenasVault`, `test_qcai3_onlyCrumenaMovesAVaultsMoney` |
| S2-2 | Potential overflow in period calculation | MEDIUM | QCAI-2 | **False positive**, as in [QCAI-2](#qcai-2). | the three `qcai2` tests |
| S2-3 | Reentrancy risk in `PotVault.send()` via external call | MEDIUM | new | **Not exploitable: every state change happens before the transfer.** See [S2-3](#s2-3). | `test_s2_3_reEnteringWithTheSameSignedPaymentFindsItsNonceUsed`, `test_s2_3_reEnteringReclaimOnlyEverPaysTheFunder` |
| S2-4 | Unbounded loop in `_checkNewPot()` | LOW | QCAI-4 | **Bounded by ten payees.** See [S2-4](#s2-4). | `test_s2_4_theDuplicateCheckIsBoundedByTenPayees`, `test_rejectsDuplicatePayees` |
| S2-5 | ERC-20 token interaction | INFO | new | **Already handled.** See [S2-5](#s2-5). | `test_qcai3_*`, `test_rejectsATokenThatIsNotAContract`, `test_rejectsATokenWithAStrangeSymbol` |

### S2-1

`PotVault.send` reverts with `NotCrumena` unless the caller is the vault's own `crumena`, an immutable set to the contract that created it. A vault only ever has one: another Crumena deployment, or anyone else, can't move its money (tested). Inside Crumena, `send` is only reached through `pay`, `release` and `reclaim`, always with the pot's own vault and token taken from storage, after that action's checks.

### S2-3

The suggestion to use `transfer()` applies to sending the chain's native coin; pots hold ERC-20 tokens, and a low-level `call` with the return value checked is the standard safe way to call `transfer` on them. Crumena follows checks-effects-interactions: before any vault transfer, the signer's nonce has moved on, and `paidOut`, the period's spending and `closed` are updated. So a token that calls back into Crumena during a transfer gains nothing:
- re-entering `pay` with the same signed payment fails with `BadNonce` (tested with a token that tries exactly that);
- re-entering `reclaim` can only send money to the funder, the one place it may go (tested);
- everything else needs a fresh signature from the funder, spender or payee.

A pot's token is chosen by its funder; a token that misbehaves can only affect its own balances.

### S2-4

`_checkNewPot` compares the initial payees pairwise to refuse duplicates, but there are at most ten of them (`TooManyPayees` above that), so at most 45 comparisons. A mapping wouldn't be cheaper for ten entries. Creating a pot with ten payees uses about 2.6 million gas in the tests (with the test stand-in for `pqcVerify`, which costs more than the real precompile; a one-payee pot used 997,000 on testnet), within the relayer's 3 million per-call cap.

### S2-5

Every token call is defensive. `decimals()` and `symbol()` are read once, by `staticcall`, with their answers' shapes checked (`BadToken` otherwise, and symbols must be short plain text so statements stay readable); `balanceOf` is a checked `staticcall`; `transfer` accepts the standard `true` and older tokens that return nothing, and reverts on anything else; an address without code can't be a pot's token.

## v3: the current build

Same setting, on [`audit/Crumena.audit.sol`](audit/Crumena.audit.sol) (v3: per-payee amounts, short links). **72/100**, five findings. Four are the earlier findings again, located elsewhere. One pointed at a real, small defect, now fixed.

| # | v3 finding | Severity | Same as | Resolution | Regression tests |
|---|---|---|---|---|---|
| V3-1 | Missing access control on `PotVault.send()` | HIGH | S2-1 | **Already in place**, as in [S2-1](#s2-1): `NotCrumena` unless the caller is the vault's creator. | `test_s2_1_anotherCrumenaCantMoveThisCrumenasVault`, `test_qcai3_onlyCrumenaMovesAVaultsMoney` |
| V3-2 | Potential overflow in period calculation | HIGH | QCAI-2, S2-2 | **Fixed: one subtraction could underflow, with no effect on money.** See [V3-2](#v3-2). | `test_aPeriodLimitLoweredBelowWhatWasSpentRefusesCleanly`, the three `qcai2` tests |
| V3-3 | Reentrancy risk in `PotVault.send()` | MEDIUM | S2-3 | **Not exploitable**, as in [S2-3](#s2-3): every state change happens before the transfer. | the two `s2_3` tests |
| V3-4 | Unbounded loop in `payeesOf()` | MEDIUM | QCAI-4 | **Bounded**, as in [QCAI-4](#qcai-4): at most 50 payees, and `payeesOf` is a view no transaction calls. | `test_qcai4_thePayeeListIsCappedAndNeverGrowsTwiceForOneAddress` |
| V3-5 | Missing ERC-20 interface compliance | LOW | S2-5 | **Not applicable.** See [V3-5](#v3-5). | the `qcai3` tests, `test_rejectsATokenThatIsNotAContract` |

### V3-2

Line 420 of the joined file is the limit check in `pay`. Nothing there can wrap silently (Solidity 0.8 checks all arithmetic), but one case reverted with an arithmetic panic instead of the contract's own error: a funder keeps the period length and lowers the period limit below what was already spent this period (say 50 of 60 spent, limit lowered to 40). The next payment was refused, as it should be, but while building the "how much is left" number for `OverPeriodLimit`, `periodLimit - spent` underflowed, so the app could only say "the transaction was refused". No money could move. The fix gives `OverPeriodLimit(0)`, the same guard the per-payee check already had. The new test lowers the limit below what was spent, expects `OverPeriodLimit(0)`, then checks that payments work again from the next period.

The fix is in the source (commit `66fbd37`). The contract deployed at `0x08E9234d443CeF03ecf118dCa2D4f1002Abc9128` was built before it and still has the old line until the next deploy.

### V3-5

Crumena isn't a token and doesn't claim to be one. Its `balanceOf(potId)` is the money in one pot, read from the pot's token with a checked `staticcall`; the name matches ERC-20 but it takes a pot number, not an address. Calls to the pot's token are as described in [S2-5](#s2-5).

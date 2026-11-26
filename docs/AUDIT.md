# QCAI audit

The Post-Quantum dApp track asks for a two-stage audit with QoreChain's AI auditor (QCAI, at [dashboard.qorechain.io/audit](https://dashboard.qorechain.io/audit)). Both stages use the **"Ethereum (EVM/Solidity)"** setting. QCAI shows "Quantum readiness: not scored" for that setting; the post-quantum design is explained in the [README](../README.md#how-it-works) and the [threat model](THREAT_MODEL.md).

| Stage | Date | Report | Score | Findings |
|---|---|---|---|---|
| Stage 1 | 2026-11-26 | [`audit/stage1-2026-11-26.pdf`](audit/stage1-2026-11-26.pdf) | 82/100 (risk: medium) | 1 high, 2 medium, 1 low, 1 info |
| Stage 2 | *pending* | | | |

**Audited code.** One file, [`audit/Crumena.audit.sol`](audit/Crumena.audit.sol): the contract's four sources (`lib/Text.sol`, `lib/Pqc.sol`, `PotVault.sol`, `Crumena.sol`) joined without changes, only their import, pragma and licence lines dropped. It is the code deployed at `0xD98320A95030874498b92e9cf66f95F83dDe47af` ([`TESTNET_RUN.md`](TESTNET_RUN.md)). QCAI's line numbers don't point at the lines it describes in that file (line 658 is inside `addPayeeStatement`, for example), so findings are matched to the code by what they describe.

## Stage 1 findings and what we did

All five were worked through. None needed a change to the contract: each describes something the contract already prevents. Each now has regression tests in [`contracts/test/Audit.t.sol`](../contracts/test/Audit.t.sol) (14 tests, all passing), so the source and the live deployment stay as they are.

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

*To be run on the same file after this response. Results and any differences will be recorded here.*

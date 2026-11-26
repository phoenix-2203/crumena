# Crumena threat model

## What is protected

The money in each pot, and the funder's rules for it: who spends it, which payees it may pay, how much per payment and per period, whether it is frozen, and when the rest goes back.

## Trust assumptions

- QoreChain's `pqcKeyStatus` (`0x…0a02`) reports each account's registered ML-DSA-87 key truthfully, and `pqcVerify` (`0x…0a01`) verifies ML-DSA-87 correctly.
- QoreX shows the person the exact text it signs and signs `qorechain-msg-v1|<chain id>|<text>`.
- The pot's token is an ordinary ERC-20 (fUSD on testnet). The funder chooses it.

Nothing else is trusted: not the relayer, the server, the app's host, or whoever submits a transaction.

## Who might attack, and what stops them

| Attacker | Goal | What stops it |
|---|---|---|
| **Quantum adversary or thief with a classical (secp256k1) key** | act as the funder or spender | Every action is authorised only by an ML-DSA-87 signature, checked against the key the chain has on record for that account. A classical signature, or a valid ML-DSA-87 signature from any other key, is refused (`BadPqcSignature`). The chain also refuses to open an EVM window with a classical-only signature. |
| **The relayer** (or anyone who submits) | change an action, or act alone | It only carries calldata. The contract rebuilds the statement from that calldata and checks the signature over it, so any change breaks the signature. The relayer's own account authorises nothing. The one unsigned call, `reclaim`, works only after the end date (or once closed) and pays only the funder. |
| **The relayer** | refuse or delay | Liveness only, no loss of funds. Anyone can submit a signed action from any account. After the end date, anyone can return the rest to the funder. |
| **A tampered server or app host** | get someone to sign something else | The text shown in QoreX is what gets signed, and it names the action, pot, amount, payee address, signer, nonce, deadline, contract and chain. The app also checks the statement line by line against what the person asked for before handing it to QoreX (tested in `app/test/flow.test.ts`). |
| **Replay** | reuse a signature | Nonces are per signer and must be the next one in order. Signatures expire (at most 7 days ahead, and the app asks for 30 minutes). Statements name the contract and the chain, and the constructor checks `block.chainid`. |
| **The spender** | pay someone not approved, overspend, or keep the money | `pay` only reaches approved payees (and only confirmed ones if the pot requires it), never above the cap per payment or the limit per period, and never from a frozen pot. The funder, the spender, pot vaults and the contract itself can't be made payees. Asking for a new payee does nothing until the funder signs its approval. |
| **A thief with the spender's phone** | drain the pot | Payments stay within the limits and go only to approved payees; the funder freezes the pot with one signed statement. |
| **The funder** | take the money back early | There is no early withdrawal: before the end date the funder can only approve or remove payees, change limits, freeze, extend the end date, or release everything to the spender. The end date can only move later. Freezing stops payments but doesn't move money. |
| **A payee** | be paid without being approved | Confirming an address only marks an already-approved payee as confirmed. It approves nothing. |
| **Look-alike text** | hide a different address in a name or memo | Text is printable ASCII only (no line breaks, no look-alike Unicode letters) and has a length cap. Addresses always sit on their own `Address:` line, written by the contract. |
| **Front-running a signed action** | change its effect | Submitting someone else's signed action has exactly the effect they signed. Each pot's vault comes from CREATE2 with salt `(funder, nonce)`, and the funder's statement shows its address before signing. |
| **Crumena's server shows a false history** | hide or invent payments | Balances, limits and payees are read from the contract. **Verify** checks any history entry against the chain directly: the transaction, the statement as of the block before, the key on record at that block, and the ML-DSA-87 signature, all in the browser. |
| **Abuse of the demo** | drain the relayer's test funds | Demo people are rate-limited per visitor and per day; each gets just enough test QOR to register a key, and a demo pot gets 50 test fUSD once. Demo keys are throwaway testnet keys kept in that browser. |
| **Spam against the relayer's gas** | drain the relayer | The relayer simulates each call first and sends only calls to the Crumena contract that would succeed. It rate-limits by IP and only opens windows scoped to the Crumena contract. |

## Residual risks

- **Names are labels, not identities.** A payee's name is whatever the funder (or the spender, when asking) typed. The address line is what counts, and `confirmedOnly` pots add the payee's own signature.
- **Relayer liveness.** If the hosted relayer is down, people need another way to submit (any account, any tool).
- **Token behaviour.** A pot trusts its token. Fee-on-transfer or blocklisting tokens could leave payments short or blocked. The pot balance is always read live, so no internal number goes wrong.
- **Key loss.** A funder who loses their QoreX account can't act on a pot. The money still goes back to their address after the end date.
- **Funder and limits.** Limits and freezing protect the funder's purpose, not the spender: a funder can freeze a pot the spender was counting on. The money still can't go anywhere but approved payees, the spender (release) or back to the funder after the end date.
- **History completeness.** The server's history index can lag or miss entries if the RPC is down; the pot's balance and state are always read live, and Verify is independent.
- **Precompile availability.** If QoreChain's PQC precompiles stop answering, actions fail closed (`PqcUnavailable`). Money is not released.

## Where this is tested

- `contracts/test/`: unit, fuzz and invariant tests, including wrong keys, an attacker's own key, replays, other chains, both `pqcKeyStatus` answer layouts and missing precompiles.
- `server/test/`: a real ML-DSA-87 signature in QoreX's exact format.
- `app/test/flow.test.ts`: the full flow against the contract, including a tampered statement that is never shown to QoreX.
- `server/scripts/testnet-run.ts`: the same flow and six attacks against the chain's own precompiles. Results are added to `docs/` after the run.

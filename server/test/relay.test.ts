import { messagePqSignBytes, pqVerify, verifyMessage } from "@qorechain/qoresign";
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { classicalKeyFromPrivate, signMessage } from "@qorechain/qoresign";
import { encodeFunctionData, hexToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { EARMARK_ABI } from "../../shared/earmark-abi";
import { ERROR_TEXT, explainError } from "../../shared/errors";
import { CHAIN_ID, CONVERT_COIN_TYPE_URL, convertFusdMsg, registry } from "../src/chain";
import { RELAYED, createRelayer } from "../src/relay";

const EARMARK = "0x00000000000000000000000000000000000e4a2c" as Hex;
const relayer = createRelayer({} as never, EARMARK, () => {});
const auth = { nonce: 0n, validUntil: 1n, signature: "0x" as Hex };

describe("what the relayer sends", () => {
  it("accepts every signed Earmark action", () => {
    const data = encodeFunctionData({ abi: EARMARK_ABI, functionName: "pay", args: [1n, EARMARK, 5n, "", EARMARK, auth] });
    expect(relayer.parse(data)).toBe("pay");
    const r = encodeFunctionData({ abi: EARMARK_ABI, functionName: "reclaim", args: [1n] });
    expect(relayer.parse(r)).toBe("reclaim");
  });

  it("refuses calls that aren't Earmark's", () => {
    // ERC-20 transfer(address,uint256): the relayer must never move tokens of its own
    const transfer = ("0xa9059cbb" + "0".repeat(128)) as Hex;
    expect(() => relayer.parse(transfer)).toThrow(/isn't a call to Earmark/);
  });

  it("refuses Earmark functions nobody signs", () => {
    const view = encodeFunctionData({ abi: EARMARK_ABI, functionName: "balanceOf", args: [1n] });
    expect(() => relayer.parse(view)).toThrow(/doesn't send balanceOf/);
  });

  it("covers every state-changing function of the contract", () => {
    const writes = EARMARK_ABI.filter((x) => x.type === "function" && x.stateMutability === "nonpayable").map((x) => (x as { name: string }).name);
    expect([...writes].sort()).toEqual([...RELAYED].sort());
  });
});

describe("errors in plain words", () => {
  it("explains every error the contract can raise", () => {
    const errors = EARMARK_ABI.filter((x) => x.type === "error").map((x) => (x as { name: string }).name);
    for (const e of errors) expect(ERROR_TEXT[e], e).toBeTruthy();
    expect(explainError("Nope")).toBe("The transaction was refused.");
  });
});

describe("QoreX's message format", () => {
  it("is the fixed prefix, the chain id, then the text: what the contract rebuilds", () => {
    const text = "Earmark: pay from pot #1\nAmount: 5 fUSD";
    expect(Buffer.from(messagePqSignBytes(CHAIN_ID, text)).toString("utf8")).toBe(`qorechain-msg-v1|${CHAIN_ID}|${text}`);
  });

  it("gives a real ML-DSA-87 signature of the size the contract expects, over those bytes", async () => {
    const acc = await deriveUnifiedAccount(generateMnemonic(256));
    const text = "Earmark: approve a payee for pot #3\nPayee: Halden Building Supplies";
    const sig = signMessage({
      chainId: CHAIN_ID,
      signer: acc.cosmos,
      data: text,
      classicalKey: classicalKeyFromPrivate(hexToBytes(acc.privateKey as Hex), "eth_secp256k1"),
      pqKey: { secretKey: acc.pqc.secretKey },
    });
    const pq = Buffer.from(sig.pq!.signature, "base64");
    expect(pq.length).toBe(4627);
    expect(acc.pqc.publicKey.length).toBe(2592);
    // what pqcVerify checks on chain: the registered key, the prefixed message, the signature
    expect(pqVerify(acc.pqc.publicKey, messagePqSignBytes(CHAIN_ID, text), pq)).toBe(true);
    expect(pqVerify(acc.pqc.publicKey, messagePqSignBytes(CHAIN_ID, text + " "), pq)).toBe(false);
    expect(() => verifyMessage({ chainId: CHAIN_ID, signer: acc.cosmos, data: text, signature: sig, pqPublicKey: acc.pqc.publicKey, requirePq: true })).not.toThrow();
  });
});

describe("paying into a pot from the bank lane", () => {
  it("encodes MsgConvertCoin with the pot as the ERC-20 receiver", () => {
    const msg = convertFusdMsg("qor1sender", "0x1111111111111111111111111111111111111111", 25_000_000n);
    const any = registry.encodeAsAny(msg);
    expect(any.typeUrl).toBe(CONVERT_COIN_TYPE_URL);
    const back = registry.decode(any) as { coin: { denom: string; amount: string }; receiver: string; sender: string };
    expect(back.coin).toEqual({ denom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", amount: "25000000" });
    expect(back.receiver).toBe("0x1111111111111111111111111111111111111111");
    expect(back.sender).toBe("qor1sender");
  });
});

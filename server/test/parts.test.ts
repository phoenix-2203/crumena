import { describe, expect, it } from "vitest";
import { FUSD_DENOM } from "../src/chain";
import { createDemo } from "../src/demo";
import { createDepositIndex } from "../src/deposits";

const VAULT = "0x0A6d021A89F99F6050F82f769F6058BCC5FDDf7B";
const tx = (hash: string, height: number, msg: Record<string, unknown>, code = 0) => ({
  txhash: hash,
  height: String(height),
  timestamp: "2026-11-26T07:18:27Z",
  code,
  tx: { body: { messages: [{ "@type": "/cosmos.evm.erc20.v1.MsgConvertCoin", ...msg }] } },
});

describe("bank-lane deposits", () => {
  it("indexes fUSD converted into a pot's address, newest first, once each", () => {
    const idx = createDepositIndex({ since: new Date(0) });
    idx.add(tx("A", 10, { coin: { denom: FUSD_DENOM, amount: "100000000" }, receiver: VAULT.toLowerCase(), sender: "qor1funder" }) as never);
    idx.add(tx("B", 12, { coin: { denom: FUSD_DENOM, amount: "5000000" }, receiver: VAULT, sender: "qor1aunt" }) as never);
    idx.add(tx("B", 12, { coin: { denom: FUSD_DENOM, amount: "5000000" }, receiver: VAULT, sender: "qor1aunt" }) as never);
    expect(idx.of(VAULT).map((d) => [d.tx, d.from, d.amount])).toEqual([
      ["B", "qor1aunt", "5000000"],
      ["A", "qor1funder", "100000000"],
    ]);
  });
  it("ignores failed transactions, other tokens and junk receivers", () => {
    const idx = createDepositIndex({ since: new Date(0) });
    idx.add(tx("C", 1, { coin: { denom: FUSD_DENOM, amount: "1" }, receiver: VAULT, sender: "qor1x" }, 5) as never);
    idx.add(tx("D", 2, { coin: { denom: "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28", amount: "1" }, receiver: VAULT, sender: "qor1x" }) as never);
    idx.add(tx("E", 3, { coin: { denom: FUSD_DENOM, amount: "1" }, receiver: "not-an-address", sender: "qor1x" }) as never);
    expect(idx.of(VAULT)).toEqual([]);
  });
});

describe("demo limits", () => {
  const demo = createDemo({ relayer: {} as never, crumena: VAULT, exclusive: (w) => w(), perIpPerHour: 2, perDay: 3 });
  it("limits each visitor per hour and everyone per day", () => {
    expect(demo.allow("1.1.1.1")).toBeUndefined();
    expect(demo.allow("1.1.1.1")).toBeUndefined();
    expect(demo.allow("1.1.1.1")).toMatch(/this hour/);
    expect(demo.allow("2.2.2.2")).toBeUndefined();
    expect(demo.allow("3.3.3.3")).toMatch(/busy today/);
  });
});

import { useState } from "react";
import type { Address } from "viem";
import { explain, NO_RULES, type Rules } from "../lib/crumena";
import { parseUnits, printable, toEvm } from "../lib/format";
import { go, useApp } from "../state";
import { NeedsSigner } from "../ui";

const DAY = 86_400;
const ENDS = [
  ["1 week", 7],
  ["1 month", 30],
  ["3 months", 91],
  ["1 year", 365],
] as const;
const PERIODS = [
  ["a day", 1],
  ["a week", 7],
  ["a month (30 days)", 30],
] as const;

export function NewPot() {
  return (
    <NeedsSigner>
      <Form />
    </NeedsSigner>
  );
}

function Form() {
  const { crumena, signer, demo, toast } = useApp();
  const spenderDemo = demo?.find((p) => p.role === "spender");
  const shopDemo = demo?.find((p) => p.role === "shop");
  const [purpose, setPurpose] = useState(demo ? "Monthly budget" : "");
  const [spender, setSpender] = useState(spenderDemo?.qor ?? "");
  const [payees, setPayees] = useState<{ name: string; address: string }[]>(
    shopDemo ? [{ name: "Approved vendor", address: shopDemo.qor }] : [{ name: "", address: "" }],
  );
  const [days, setDays] = useState(30);
  const [cap, setCap] = useState(demo ? "20" : "");
  const [limit, setLimit] = useState(demo ? "40" : "");
  const [periodDays, setPeriodDays] = useState(7);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function check(): { recipient: Address; payeeAddrs: Address[]; rules: Rules } | undefined {
    const e: Record<string, string> = {};
    let recipient: Address | undefined;
    if (!purpose.trim()) e.purpose = "Say what the money is for.";
    else if (!printable(purpose) || purpose.length > 80) e.purpose = "Up to 80 plain letters, numbers and punctuation.";
    try {
      recipient = toEvm(spender);
      if (recipient.toLowerCase() === signer!.me.evm.toLowerCase()) e.spender = "The spender is someone other than you.";
    } catch (x) {
      e.spender = (x as Error).message;
    }
    const payeeAddrs: Address[] = [];
    payees.forEach((p, i) => {
      if (!p.name.trim() || !printable(p.name) || p.name.length > 48) e[`name${i}`] = "A name, up to 48 plain characters.";
      try {
        const a = toEvm(p.address);
        if (payeeAddrs.some((x) => x.toLowerCase() === a.toLowerCase())) e[`addr${i}`] = "Listed twice.";
        if (a.toLowerCase() === signer!.me.evm.toLowerCase() || a.toLowerCase() === recipient?.toLowerCase()) e[`addr${i}`] = "You and the spender can't be payees.";
        payeeAddrs.push(a);
      } catch (x) {
        e[`addr${i}`] = (x as Error).message;
      }
    });
    const rules: Rules = { ...NO_RULES };
    try {
      if (cap.trim()) rules.maxPerPayment = parseUnits(cap, 6);
    } catch (x) {
      e.cap = (x as Error).message;
    }
    try {
      if (limit.trim()) {
        rules.periodLimit = parseUnits(limit, 6);
        rules.periodDays = periodDays;
      }
    } catch (x) {
      e.limit = (x as Error).message;
    }
    setErrors(e);
    return Object.keys(e).length || !recipient ? undefined : { recipient, payeeAddrs, rules };
  }

  async function submit() {
    const ok = check();
    if (!ok || !crumena) return;
    setBusy(true);
    try {
      const sent = await crumena.createPot(signer!.q, signer!.me, {
        funder: signer!.me.evm,
        recipient: ok.recipient,
        token: crumena.config.fusd,
        endsAt: BigInt(Math.floor(Date.now() / 1000) + days * DAY),
        confirmedOnly,
        rules: ok.rules,
        purpose: purpose.trim(),
        payees: ok.payeeAddrs,
        names: payees.map((p) => p.name.trim()),
      });
      toast(`Pot #${sent.potId} created.`);
      go(`/pot/${sent.potId}`);
    } catch (e) {
      toast(explain(e));
    } finally {
      setBusy(false);
    }
  }

  if (signer?.demo && signer.demo !== "funder")
    return (
      <div className="card">
        <p style={{ margin: 0 }}>In the demo, pots are created by the funder. Switch to <strong>Funder</strong> at the top.</p>
      </div>
    );

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1>New pot</h1>
      <p className="muted">
        You fund it and set the rules. The spender can only pay the payees you list (or that you approve later), within your limits. Paid in fUSD on QoreChain
        testnet.
      </p>

      <div className="card stack">
        <label className="field">
          What is it for?
          <span className="hint">Shown in every statement anyone signs for this pot.</span>
          <input value={purpose} maxLength={80} onChange={(e) => setPurpose(e.target.value)} placeholder="Monthly budget" />
          {errors.purpose && <div className="error">{errors.purpose}</div>}
        </label>
        <label className="field">
          Who spends it?
          <span className="hint">Their QoreChain address (qor1… or 0x…).</span>
          <input value={spender} onChange={(e) => setSpender(e.target.value)} placeholder="qor1…" spellCheck={false} />
          {errors.spender && <div className="error">{errors.spender}</div>}
        </label>
      </div>

      <div className="card stack">
        <h2>Who can be paid</h2>
        {payees.map((p, i) => (
          <div className="grid cols-2" key={i}>
            <label className="field">
              Name
              <input value={p.name} maxLength={48} onChange={(e) => setPayees(payees.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Vendor name" />
              {errors[`name${i}`] && <div className="error">{errors[`name${i}`]}</div>}
            </label>
            <label className="field">
              Address
              <input value={p.address} onChange={(e) => setPayees(payees.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} placeholder="qor1…" spellCheck={false} />
              {errors[`addr${i}`] && <div className="error">{errors[`addr${i}`]}</div>}
            </label>
          </div>
        ))}
        <div className="row">
          {payees.length < 10 && (
            <button className="btn small" onClick={() => setPayees([...payees, { name: "", address: "" }])}>
              Add another payee
            </button>
          )}
          {payees.length > 1 && (
            <button className="btn ghost small" onClick={() => setPayees(payees.slice(0, -1))}>
              Remove the last
            </button>
          )}
        </div>
        <label className="row small">
          <input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} />
          Only pay payees who have confirmed the address is theirs, with their own post-quantum key
        </label>
      </div>

      <div className="card stack">
        <h2>Limits</h2>
        <div className="grid cols-2">
          <label className="field">
            Most per payment (fUSD)
            <span className="hint">Leave empty for no cap.</span>
            <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="No cap" />
            {errors.cap && <div className="error">{errors.cap}</div>}
          </label>
          <label className="field">
            Most per period (fUSD)
            <span className="hint">Leave empty for no limit.</span>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" />
              <select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} aria-label="Period" disabled={!limit.trim()}>
                {PERIODS.map(([l, d]) => (
                  <option key={d} value={d}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {errors.limit && <div className="error">{errors.limit}</div>}
          </label>
        </div>
        <label className="field">
          Ends after
          <span className="hint">No payments after this. Then what's left can come back to you.</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {ENDS.map(([l, d]) => (
              <option key={d} value={d}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <button className="btn primary" onClick={submit} disabled={busy} aria-busy={busy}>
          {busy ? "Working…" : "Review and sign"}
        </button>
        <span className="muted small">You'll see the exact text before you sign. No gas needed.</span>
      </div>
    </div>
  );
}

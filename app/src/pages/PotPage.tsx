import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { explain, type Payee, type Pot, type Rules } from "../lib/crumena";
import { fundDemoPot } from "../lib/demo";
import { parseUnits, printable, toEvm, toQor, units } from "../lib/format";
import { transferToPot } from "../lib/qorex";
import type { Verification } from "../lib/verify";
import { codeToHex, potUrl } from "../lib/links";
import { useApp } from "../state";
import { ActionButton, Address as Addr, ExplorerLink, Qr, money, potStatus, when } from "../ui";

interface Entry {
  kind: string;
  block: number;
  time: number;
  tx: string;
  args: Record<string, string | boolean>;
}

/** A pot opened by its short link code (#/p/<code>). */
export function PotByCode({ code }: { code: string }) {
  const { crumena } = useApp();
  const [id, setId] = useState<bigint | null>();
  useEffect(() => {
    const hex = codeToHex(code);
    if (!crumena) return;
    if (!hex) return setId(null);
    crumena.potByCode(hex).then((x) => setId(x ?? null), () => setId(null));
  }, [crumena, code]);
  if (id === null) return <p className="error" style={{ paddingTop: 32 }}>No pot has that link. Check it was copied in full.</p>;
  if (id === undefined) return <p className="muted" style={{ paddingTop: 32 }}>Finding the pot…</p>;
  return <PotPage id={id} />;
}

export function PotPage({ id }: { id: bigint }) {
  const { crumena, signer, demo, toast } = useApp();
  const [pot, setPot] = useState<Pot>();
  const [payees, setPayees] = useState<Payee[]>([]);
  const [period, setPeriod] = useState<{ spent: bigint; limit: bigint; resetsAt: bigint }>();
  const [entries, setEntries] = useState<Entry[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!crumena) return;
    try {
      const [p, list, ps] = await Promise.all([crumena.pot(id), crumena.payees(id), crumena.periodSpending(id)]);
      setPot(p);
      setPayees(list);
      setPeriod(ps);
      const a = await fetch(`/api/pot/${id}/activity`).then((r) => (r.ok ? r.json() : { entries: [] }));
      setEntries(a.entries);
    } catch (e) {
      setError(explain(e));
    }
  }, [crumena, id]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!pot || !crumena) return <p className="muted">Loading pot #{id.toString()}…</p>;

  const me = signer?.me.evm.toLowerCase();
  const isFunder = me === pot.funder.toLowerCase();
  const isSpender = me === pot.recipient.toLowerCase();
  const mine = payees.find((p) => p.address.toLowerCase() === me);
  const s = potStatus(pot);
  const open = !pot.closed && BigInt(Math.floor(Date.now() / 1000)) <= pot.endsAt;
  const nameOf = (a: string) => payees.find((p) => p.address.toLowerCase() === a.toLowerCase())?.name;
  const after = async (msg: string, sent?: { hash: string }) => {
    toast(
      <span>
        {msg} {sent && <ExplorerLink tx={sent.hash}>View it on the explorer.</ExplorerLink>}
      </span>,
    );
    await load();
  };

  return (
    <div className="stack pot-page" style={{ gap: 18 }}>
      <section className="card pot-hero reveal">
        <div className="pot-main">
          <div className="row" style={{ gap: 12 }}>
            <span className="label">
              Pot #{pot.id.toString()} · {isFunder ? "you fund it" : isSpender ? "you spend it" : mine ? "it can pay you" : "you're viewing it"}
            </span>
            <span className={`pill ${s.tone}`}>{s.label}</span>
          </div>
          <h1>{pot.purpose}</h1>
          <div className="big">
            {units(pot.balance, pot.decimals)}
            <span className="unit">{pot.symbol} left</span>
          </div>
          <div className="bar" role="img" aria-label={`${money(pot.paidOut, pot)} paid out of ${money(pot.balance + pot.paidOut, pot)} put in`}>
            <div style={{ width: `${pot.balance + pot.paidOut > 0n ? Number((pot.paidOut * 100n) / (pot.balance + pot.paidOut)) : 0}%` }} />
          </div>
          <div className="ev-meta" style={{ marginTop: 12 }}>
            <span>Paid out {money(pot.paidOut, pot)}</span>
            <span>Ends {when(pot.endsAt)}</span>
            <span>
              Funder <Addr value={pot.funder} qor />
            </span>
            <span>
              Spender <Addr value={pot.recipient} qor />
            </span>
          </div>
          {pot.frozen && !pot.closed && <p className="pill bad" style={{ marginTop: 14 }}>The funder has frozen this pot. No payments until they unfreeze it.</p>}
        </div>
        <Limits pot={pot} period={period} />
      </section>

      {signer && open && isSpender && <SpenderActions pot={pot} payees={payees} onDone={after} />}
      {signer && !pot.closed && isFunder && <FunderActions pot={pot} payees={payees} onDone={after} />}
      {signer && open && mine && mine.approved && !mine.confirmed && (
        <div className="card stack">
          <h2>Confirm this address is yours</h2>
          <p className="muted">
            {pot.confirmedOnly ? "This pot only pays payees who confirm." : "It tells the funder and spender the address really is yours."} You sign with your own
            post-quantum key.
          </p>
          <ActionButton kind="primary" run={async () => after("Confirmed.", await crumena.confirmPayee(signer.q, signer.me, pot))}>
            Confirm as {mine.name}
          </ActionButton>
        </div>
      )}
      {!pot.closed && !open && pot.balance > 0n && (
        <div className="card stack">
          <h2>Send what's left back to the funder</h2>
          <p className="muted">The end date has passed. Anyone can do this, and the money can only go to the funder. No signature needed.</p>
          <ActionButton kind="primary" run={async () => after("Sent back to the funder.", await crumena.reclaim(pot))}>
            Return {money(pot.balance, pot)} to the funder
          </ActionButton>
        </div>
      )}

      <div className="grid cols-2">
        <PayeeList pot={pot} payees={payees} isFunder={isFunder} onDone={after} />
        <PayIn pot={pot} demoFunder={!!demo && isFunder} onDone={after} />
      </div>
      <Activity pot={pot} entries={entries} nameOf={nameOf} />
    </div>
  );
}

function Limits({ pot, period }: { pot: Pot; period?: { spent: bigint; limit: bigint; resetsAt: bigint } }) {
  const pct = period && period.limit > 0n ? Number((period.spent * 100n) / period.limit) : 0;
  return (
    <div className="pot-rules">
      <span className="label">Rules the contract enforces</span>
      <div className="rule">
        <span>Most per payment</span>
        <b>{pot.maxPerPayment > 0n ? money(pot.maxPerPayment, pot) : "No cap"}</b>
      </div>
      {pot.periodDays > 0 && period ? (
        <div className="rule">
          <span>
            This period · every {pot.periodDays} {pot.periodDays === 1 ? "day" : "days"}
          </span>
          <b>
            {money(period.spent, pot)} <span className="muted">of {units(period.limit, pot.decimals)}</span>
          </b>
          <div className={`bar ${pct >= 100 ? "full" : ""}`} role="progressbar" aria-label="Spent this period" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="small">Starts again {when(period.resetsAt)}</span>
        </div>
      ) : (
        <div className="rule">
          <span>Limit per period</span>
          <b>None</b>
        </div>
      )}
      <div className="rule">
        <span>Who can be paid</span>
        <b>{pot.confirmedOnly ? "Confirmed payees only" : "Any approved payee"}</b>
      </div>
    </div>
  );
}

function PayIn({ pot, demoFunder, onDone }: { pot: Pot; demoFunder: boolean; onDone: (m: string, s?: { hash: string }) => Promise<void> }) {
  const { signer } = useApp();
  const [amount, setAmount] = useState("");
  return (
    <div className="card stack">
      <h2>Pay in</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Anyone can add money: send fUSD (the ERC-20 token) to the pot's own address. Only this pot's rules can move it out.
      </p>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Qr text={pot.vault} />
        <div className="stack" style={{ flex: 1, minWidth: 200 }}>
          <div>
            <div className="muted small">Pot address</div>
            <div className="mono">{pot.vault}</div>
          </div>
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(pot.vault)}>
            Copy address
          </button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        From QoreX's bank balance, use <em>convert to ERC-20</em> with this 0x address as the receiver. Don't send bank coins to a qor1 form of this address:
        the pot can't use them.
      </p>
      {demoFunder && !pot.closed && pot.balance === 0n && pot.paidOut === 0n && (
        <ActionButton kind="primary" run={async () => onDone("50 test fUSD added from the demo faucet.", { hash: await fundDemoPot(pot.id) })}>
          Add 50 test fUSD (demo)
        </ActionButton>
      )}
      {signer && !signer.demo && signer.me.kind === "ethereum" && !pot.closed && (
        <div className="row">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount to pay in" style={{ maxWidth: 160 }} />
          <ActionButton
            run={async () => {
              const hash = await transferToPot(signer.q, signer.me, pot.token, pot.vault, parseUnits(amount, pot.decimals));
              await onDone("Sent from QoreX.", { hash });
            }}
          >
            Pay in from QoreX
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function SpenderActions({ pot, payees, onDone }: { pot: Pot; payees: Payee[]; onDone: (m: string, s?: { hash: string }) => Promise<void> }) {
  const { crumena, signer } = useApp();
  const payable = payees.filter((p) => p.approved && (!pot.confirmedOnly || p.confirmed));
  const [to, setTo] = useState(payable[0]?.address ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [reqName, setReqName] = useState("");
  const [reqAddr, setReqAddr] = useState("");
  const [reqAmount, setReqAmount] = useState("");
  const chosen = payable.find((p) => p.address === to);
  return (
    <div className="grid cols-2">
      <div className="card stack">
        <h2>Pay</h2>
        {pot.frozen ? (
          <p className="muted">The pot is frozen.</p>
        ) : payable.length === 0 ? (
          <p className="muted">No payee can be paid yet{pot.confirmedOnly ? " (they need to confirm their address first)" : ""}.</p>
        ) : (
          <>
            <label className="field">
              To
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {payable.map((p) => (
                  <option key={p.address} value={p.address}>
                    {p.name}
                    {p.confirmed ? " (confirmed)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {chosen && chosen.limit > 0n && (
              <p className="muted small" style={{ margin: 0 }}>
                {money(chosen.limit > chosen.paid ? chosen.limit - chosen.paid : 0n, pot)} left for {chosen.name}, of {money(chosen.limit, pot)} approved.
              </p>
            )}
            <label className="field">
              Amount ({pot.symbol})
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Up to ${units(pot.balance, pot.decimals)}`} />
            </label>
            <label className="field">
              Note <span className="hint">Optional, e.g. an invoice number. Goes in the signed text.</span>
              <input value={memo} maxLength={80} onChange={(e) => setMemo(e.target.value)} placeholder="Invoice number" />
            </label>
            <ActionButton
              kind="primary"
              run={async () => {
                if (!printable(memo)) throw new Error("Use plain letters, numbers and punctuation in the note.");
                const sent = await crumena!.pay(signer!.q, signer!.me, pot, to as Address, parseUnits(amount, pot.decimals), memo.trim());
                setAmount("");
                setMemo("");
                await onDone("Paid.", sent);
              }}
            >
              Review and sign
            </ActionButton>
          </>
        )}
      </div>
      <div className="card stack">
        <h2>Need to pay someone new?</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Ask the funder to approve them. Until they do, the pot can't pay them.
        </p>
        <label className="field">
          Name
          <input value={reqName} maxLength={48} onChange={(e) => setReqName(e.target.value)} placeholder="Vendor name" />
        </label>
        <label className="field">
          Address
          <input value={reqAddr} onChange={(e) => setReqAddr(e.target.value)} placeholder="qor1…" spellCheck={false} />
        </label>
        <label className="field">
          Amount ({pot.symbol})
          <span className="hint">What you want to pay them. The funder approves this or an amount of their choice.</span>
          <input inputMode="decimal" value={reqAmount} onChange={(e) => setReqAmount(e.target.value)} placeholder="0.00" />
        </label>
        <ActionButton
          run={async () => {
            if (!reqName.trim() || !printable(reqName)) throw new Error("Give a name in plain letters.");
            const amount = parseUnits(reqAmount, pot.decimals);
            if (amount === 0n) throw new Error("Enter the amount you want to pay them.");
            const sent = await crumena!.requestPayee(signer!.q, signer!.me, pot, toEvm(reqAddr), reqName.trim(), amount);
            setReqName("");
            setReqAddr("");
            setReqAmount("");
            await onDone("Request sent to the funder.", sent);
          }}
        >
          Ask the funder
        </ActionButton>
      </div>
    </div>
  );
}

function FunderActions({ pot, payees, onDone }: { pot: Pot; payees: Payee[]; onDone: (m: string, s?: { hash: string }) => Promise<void> }) {
  const { crumena, signer } = useApp();
  const c = crumena!;
  const q = signer!.q;
  const me = signer!.me;
  const requests = payees.filter((p) => p.requested && !p.approved);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [upTo, setUpTo] = useState("");
  const [cap, setCap] = useState(pot.maxPerPayment > 0n ? units(pot.maxPerPayment, pot.decimals) : "");
  const [limit, setLimit] = useState(pot.periodLimit > 0n ? units(pot.periodLimit, pot.decimals) : "");
  const [days, setDays] = useState(pot.periodDays || 7);
  const [extra, setExtra] = useState(30);
  return (
    <div className="stack">
      {requests.length > 0 && (
        <div className="card stack">
          <h2>Waiting for you</h2>
          {requests.map((r) => (
            <RequestRow key={r.address} pot={pot} r={r} onDone={onDone} />
          ))}
        </div>
      )}
      <div className="grid cols-2">
        <div className="card stack">
          <h2>Approve a payee</h2>
          <label className="field">
            Name
            <input value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Address
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="qor1…" spellCheck={false} />
          </label>
          <label className="field">
            Up to ({pot.symbol}, in total)
            <span className="hint">The most this pot may ever pay them. Leave empty for no limit beyond the pot's rules.</span>
            <input inputMode="decimal" value={upTo} onChange={(e) => setUpTo(e.target.value)} placeholder="No limit" />
          </label>
          <ActionButton
            run={async () => {
              if (!name.trim() || !printable(name)) throw new Error("Give a name in plain letters.");
              const limit = upTo.trim() ? parseUnits(upTo, pot.decimals) : 0n;
              const sent = await c.addPayee(q, me, pot, toEvm(addr), name.trim(), limit);
              setName("");
              setAddr("");
              setUpTo("");
              await onDone("Approved.", sent);
            }}
          >
            Review and sign
          </ActionButton>
        </div>
        <div className="card stack">
          <h2>Change limits</h2>
          <label className="field">
            Most per payment ({pot.symbol})
            <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="No cap" />
          </label>
          <label className="field">
            Most per period ({pot.symbol})
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" />
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
                <option value={1}>a day</option>
                <option value={7}>a week</option>
                <option value={30}>a month (30 days)</option>
              </select>
            </div>
          </label>
          <ActionButton
            run={async () => {
              const r: Rules = {
                maxPerPayment: cap.trim() ? parseUnits(cap, pot.decimals) : 0n,
                periodLimit: limit.trim() ? parseUnits(limit, pot.decimals) : 0n,
                periodDays: limit.trim() ? days : 0,
              };
              await onDone("Limits changed.", await c.setRules(q, me, pot, r));
            }}
          >
            Review and sign
          </ActionButton>
        </div>
      </div>
      <div className="card stack">
        <h2>Pot controls</h2>
        <div className="row">
          <ActionButton kind={pot.frozen ? "primary" : "danger"} run={async () => onDone(pot.frozen ? "Unfrozen." : "Frozen.", await c.setFrozen(q, me, pot, !pot.frozen))}>
            {pot.frozen ? "Unfreeze the pot" : "Freeze the pot now"}
          </ActionButton>
          <select value={extra} onChange={(e) => setExtra(Number(e.target.value))} aria-label="Extend by" style={{ maxWidth: 160, marginTop: 0 }}>
            <option value={7}>by 1 week</option>
            <option value={30}>by 1 month</option>
            <option value={91}>by 3 months</option>
          </select>
          <ActionButton run={async () => onDone("End date moved.", await c.extend(q, me, pot, pot.endsAt + BigInt(extra * 86_400)))}>Move the end later</ActionButton>
          <ActionButton kind="ghost" run={async () => onDone("Released to the spender.", await c.release(q, me, pot))}>
            Give the rest to the spender and close
          </ActionButton>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Freeze if something looks wrong, such as the spender's phone going missing. Payees can be removed from the list below.
        </p>
        {payees.some((p) => p.approved) && (
          <div className="row">
            {payees
              .filter((p) => p.approved)
              .map((p) => (
                <ActionButton key={p.address} small kind="ghost" run={async () => onDone(`${p.name} removed.`, await c.removePayee(q, me, pot, p.address))}>
                  Stop paying {p.name}
                </ActionButton>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestRow({ pot, r, onDone }: { pot: Pot; r: Payee; onDone: (m: string, s?: { hash: string }) => Promise<void> }) {
  const { crumena, signer } = useApp();
  const [upTo, setUpTo] = useState(r.asked > 0n ? units(r.asked, pot.decimals) : "");
  return (
    <div className="request">
      <div className="ev-body">
        <div>
          The spender asks to pay <strong>{r.name}</strong> {r.asked > 0n && <>{money(r.asked, pot)}</>}
        </div>
        <div className="ev-meta">
          <Addr value={r.address} qor />
        </div>
      </div>
      <label className="field request-amount">
        Approve up to ({pot.symbol})
        <input inputMode="decimal" value={upTo} onChange={(e) => setUpTo(e.target.value)} placeholder="No limit" />
      </label>
      <ActionButton
        small
        kind="primary"
        run={async () => {
          const limit = upTo.trim() ? parseUnits(upTo, pot.decimals) : 0n;
          await onDone(`${r.name} approved.`, await crumena!.addPayee(signer!.q, signer!.me, pot, r.address, r.name, limit));
        }}
      >
        Approve
      </ActionButton>
    </div>
  );
}

function LimitEditor({ pot, p, onDone }: { pot: Pot; p: Payee; onDone: (m: string, s?: { hash: string }) => Promise<void> }) {
  const { crumena, signer } = useApp();
  const [open, setOpen] = useState(false);
  const [upTo, setUpTo] = useState(p.limit > 0n ? units(p.limit, pot.decimals) : "");
  if (!open)
    return (
      <button className="btn ghost small" onClick={() => setOpen(true)}>
        Change limit
      </button>
    );
  return (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <input inputMode="decimal" value={upTo} onChange={(e) => setUpTo(e.target.value)} placeholder="No limit" aria-label={`Most ${p.name} may receive in total`} style={{ marginTop: 0, maxWidth: 130 }} />
      <ActionButton
        small
        run={async () => {
          const limit = upTo.trim() ? parseUnits(upTo, pot.decimals) : 0n;
          await onDone(`${p.name}'s limit changed.`, await crumena!.setPayeeLimit(signer!.q, signer!.me, pot, p.address, limit));
          setOpen(false);
        }}
      >
        Sign
      </ActionButton>
    </div>
  );
}

function PayeeList({ pot, payees, isFunder, onDone }: { pot: Pot; payees: Payee[]; isFunder: boolean; onDone: (m: string, s?: { hash: string }) => Promise<void> }) {
  const { toast } = useApp();
  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Payees</h2>
        <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(potUrl(pot.vault)).then(() => toast("Link copied."))} title="Payees open this link to confirm their address">
          Copy link for payees
        </button>
      </div>
      <ul className="payees">
        {payees.map((p) => {
          const pct = p.limit > 0n ? Math.min(100, Number((p.paid * 100n) / p.limit)) : 0;
          return (
            <li key={p.address}>
              <div className="payee-top">
                <div className="ev-body">
                  <strong>{p.name}</strong>
                  <div className="ev-meta">
                    <Addr value={p.address} qor />
                  </div>
                </div>
                <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                  {p.approved ? <span className="pill ok">Approved</span> : p.requested ? <span className="pill warn">Asked for</span> : <span className="pill">Removed</span>}
                  {p.confirmed && <span className="pill accent">Confirmed by them</span>}
                </div>
              </div>
              <div className="payee-money">
                <span className="small">
                  {money(p.paid, pot)} paid
                  {p.limit > 0n ? <span className="muted"> of {money(p.limit, pot)} approved</span> : p.approved ? <span className="muted"> · no limit</span> : null}
                  {p.requested && !p.approved && p.asked > 0n && <span className="muted"> · asked for {money(p.asked, pot)}</span>}
                </span>
                {isFunder && p.approved && !pot.closed && <LimitEditor pot={pot} p={p} onDone={onDone} />}
              </div>
              {p.limit > 0n && (
                <div className="bar" aria-hidden>
                  <div style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const amountOf = (e: Entry, pot: Pot) => (e.args.amount !== undefined ? money(BigInt(e.args.amount as string), pot) : "");

function describe(e: Entry, pot: Pot, nameOf: (a: string) => string | undefined): string {
  const a = e.args;
  switch (e.kind) {
    case "PotCreated":
      return "Pot created by the funder";
    case "PayeeApproved":
      return `Funder approved ${a.name}${a.limit !== undefined && BigInt(a.limit as string) > 0n ? `, up to ${money(BigInt(a.limit as string), pot)}` : ""}`;
    case "PayeeLimitChanged":
      return `Funder set ${nameOf(a.payee as string) ?? "a payee"}'s limit to ${BigInt(a.limit as string) > 0n ? money(BigInt(a.limit as string), pot) : "no limit"}`;
    case "PayeeRemoved":
      return `Funder stopped payments to ${nameOf(a.payee as string) ?? "a payee"}`;
    case "PayeeRequested":
      return `Spender asked to pay ${a.name}${a.amount !== undefined ? ` ${money(BigInt(a.amount as string), pot)}` : ""}`;
    case "PayeeConfirmed":
      return `${nameOf(a.payee as string) ?? "A payee"} confirmed their address`;
    case "Paid":
      return `Paid ${amountOf(e, pot)} to ${nameOf(a.payee as string) ?? "a payee"}${a.memo ? ` (${a.memo})` : ""}`;
    case "EndChanged":
      return `End moved to ${when(BigInt(a.endsAt as string))}`;
    case "RulesChanged":
      return `Limits set: ${BigInt(a.maxPerPayment as string) > 0n ? `${money(BigInt(a.maxPerPayment as string), pot)} per payment` : "no cap"}, ${
        BigInt(a.periodLimit as string) > 0n ? `${money(BigInt(a.periodLimit as string), pot)} every ${a.periodDays} days` : "no period limit"
      }`;
    case "FrozenChanged":
      return a.frozen ? "Funder froze the pot" : "Funder unfroze the pot";
    case "Released":
      return `Rest (${amountOf(e, pot)}) given to the spender; pot closed`;
    case "Reclaimed":
      return `Rest (${amountOf(e, pot)}) returned to the funder`;
    case "Deposit":
      return /^0x0{40}$/i.test(a.from as string) ? `${amountOf(e, pot)} paid in (minted)` : `${amountOf(e, pot)} paid in by ${toQor(a.from as string)}`;
    case "BankDeposit":
      return `${amountOf(e, pot)} paid in from ${a.from}'s bank balance`;
    default:
      return e.kind;
  }
}

const SIGNED = new Set(["PotCreated", "PayeeApproved", "PayeeLimitChanged", "PayeeRemoved", "PayeeRequested", "PayeeConfirmed", "Paid", "EndChanged", "RulesChanged", "FrozenChanged", "Released"]);

function Activity({ pot, entries, nameOf }: { pot: Pot; entries?: Entry[]; nameOf: (a: string) => string | undefined }) {
  function csv() {
    const rows = [["time (UTC)", "what", "amount", "transaction"]];
    for (const e of entries ?? []) rows.push([new Date(e.time * 1000).toISOString(), describe(e, pot, nameOf), e.args.amount ? units(BigInt(e.args.amount as string), pot.decimals) : "", e.tx]);
    const text = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `crumena-pot-${pot.id}.csv`;
    a.click();
  }
  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>History</h2>
        {entries && entries.length > 0 && (
          <button className="btn small ghost" onClick={csv}>
            Download CSV
          </button>
        )}
      </div>
      {!entries ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted">Nothing yet. New activity shows up within a few seconds.</p>
      ) : (
        <ul className="timeline">
          {entries.map((e) => (
            <HistoryItem key={`${e.tx}-${e.kind}-${e.block}`} e={e} text={describe(e, pot, nameOf)} />
          ))}
        </ul>
      )}
    </div>
  );
}

const ICON: Record<string, string> = {
  PotCreated: "✦",
  PayeeApproved: "+",
  PayeeLimitChanged: "≤",
  PayeeRemoved: "−",
  PayeeRequested: "?",
  PayeeConfirmed: "✓",
  Paid: "↗",
  EndChanged: "⟶",
  RulesChanged: "≤",
  FrozenChanged: "❄",
  Released: "↘",
  Reclaimed: "↩",
  Deposit: "↙",
  BankDeposit: "↙",
};
const IN = new Set(["Deposit", "BankDeposit"]);

function HistoryItem({ e, text }: { e: Entry; text: string }) {
  const { crumena } = useApp();
  const [v, setV] = useState<Verification | "busy" | string>();
  return (
    <li>
      <div className="ev">
        <span className={`ev-icon ${IN.has(e.kind) ? "in" : ""}`} aria-hidden>
          {ICON[e.kind] ?? "·"}
        </span>
        <div className="ev-body">
          <div>{text}</div>
          <div className="ev-meta">
            <span>{when(e.time)}</span>
            {SIGNED.has(e.kind) && <span>ML-DSA-87 signed</span>}
          </div>
        </div>
        <span className="row small" style={{ flexWrap: "nowrap" }}>
          <ExplorerLink tx={e.tx}>Explorer</ExplorerLink>
          {SIGNED.has(e.kind) && (
            <button
              className="btn small ghost"
              disabled={v === "busy"}
              onClick={() => {
                setV("busy");
                import("../lib/verify") // ML-DSA-87 code loads only when someone verifies
                  .then(({ verifyAction }) => verifyAction(crumena!, e.tx as Hex))
                  .then(setV, (x) => setV((x as Error).message));
              }}
            >
              {v === "busy" ? "Checking…" : "Verify"}
            </button>
          )}
        </span>
      </div>
      {typeof v === "string" && v !== "busy" && <p className="error">{v}</p>}
      {v && typeof v === "object" && (
        <div className="stack" style={{ marginTop: 10 }}>
          {v.signed ? (
            <p className={`pill ${v.valid ? "ok" : "bad"}`}>
              {v.valid ? "✓ Valid ML-DSA-87 signature" : "✗ Signature does not check out"} by {v.signerQor}
              {v.keyFingerprint && ` · key ${v.keyFingerprint}`}
            </p>
          ) : (
            <p className="pill">{v.note}</p>
          )}
          {v.statement && <div className="statement">{v.statement}</div>}
          {v.signed && (
            <p className="muted small" style={{ margin: 0 }}>
              Checked in your browser: the statement was rebuilt by the contract as of block {(v.block - 1n).toString()}, the key read from QoreChain's pqcKeyStatus
              precompile at that block, and the signature verified with ML-DSA-87 over QoreX's message bytes.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

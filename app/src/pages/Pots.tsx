import { useEffect, useState } from "react";
import { explain, type Pot } from "../lib/crumena";
import { units } from "../lib/format";
import { potHref } from "../lib/links";
import { useApp } from "../state";
import { NeedsSigner, money, potStatus, when } from "../ui";

export function Pots() {
  return (
    <NeedsSigner>
      <PotList />
    </NeedsSigner>
  );
}

function PotList() {
  const { crumena, signer, demo } = useApp();
  const [pots, setPots] = useState<Pot[]>();
  const [error, setError] = useState<string>();
  const me = signer!.me.evm.toLowerCase();

  useEffect(() => {
    if (!crumena) return;
    // In the demo, show every pot the three demo people are part of, so switching roles keeps them in view.
    const accounts = signer!.demo && demo ? demo.map((p) => p.evm) : [signer!.me.evm];
    Promise.all(accounts.map((a) => crumena.potsOf(a)))
      .then((lists) => {
        const seen = new Map<string, Pot>();
        for (const p of lists.flat()) seen.set(p.id.toString(), p);
        setPots([...seen.values()].sort((a, b) => Number(b.id - a.id)));
      })
      .catch((e) => setError(explain(e)));
  }, [crumena, signer, demo]);

  const role = (p: Pot) => (p.funder.toLowerCase() === me ? "You fund it" : p.recipient.toLowerCase() === me ? "You spend it" : "");

  return (
    <div>
      <div className="page-head row between" style={{ alignItems: "flex-end" }}>
        <div>
          <span className="label">Acting as {signer!.label}</span>
          <h1 style={{ margin: "14px 0 0" }}>Pots</h1>
        </div>
        <a className="btn primary" href="#/new">
          New pot <span className="arrow" aria-hidden>→</span>
        </a>
      </div>
      {error && <p className="error">{error}</p>}
      {!pots && !error && (
        <div className="pot-grid" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="card skeleton" />
          ))}
        </div>
      )}
      {pots?.length === 0 && (
        <div className="card empty">
          <h2>No pots yet</h2>
          <p className="muted">Create one, or if someone pays you from a pot, open the link they sent you.</p>
          <a className="btn primary" href="#/new">
            Create a pot
          </a>
        </div>
      )}
      <div className="pot-grid">
        {pots?.map((p) => {
          const s = potStatus(p);
          const total = p.balance + p.paidOut;
          const pct = total > 0n ? Number((p.paidOut * 100n) / total) : 0;
          return (
            <a key={p.id.toString()} href={potHref(p.vault)} className="card pot-card">
              <div className="card-head" style={{ marginBottom: 0 }}>
                <span className="label">Pot #{p.id.toString()}</span>
                <span className={`pill ${s.tone}`}>{s.label}</span>
              </div>
              <h3>{p.purpose}</h3>
              <div className="pot-amt">
                <span className="num">{units(p.balance, p.decimals)}</span>
                <span className="muted small">{p.symbol} left</span>
              </div>
              <div className="bar" aria-hidden>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="ev-meta" style={{ marginTop: 12 }}>
                {role(p) && <span>{role(p)}</span>}
                <span>Paid out {money(p.paidOut, p)}</span>
                <span>Ends {when(p.endsAt)}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

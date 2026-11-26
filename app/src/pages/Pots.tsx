import { useEffect, useState } from "react";
import { explain, type Pot } from "../lib/crumena";
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
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Pots</h1>
        <a className="btn primary" href="#/new">
          New pot
        </a>
      </div>
      <p className="muted">Acting as {signer!.label}.</p>
      {error && <p className="error">{error}</p>}
      {!pots && !error && <p className="muted">Loading…</p>}
      {pots?.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>
            No pots yet. <a href="#/new">Create one</a>. If someone pays you from a pot, open the link they sent you.
          </p>
        </div>
      )}
      <div className="grid cols-2">
        {pots?.map((p) => {
          const s = potStatus(p);
          return (
            <a key={p.id.toString()} href={`#/pot/${p.id}`} className="card stack" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="row between">
                <span className="muted small">Pot #{p.id.toString()}</span>
                <span className={`pill ${s.tone}`}>{s.label}</span>
              </div>
              <h3 style={{ margin: 0 }}>{p.purpose}</h3>
              <div className="big">{money(p.balance, p)}</div>
              <div className="row small muted">
                <span>{role(p)}</span>
                <span>Ends {when(p.endsAt)}</span>
                <span>Paid out {money(p.paidOut, p)}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

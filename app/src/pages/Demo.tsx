import { useState } from "react";
import { startDemo } from "../lib/demo";
import { go, useApp } from "../state";
import { Address } from "../ui";

export function Demo() {
  const { demo, setDemo } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      setDemo(await startDemo());
      go("/new");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const STEPS: [string, string][] = [
    ["As the funder", "Create a pot (we fill in the details), sign it, and add 50 test fUSD."],
    ["As the spender", "Pay the payee. Then try paying more than the cap, or more than the payee's approved amount: the contract refuses."],
    ["As the payee", "Confirm the address is yours, with your own key. Every payment to you has a receipt."],
    ["As the funder again", "Freeze the pot, or give the rest to the spender. Press Verify on any payment to check its signature yourself."],
  ];
  const ROLE: Record<string, string> = { funder: "Funds the pot and sets the rules", spender: "Spends it, within the rules", shop: "Gets paid" };

  return (
    <div className="demo-page">
      <div className="page-head reveal">
        <span className="label">Demo · QoreChain testnet</span>
        <h1 style={{ marginTop: 14 }}>Try Crumena in two minutes</h1>
        <p className="lead">
          You'll get three test people, each with a real post-quantum (ML-DSA-87) key registered on chain: a <strong>funder</strong>, a <strong>spender</strong>{" "}
          and a <strong>payee</strong> (such as a vendor). Switch between them at the top of the page.
        </p>
      </div>
      <div className="demo-grid">
        <ol className="points">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="label">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{t}</h3>
                <p className="muted">{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="card stack reveal d1">
          {demo ? (
            <>
              <div className="card-head" style={{ marginBottom: 0 }}>
                <h2 style={{ margin: 0 }}>Your demo people are ready</h2>
                <span className="pill ok">Keys on chain</span>
              </div>
              <ul className="people">
                {demo.map((p) => (
                  <li key={p.role}>
                    <span className="ev-icon">{(p.role === "shop" ? "payee" : p.role).slice(0, 1).toUpperCase()}</span>
                    <div className="ev-body">
                      <div style={{ textTransform: "capitalize" }}>{p.role === "shop" ? "payee" : p.role}</div>
                      <div className="ev-meta">{ROLE[p.role]}</div>
                    </div>
                    <Address value={p.evm} qor />
                  </li>
                ))}
              </ul>
              <div className="row">
                <a className="btn primary" href="#/new">
                  Create a pot as the funder <span className="arrow" aria-hidden>→</span>
                </a>
                <a className="btn" href="#/pots">
                  See pots
                </a>
              </div>
              <button className="btn ghost small" onClick={start} disabled={busy} style={{ alignSelf: "flex-start" }}>
                {busy ? "Setting up…" : "Start over with new people"}
              </button>
            </>
          ) : (
            <>
              <h2>Three people, three real keys</h2>
              <p className="muted">
                Starting registers a funder, a spender and a payee on QoreChain testnet, each with its own ML-DSA-87 key. It takes about 20 seconds.
              </p>
              <button className="btn primary big" onClick={start} disabled={busy} aria-busy={busy}>
                {busy ? "Registering three post-quantum keys on testnet… (about 20 seconds)" : "Start the demo"}
              </button>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <p className="muted small" style={{ margin: 0 }}>
            Everything is real on testnet: real signatures, real transactions, real explorer links. The test keys stay in this browser and are only for this demo.
            Test money has no value.
          </p>
        </div>
      </div>
    </div>
  );
}

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

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1>Try Crumena in two minutes</h1>
      <p className="lead">
        You'll get three test people on QoreChain testnet, each with a real post-quantum (ML-DSA-87) key registered on chain: a <strong>funder</strong>, a{" "}
        <strong>spender</strong> and a <strong>shop</strong>. Switch between them at the top of the page.
      </p>
      <ol className="stack">
        <li>
          <strong>As the funder,</strong> create a pot (we fill in the details), sign it, and add 50 test fUSD.
        </li>
        <li>
          <strong>As the spender,</strong> pay the shop. Then try paying more than the cap: the contract refuses.
        </li>
        <li>
          <strong>As the shop,</strong> confirm the address is yours, with your own key.
        </li>
        <li>
          <strong>As the funder again,</strong> freeze the pot, or give the rest to the spender. Press <em>Verify</em> on any payment to check its signature
          yourself.
        </li>
      </ol>
      <p className="muted small">
        Everything is real on testnet: real signatures, real transactions, real explorer links. The test keys stay in this browser and are only for this demo. Test
        money has no value.
      </p>
      {demo ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>Your demo people are ready:</p>
          <table className="plain">
            <tbody>
              {demo.map((p) => (
                <tr key={p.role}>
                  <td style={{ textTransform: "capitalize" }}>{p.role}</td>
                  <td>
                    <Address value={p.evm} qor />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <a className="btn primary" href="#/new">
              Create a pot as the funder
            </a>
            <a className="btn" href="#/pots">
              See pots
            </a>
            <button className="btn ghost" onClick={start} disabled={busy}>
              {busy ? "Setting up…" : "Start over with new people"}
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="btn primary" onClick={start} disabled={busy} aria-busy={busy}>
            {busy ? "Registering three post-quantum keys on testnet… (about 20 seconds)" : "Start the demo"}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

import { PROOF } from "../proof";
import { explain } from "../lib/crumena";
import { QOREX_INSTALL_URL } from "../lib/qorex";
import { go, useApp } from "../state";
import { EXPLORER, ExplorerLink } from "../ui";

const USES = [
  ["Budgets", "Give someone a budget that can only pay the vendors you approve, capped per payment."],
  ["Allowances", "A fixed amount each week or month, spendable only where you allow, nowhere else."],
  ["Grants", "Approve the vendors up front; the recipient buys what's needed, with a record of every payment."],
  ["Group funds", "Several people pay into one pot; it can only pay out for the purpose everyone agreed."],
];

export function Home() {
  const { signer, connectQorex, toast } = useApp();
  return (
    <div className="stack" style={{ gap: 28 }}>
      <section className="hero">
        <p className="pill accent">Post-quantum, on QoreChain</p>
        <h1>Money for one purpose.</h1>
        <p className="lead">
          Fill a pot for someone. They spend it only with the people you approve, within the limits you set. Whatever is left comes back to you. Every step is a
          plain sentence, signed with a post-quantum key and checked on chain.
        </p>
        <div className="row">
          <a className="btn primary" href="#/demo">
            Try it in two minutes
          </a>
          {signer ? (
            <a className="btn" href="#/pots">
              Open my pots
            </a>
          ) : (
            <button className="btn" onClick={() => connectQorex().then(() => go("/pots"), (e) => toast(explain(e)))}>
              Connect QoreX
            </button>
          )}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          The demo gives you three test people (a funder, a spender and a vendor) with real post-quantum keys on QoreChain testnet. No wallet, no sign-up.
        </p>
      </section>

      <section className="grid cols-3">
        <div className="card">
          <h3>1. Fill a pot</h3>
          <p className="muted">Say what it's for, who spends it, who can be paid, and the limits. Then pay into its own address.</p>
        </div>
        <div className="card">
          <h3>2. They spend it, within your rules</h3>
          <p className="muted">The spender pays approved payees only, up to the caps you set. No gas, no crypto knowledge: they just sign.</p>
        </div>
        <div className="card">
          <h3>3. The rest comes back</h3>
          <p className="muted">After the end date, what's left returns to you. Anyone can trigger it, and it can only go to you.</p>
        </div>
      </section>

      <section>
        <h2>What people use it for</h2>
        <div className="grid cols-4">
          {USES.map(([t, d]) => (
            <div className="card" key={t}>
              <h3>{t}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {d}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Why it holds up, even against a quantum computer</h2>
        <ul>
          <li>
            Every action is a readable statement ("pay 25 fUSD to Approved vendor…") signed in QoreX with <strong>ML-DSA-87</strong>, the post-quantum
            signature standard. The contract rebuilds the text and checks it with QoreChain's <span className="mono">pqcVerify</span> precompile, against the key
            the chain has on record for that person.
          </li>
          <li>A stolen ordinary (ECDSA) key signs nothing here. Change one character after signing and the signature fails.</li>
          <li>Whoever submits the transaction can't change it, so a relayer can pay everyone's gas without being trusted.</li>
          <li>The funder can freeze a pot in one step if a phone goes missing, and set caps per payment and per week or month.</li>
          <li>
            Anyone can check any payment's signature themselves: open a pot's history and press <em>Verify</em>. Your browser rebuilds the statement and checks
            the ML-DSA-87 signature against the key on record.
          </li>
        </ul>
      </section>

      {PROOF && (
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Proven on testnet</h2>
            <span className={`pill ${PROOF.passed === PROOF.total ? "ok" : "bad"}`}>
              {PROOF.passed} of {PROOF.total} checks passed
            </span>
          </div>
          <p className="muted small">
            A live run on {new Date(PROOF.at).toUTCString()} against <span className="mono">{PROOF.crumena}</span>, with real ML-DSA-87 signatures checked by the
            chain. Links open QoreChain's explorer (switch it to Testnet).
          </p>
          <table className="plain">
            <tbody>
              {PROOF.steps.map((s) => (
                <tr key={s.step}>
                  <td>{s.ok ? "✓" : "✗"}</td>
                  <td>
                    {s.step}
                    <div className="muted small">{s.detail}</div>
                  </td>
                  <td>{s.qorechainTx ? <a href={`${EXPLORER}/tx/${s.qorechainTx}`} target="_blank" rel="noreferrer">tx</a> : s.tx ? <ExplorerLink tx={s.tx}>tx</ExplorerLink> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="muted small">
        New to QoreChain? <a href={QOREX_INSTALL_URL}>Install QoreX</a>, then get test QOR and fUSD from the{" "}
        <a href="https://dashboard.qorechain.io/faucet">faucet</a>.
      </section>
    </div>
  );
}

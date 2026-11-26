import { PROOF } from "../proof";
import { explain } from "../lib/crumena";
import { short } from "../lib/format";
import { QOREX_INSTALL_URL } from "../lib/qorex";
import { go, useApp } from "../state";
import { EXPLORER, ExplorerLink, Mark } from "../ui";

const STEPS = [
  ["Fill a pot", "Say what it's for, who spends it, which vendors can be paid and the limits. Then pay into the pot's own address."],
  ["They spend it, within your rules", "The spender pays approved vendors only, up to your caps. No gas and no crypto knowledge: they read a sentence and sign it."],
  ["The rest comes back", "After the end date, whatever is left returns to you. Anyone can trigger it, and it can only go to you."],
] as const;

const USES = [
  ["Budgets", "A budget that can only pay the vendors you approve, capped per payment."],
  ["Allowances", "A fixed amount each week or month, spendable only where you allow."],
  ["Grants", "Approve the vendors up front; the recipient buys what's needed, with a record of every payment."],
  ["Group funds", "Several people pay into one pot; it only pays out for the purpose everyone agreed."],
] as const;

const SECURITY = [
  ["Readable, then signed", "Every action is a plain statement (“pay 25 fUSD to…”) signed in QoreX with ML-DSA-87, the post-quantum signature standard."],
  ["Checked by the chain", "The contract rebuilds the text and checks it with QoreChain's pqcVerify precompile, against the key the chain holds for that person."],
  ["Nothing to tamper with", "Change one character after signing and the signature fails. A stolen ordinary (ECDSA) key signs nothing here."],
  ["A relayer you don't have to trust", "Whoever submits the transaction can't change it, so the relayer pays everyone's gas without being trusted."],
  ["A lost-phone button", "The funder can freeze a pot in one step, and set caps per payment and per day, week or month."],
] as const;

const FAQ = [
  ["Does the spender need crypto or gas?", "No. They read the statement and sign it with their key. Crumena's relayer submits the transaction and pays the gas, and it can't change what was signed."],
  ["What stops someone paying a vendor the funder didn't approve?", "The contract. It only pays addresses on the pot's approved list, within the pot's limits. In the live run, a properly signed payment to an unapproved address was refused."],
  ["Why post-quantum signatures?", "A large enough quantum computer could forge today's ordinary signatures. ML-DSA-87 is the NIST post-quantum standard, and QoreChain checks it on chain."],
  ["Is this real money?", "It runs on QoreChain testnet with fUSD, a test token with no value. The demo gives you three test people with real post-quantum keys."],
] as const;

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const refusals = (PROOF?.steps ?? []).filter((s) => /^(Attack|Rule):/.test(s.step) && /refused|reverted/i.test(s.detail));

export function Home() {
  const { signer, connectQorex, toast } = useApp();
  return (
    <>
      <section className="home-hero">
        <div className="hero-copy reveal">
          <span className="eyebrow">
            <i aria-hidden />
            Live on QoreChain testnet <b aria-hidden>·</b> post-quantum signed
          </span>
          <h1>
            Money for <span className="line">one purpose.</span>
          </h1>
          <p className="lead">
            Fill a pot for someone. They pay only the vendors you approve, within the limits you set. Whatever is left comes back to you.
          </p>
          <div className="row">
            <a className="btn primary big" href="#/demo">
              Try it in two minutes <span className="arrow" aria-hidden>→</span>
            </a>
            {signer ? (
              <a className="btn big" href="#/pots">
                Open my pots
              </a>
            ) : (
              <button className="btn big" onClick={() => connectQorex().then(() => go("/pots"), (e) => toast(explain(e)))}>
                Connect QoreX
              </button>
            )}
          </div>
          <ul className="trust" aria-label="What every action has">
            <li>ML-DSA-87 signed</li>
            <li>pqcVerify on chain</li>
            <li>No gas for the spender</li>
          </ul>
        </div>
        <Scene />
      </section>

      {PROOF && (
        <section className="stats reveal d2" aria-label="From the live testnet run">
          <div>
            <b className="num">
              {PROOF.passed}/{PROOF.total}
            </b>
            <span>live testnet checks passed</span>
          </div>
          <div>
            <b className="num">{short(PROOF.crumena)}</b>
            <span>Crumena contract, source-matched</span>
          </div>
          <div>
            <b className="num">4,627 B</b>
            <span>signature on every action</span>
          </div>
          <div>
            <b className="num">0</b>
            <span>gas paid by the spender</span>
          </div>
        </section>
      )}

      <section id="how" className="section">
        <div className="section-head">
          <span className="label">How it works</span>
          <h2>Three steps. One purpose.</h2>
        </div>
        <ol className="steps">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="step-n">0{i + 1}</span>
              <h3>{t}</h3>
              <p className="muted">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="label">What people use it for</span>
          <h2>Wherever money has a job to do.</h2>
        </div>
        <div className="uses">
          {USES.map(([t, d]) => (
            <div key={t}>
              <h3>{t}</h3>
              <p className="muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="security" className="section split">
        <div className="section-head sticky">
          <span className="label">Security</span>
          <h2>Built to hold, even against a quantum computer.</h2>
          <p className="muted">
            Anyone can check any payment themselves: open a pot's history and press <em>Verify</em>. Your browser rebuilds the statement and checks the ML-DSA-87
            signature against the key on record.
          </p>
        </div>
        <div>
          <ol className="points">
            {SECURITY.map(([t, d], i) => (
              <li key={t}>
                <span className="label">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{t}</h3>
                  <p className="muted">{d}</p>
                </div>
              </li>
            ))}
          </ol>
          {refusals.length > 0 && (
            <div className="card refused">
              <div className="card-head">
                <h3 style={{ margin: 0 }}>Refused on chain, in the live run</h3>
                <span className="pill ok">{refusals.length} of {refusals.length} stopped</span>
              </div>
              <ul>
                {refusals.map((s) => (
                  <li key={s.step}>
                    <span>{cap(s.step.replace(/^(Attack|Rule): /, ""))}</span>
                    <span className="mono">{s.detail.match(/(BadPqcSignature|BadNonce|NotApproved|OverPaymentLimit|OverPeriodLimit|PotFrozen|hybrid PQC signature required|refused by the chain)/)?.[0] ?? "refused"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {PROOF && (
        <section id="proof" className="section">
          <div className="section-head row between" style={{ alignItems: "flex-end" }}>
            <div>
              <span className="label">Proof</span>
              <h2>Proven on testnet, step by step.</h2>
              <p className="muted" style={{ maxWidth: 640 }}>
                A live run on {new Date(PROOF.at).toUTCString()} against the Crumena contract, with real ML-DSA-87 signatures checked by the chain. Links open
                QoreChain's explorer (switch it to Testnet).
              </p>
            </div>
            <span className={`pill ${PROOF.passed === PROOF.total ? "ok" : "bad"}`}>
              {PROOF.passed} of {PROOF.total} checks passed
            </span>
          </div>
          <ol className="proof card flat">
            {PROOF.steps.map((s, i) => (
              <li key={s.step}>
                <span className="label num">{String(i + 1).padStart(2, "0")}</span>
                <span className={s.ok ? "ok-mark" : "bad-mark"} aria-label={s.ok ? "passed" : "failed"}>
                  {s.ok ? "✓" : "✗"}
                </span>
                <div className="proof-body">
                  {s.step}
                  <div className="muted small">{s.detail}</div>
                </div>
                <span className="small">
                  {s.qorechainTx ? (
                    <a href={`${EXPLORER}/tx/${s.qorechainTx}`} target="_blank" rel="noreferrer">
                      Transaction
                    </a>
                  ) : s.tx ? (
                    <ExplorerLink tx={s.tx}>Transaction</ExplorerLink>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="section split">
        <div className="section-head">
          <span className="label">Questions</span>
          <h2>The short answers.</h2>
        </div>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p className="muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="cta">
        <Mark className="cta-mark" />
        <h2>See it work in two minutes.</h2>
        <p className="muted">Three test people with real post-quantum keys on QoreChain testnet. No wallet, no sign-up.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <a className="btn primary big" href="#/demo">
            Start the demo <span className="arrow" aria-hidden>→</span>
          </a>
          <a className="btn big ghost" href={QOREX_INSTALL_URL} target="_blank" rel="noreferrer">
            Get QoreX
          </a>
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>
          New to QoreChain? Install QoreX, then get test QOR and fUSD from the <a href="https://dashboard.qorechain.io/faucet">faucet</a>.
        </p>
      </section>
    </>
  );
}

/** The product, shown as it looks. Sample values, labelled as such. */
function Scene() {
  return (
    <div className="scene reveal d1" aria-label="A sample pot and the statement its spender signed">
      <div className="scene-receipt" aria-hidden>
        <div className="receipt-foot">
          <span>SIGNED STATEMENT</span>
          <span>SAMPLE</span>
        </div>
        <pre>{`Crumena: pay from pot #5
Amount: 12.50 fUSD
To: Northwind Supplies
Pot left after: 37.50 fUSD`}</pre>
        <div className="receipt-foot">
          <span>ML-DSA-87 · 4,627 bytes</span>
          <span className="seal">✓ Valid</span>
        </div>
      </div>
      <div className="scene-pot">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <span className="label">Sample pot</span>
            <div className="scene-title">Monthly budget</div>
          </div>
          <span className="pill ok">Active</span>
        </div>
        <div className="scene-amt">
          <span className="num">37.50</span>
          <span className="muted small">fUSD left of 50.00</span>
        </div>
        <div className="bar" aria-hidden>
          <div style={{ width: "75%" }} />
        </div>
        <div className="receipt-foot" style={{ margin: "8px 0 16px" }}>
          <span>12.50 spent</span>
          <span>ends 31 Dec</span>
        </div>
        <div className="tiles">
          <div>
            <span>Per payment</span>
            <b>≤ 20.00</b>
          </div>
          <div>
            <span>Per 30 days</span>
            <b>40.00</b>
          </div>
          <div>
            <span>Approved</span>
            <b>3 vendors</b>
          </div>
        </div>
        <div className="ev scene-ev">
          <span className="ev-icon">NS</span>
          <div className="ev-body">
            <div>Northwind Supplies</div>
            <div className="ev-meta">signed by the spender</div>
          </div>
          <span className="mono">−12.50</span>
        </div>
        <div className="ev scene-ev">
          <span className="ev-icon in">+</span>
          <div className="ev-body">
            <div>Pot filled</div>
            <div className="ev-meta">by the funder</div>
          </div>
          <span className="mono" style={{ color: "var(--ok)" }}>
            +50.00
          </span>
        </div>
      </div>
      <div className="scene-chip">
        <span className="ok-dot" aria-hidden />
        Checked on chain by pqcVerify
      </div>
    </div>
  );
}

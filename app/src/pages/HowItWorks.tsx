import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    title: "Fill a pot for one purpose.",
    text: "The funder says what it's for, who spends it, who can be paid and how much. They read the whole thing in plain words and sign it once.",
  },
  {
    title: "The spender pays, in plain words.",
    text: "They pick an approved payee and an amount, read one sentence and sign it with their ML-DSA-87 key. No gas, no crypto: the relayer sends it.",
  },
  {
    title: "Anything off-purpose bounces.",
    text: "A payee nobody approved, more than the approved amount, a word changed after signing: the contract on chain refuses it, whoever signs.",
  },
  {
    title: "What's left comes home.",
    text: "Every payment gets a receipt anyone can check. After the end date, the rest goes back to the funder, and only to them.",
  },
] as const;

const STEP_MS = 5200;

/** "How a pot works": one illustration on top that changes with the step, four short steps under it. */
export function HowItWorks() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const still = useRef(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Start only once the section is on screen, so the first step isn't missed.
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return setSeen(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (still.current || paused || !seen) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [step, paused, seen]);

  return (
    <section
      id="how"
      ref={ref}
      className="section how"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="section-head how-head">
        <span className="label">How it works</span>
        <h2>How a pot works</h2>
      </div>

      <div className="how-stage" aria-hidden>
        <span className="how-tag">Illustration</span>
        <div className="how-scene" key={step}>
          {step === 0 && <SceneFill />}
          {step === 1 && <ScenePay />}
          {step === 2 && <SceneRefuse />}
          {step === 3 && <SceneHome />}
        </div>
      </div>

      <ol className="how-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              aria-pressed={i === step}
              className={`how-step ${i === step ? "on" : ""}`}
              onClick={() => setStep(i)}
              style={{ ["--ms" as string]: `${STEP_MS}ms` }}
            >
              <span className="how-progress" aria-hidden>
                <i className={i === step && !paused && seen && !still.current ? "run" : i < step ? "done" : ""} />
              </span>
              <span className="how-n">0{i + 1}</span>
              <span className="how-title">{s.title}</span>
              <span className="how-text">{s.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SceneFill() {
  return (
    <div className="sc sc-fill">
      <div className="sc-card sc-statement">
        <div className="sc-kicker">Signed by the funder</div>
        <pre>
          <span>Crumena: create a pot</span>
          <span>Purpose: Monthly budget</span>
          <span>Spent by: qor1…k7tm</span>
          <span>Limit per payment: 20 fUSD</span>
          <span>1. Northwind Supplies, up to 30 fUSD</span>
          <span>2. Brightline Electrical, no limit</span>
          <span>Ends: 2026-12-31 00:00 UTC</span>
        </pre>
      </div>
      <div className="sc-card sc-pot">
        <div className="sc-kicker">Pot</div>
        <div className="sc-amount">
          <b>50.00</b> <small>fUSD</small>
        </div>
        <div className="sc-meter">
          <i className="fill-up" />
        </div>
        <div className="sc-note">Paid into the pot's own address</div>
      </div>
    </div>
  );
}

function ScenePay() {
  return (
    <div className="sc sc-pay">
      <div className="sc-card sc-phone">
        <div className="sc-kicker">The spender signs</div>
        <p className="sc-sentence">
          Pay <b>12.50 fUSD</b> from <b>Monthly budget</b> to <b>Northwind Supplies</b>
        </p>
        <div className="sc-sign">
          <span className="sc-btn">Sign</span>
          <span className="sc-signed">✓ ML-DSA-87 · 4,627 bytes</span>
        </div>
        <div className="sc-note">No gas: the relayer sends it</div>
      </div>
      <div className="sc-arrow" />
      <div className="sc-card sc-pot">
        <div className="sc-kicker">Pot</div>
        <div className="sc-amount">
          <b>37.50</b> <small>fUSD left</small>
        </div>
        <div className="sc-meter">
          <i className="drain" />
        </div>
        <div className="sc-row">
          <span>Northwind Supplies</span>
          <span className="mono">12.50 of 30</span>
        </div>
      </div>
    </div>
  );
}

function SceneRefuse() {
  return (
    <div className="sc sc-refuse">
      <div className="sc-card sc-try">
        <div className="sc-kicker">Someone tries</div>
        <div className="sc-attempt">
          <span>Pay 0x9f…e1 (not approved)</span>
          <b className="stamp">Refused · NotApproved</b>
        </div>
        <div className="sc-attempt">
          <span>Pay Northwind 40 fUSD (30 approved)</span>
          <b className="stamp">Refused · OverPayeeLimit</b>
        </div>
        <div className="sc-attempt">
          <span>Change 12.50 to 49.00 after signing</span>
          <b className="stamp">Refused · BadPqcSignature</b>
        </div>
      </div>
      <div className="sc-card sc-shield">
        <div className="sc-kicker">The contract checks</div>
        <ul>
          <li>The signature, with pqcVerify</li>
          <li>The payee is approved</li>
          <li>Their amount and the caps</li>
          <li>The pot isn't frozen or over</li>
        </ul>
      </div>
    </div>
  );
}

function SceneHome() {
  return (
    <div className="sc sc-home">
      <div className="sc-card sc-receipt">
        <div className="sc-kicker">Receipt</div>
        <div className="sc-amount">
          <b>12.50</b> <small>fUSD to Northwind Supplies</small>
        </div>
        <div className="sc-valid">✓ Valid ML-DSA-87 signature</div>
        <div className="sc-note">Anyone can check it in their own browser</div>
      </div>
      <div className="sc-card sc-back">
        <div className="sc-kicker">End date passed</div>
        <div className="sc-amount">
          <b>37.50</b> <small>fUSD</small>
        </div>
        <div className="sc-return">
          <span>Pot</span>
          <i />
          <span>Funder</span>
        </div>
        <div className="sc-note">It can't go anywhere else</div>
      </div>
    </div>
  );
}

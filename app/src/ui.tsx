import { useEffect, useState, type ReactNode } from "react";
import { renderSVG } from "uqr";
import { explain, type Pot } from "./lib/crumena";
import { short, toQor, units } from "./lib/format";
import { QOREX_INSTALL_URL } from "./lib/qorex";
import { go, useApp, useRoute } from "./state";

export const EXPLORER = "https://explore.qore.network";

const MARK = "M45.92,10.04 A26 26 0 1 0 57.4,26.43 L44.54,35.43 A13 13 0 1 1 33.07,19.04 Z";

export function Mark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden>
      <path d={MARK} />
    </svg>
  );
}

/** Scrolls to a section of the home page, going home first if needed. */
export function toSection(id: string) {
  const scroll = () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (window.location.hash.replace(/^#\/?/, "") === "") scroll();
  else {
    go("/");
    setTimeout(scroll, 60);
  }
}

const SECTIONS = [
  ["How it works", "how"],
  ["Who's who", "roles"],
  ["Security", "security"],
  ["Proof", "proof"],
] as const;

type Theme = "light" | "dark";
const THEME_KEY = "crumena:theme";

/** The theme follows the device until the person picks one; the pick is remembered in this browser. */
function ThemeToggle() {
  const system = (): Theme => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme | undefined) ?? system());
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => !document.documentElement.dataset.theme && setTheme(system());
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          /* private mode: the choice lasts for this page only */
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { signer, demo, actAs, setDemo, connectQorex, signOut, toast } = useApp();
  const [page] = useRoute();
  return (
    <>
      <svg className="svg-defs" aria-hidden focusable="false">
        <defs>
          <linearGradient id="crumena-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--g1)" }} />
            <stop offset="1" style={{ stopColor: "var(--g2)" }} />
          </linearGradient>
        </defs>
      </svg>
      {demo && (
        <div className="demo-bar" role="region" aria-label="Demo">
          <div className="wrap">
            <span className="demo-dot" aria-hidden />
            <span className="label">Demo · QoreChain testnet</span>
            <span>Act as</span>
            {(["funder", "spender", "shop"] as const).map((r) => (
              <button key={r} aria-pressed={signer?.demo === r} onClick={() => actAs(r)}>
                {r === "funder" ? "Funder" : r === "spender" ? "Spender" : "Payee"}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button onClick={() => (setDemo(undefined), go("/"))}>End demo</button>
          </div>
        </div>
      )}
      <div className="top-shell">
        <header className="wrap top">
          <a className="brand" href="#/">
            <Mark />
            Crumena
          </a>
          <nav className="links" aria-label="Sections">
            {SECTIONS.map(([label, id]) => (
              <a key={id} href={`#/`} onClick={(e) => (e.preventDefault(), toSection(id))}>
                {label}
              </a>
            ))}
            <a href="#/demo" aria-current={page === "demo" ? "page" : undefined}>
              Demo
            </a>
          </nav>
          <nav className="nav" aria-label="Account">
            <ThemeToggle />
            {signer && (
              <a className="btn ghost small" href="#/pots" aria-current={page === "pots" ? "page" : undefined}>
                My pots
              </a>
            )}
            {signer && (
              <a className="btn small" href="#/new">
                New pot
              </a>
            )}
            {signer && !signer.demo && (
              <button className="btn ghost small" onClick={signOut} title={signer.me.qor}>
                <span className="mono">{short(signer.me.qor)}</span> · Sign out
              </button>
            )}
            {!signer && (
              <>
                <button className="btn ghost small" onClick={() => connectQorex().then(() => go("/pots"), (e) => toast(explain(e)))}>
                  Connect QoreX
                </button>
                <a className="btn primary small" href="#/demo">
                  Try the demo
                </a>
              </>
            )}
          </nav>
        </header>
      </div>
      <main className="wrap">{children}</main>
      <footer className="site">
        <div className="wrap cols">
          <div>
            <a className="brand" href="#/">
              <Mark />
              Crumena
            </a>
            <p style={{ marginTop: 14 }}>
              Money for one purpose, on QoreChain testnet. Every action is a plain-text statement signed with ML-DSA-87 and checked on chain by QoreChain's
              pqcVerify precompile.
            </p>
          </div>
          <nav aria-label="Footer">
            <a href="#/demo">Demo</a>
            <a href="https://github.com/phoenix-2203/crumena" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
            <a href={EXPLORER} target="_blank" rel="noreferrer">
              QoreChain explorer
            </a>
            <a href={QOREX_INSTALL_URL} target="_blank" rel="noreferrer">
              Get QoreX
            </a>
          </nav>
        </div>
      </footer>
      <StatementModal />
      <Toast />
    </>
  );
}

const FN_TITLE: Record<string, string> = {
  createPot: "Create the pot",
  pay: "Pay from the pot",
  addPayee: "Approve a payee",
  removePayee: "Stop paying a payee",
  requestPayee: "Ask the funder to approve a payee",
  confirmPayee: "Confirm your address",
  extend: "Move the end date",
  setRules: "Change the spending rules",
  setFrozen: "Freeze or unfreeze",
  release: "Give the rest to the spender",
};

/** The exact text, from the contract, shown before anything is signed. */
function StatementModal() {
  const { pending, signer } = useApp();
  if (!pending) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="sign-title">
      <div className="modal stack">
        <span className="label">Review before signing</span>
        <h2 id="sign-title">{FN_TITLE[pending.fn] ?? "Sign"}</h2>
        <p className="muted small">
          This is the exact text {signer?.demo ? "the demo signer" : "QoreX"} will sign with your post-quantum key (ML-DSA-87). The contract rebuilds it from
          the transaction and checks the signature, so nothing in it can be changed after you sign.
        </p>
        <div className="statement" tabIndex={0}>
          {pending.statement}
        </div>
        <div className="receipt-foot">
          <span>ML-DSA-87 · checked by pqcVerify</span>
          <span>No gas: the relayer pays it</span>
        </div>
        <div className="row">
          <button className="btn primary" autoFocus onClick={() => pending.resolve(true)}>
            {signer?.demo ? `Sign as ${signer.demo === "shop" ? "payee" : signer.demo}` : "Sign in QoreX"}
          </button>
          <button className="btn ghost" onClick={() => pending.resolve(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast() {
  const { toastMessage } = useApp();
  if (!toastMessage) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {toastMessage}
    </div>
  );
}

/** Runs an action with a busy state; errors become a toast in plain words. */
export function ActionButton(props: { children: ReactNode; run: () => Promise<unknown>; kind?: "primary" | "danger" | "ghost"; small?: boolean; disabled?: boolean }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`btn ${props.kind ?? ""} ${props.small ? "small" : ""}`}
      disabled={busy || props.disabled}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await props.run();
        } catch (e) {
          toast(explain(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Working…" : props.children}
    </button>
  );
}

export function Address({ value, qor }: { value: string; qor?: boolean }) {
  const { toast } = useApp();
  const shown = qor ? toQor(value) : value;
  return (
    <button
      className="mono"
      style={{ background: "none", border: 0, padding: 0, color: "inherit", cursor: "copy", textAlign: "left" }}
      title={`${shown} (click to copy)`}
      onClick={() => navigator.clipboard?.writeText(shown).then(() => toast("Copied."))}
    >
      {short(shown)}
    </button>
  );
}

export const money = (amount: bigint, pot: Pick<Pot, "decimals" | "symbol">) => `${units(amount, pot.decimals)} ${pot.symbol}`;

export function when(t: bigint | number): string {
  return new Date(Number(t) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function potStatus(p: Pot, nowSec = Math.floor(Date.now() / 1000)): { label: string; tone: "ok" | "warn" | "bad" | "" } {
  if (p.closed) return { label: "Closed", tone: "" };
  if (BigInt(nowSec) > p.endsAt) return { label: "Ended", tone: "warn" };
  if (p.frozen) return { label: "Frozen", tone: "bad" };
  return { label: "Active", tone: "ok" };
}

/** A link to the explorer. EVM transactions are looked up by their QoreChain hash first, which is what the explorer finds. */
export function ExplorerLink({ tx, children }: { tx: string; children?: ReactNode }) {
  const [hash, setHash] = useState<string | undefined>(tx.startsWith("0x") ? undefined : tx);
  useEffect(() => {
    if (!tx.startsWith("0x")) return;
    let live = true;
    const tryOnce = (n: number) =>
      fetch(`/api/qorechain-tx/${tx}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: { hash: string }) => live && setHash(j.hash))
        .catch(() => live && n > 0 && setTimeout(() => tryOnce(n - 1), 3000));
    tryOnce(5);
    return () => {
      live = false;
    };
  }, [tx]);
  if (!hash) return <span className="muted small">{children ?? "Explorer link soon"}</span>;
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" title="Opens QoreChain's explorer. Switch it to Testnet at the top if it doesn't find the transaction.">
      {children ?? "View on explorer"}
    </a>
  );
}

export function Qr({ text }: { text: string }) {
  return <div className="qr" role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: renderSVG(text, { border: 1 }) }} />;
}

export function NeedsSigner({ children }: { children: ReactNode }) {
  const { signer, connectQorex, toast } = useApp();
  if (signer) return <>{children}</>;
  return (
    <div className="card stack">
      <h2>Sign in first</h2>
      <p>Crumena works with QoreX, QoreChain's wallet. Or try everything with demo people, no wallet needed.</p>
      <div className="row">
        <button className="btn primary" onClick={() => connectQorex().catch((e) => toast(explain(e)))}>
          Connect QoreX
        </button>
        <a className="btn" href="#/demo">
          Try the demo
        </a>
        <a className="btn ghost" href={QOREX_INSTALL_URL} target="_blank" rel="noreferrer">
          Get QoreX
        </a>
      </div>
    </div>
  );
}

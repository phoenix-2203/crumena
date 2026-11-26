import { useEffect, useState, type ReactNode } from "react";
import { renderSVG } from "uqr";
import { explain, type Pot } from "./lib/crumena";
import { short, toQor, units } from "./lib/format";
import { QOREX_INSTALL_URL } from "./lib/qorex";
import { go, useApp } from "./state";

export const EXPLORER = "https://explore.qore.network";

export function Layout({ children }: { children: ReactNode }) {
  const { signer, demo, actAs, setDemo, connectQorex, signOut, toast } = useApp();
  return (
    <>
      {demo && (
        <div className="demo-bar" role="region" aria-label="Demo">
          <div className="wrap">
            <strong>Demo on QoreChain testnet.</strong>
            <span>Act as:</span>
            {(["funder", "spender", "shop"] as const).map((r) => (
              <button key={r} aria-pressed={signer?.demo === r} onClick={() => actAs(r)}>
                {r === "funder" ? "Funder" : r === "spender" ? "Spender" : "Vendor"}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button onClick={() => (setDemo(undefined), go("/"))}>End demo</button>
          </div>
        </div>
      )}
      <div className="wrap">
        <header className="top">
          <a className="brand" href="#/">
            <span className="brand-mark" aria-hidden>
              C
            </span>
            Crumena
          </a>
          <nav className="nav">
            {signer && (
              <a className="btn ghost small" href="#/pots">
                My pots
              </a>
            )}
            {signer && (
              <a className="btn ghost small" href="#/new">
                New pot
              </a>
            )}
            {signer && !signer.demo && (
              <button className="btn ghost small" onClick={signOut} title={signer.me.qor}>
                {short(signer.me.qor)} · Sign out
              </button>
            )}
            {!signer && (
              <button className="btn small" onClick={() => connectQorex().then(() => go("/pots"), (e) => toast(explain(e)))}>
                Connect QoreX
              </button>
            )}
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          Crumena runs on QoreChain testnet. Every action is a plain-text statement signed with ML-DSA-87 and checked on chain by QoreChain's
          pqcVerify precompile. Open source:{" "}
          <a href="https://github.com/phoenix-2203/crumena" target="_blank" rel="noreferrer">
            github.com/phoenix-2203/crumena
          </a>
          .
        </footer>
      </div>
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
        <h2 id="sign-title">{FN_TITLE[pending.fn] ?? "Sign"}</h2>
        <p className="muted small">
          This is the exact text {signer?.demo ? "the demo signer" : "QoreX"} will sign with your post-quantum key (ML-DSA-87). The contract rebuilds it from
          the transaction and checks the signature, so nothing in it can be changed after you sign.
        </p>
        <div className="statement" tabIndex={0}>
          {pending.statement}
        </div>
        <div className="row">
          <button className="btn primary" autoFocus onClick={() => pending.resolve(true)}>
            {signer?.demo ? `Sign as ${signer.demo === "shop" ? "vendor" : signer.demo}` : "Sign in QoreX"}
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
  return <div className="qr" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: renderSVG(text, { border: 1 }) }} />;
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

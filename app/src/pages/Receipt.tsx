import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { explain, type Payee, type Pot } from "../lib/crumena";
import { toQor, units } from "../lib/format";
import { codeToHex, potHref, potUrl } from "../lib/links";
import { markStep } from "../lib/progress";
import type { Verification } from "../lib/verify";
import { useApp } from "../state";
import { ExplorerLink, Mark, when } from "../ui";

interface Entry {
  kind: string;
  block: number;
  time: number;
  tx: string;
  args: Record<string, string | boolean>;
}

/** A receipt for one payment from a pot: #/r/<pot code>/<transaction hash>. Everything on it is read from the chain. */
export function Receipt({ code, tx }: { code: string; tx: string }) {
  const { crumena, toast } = useApp();
  const [pot, setPot] = useState<Pot>();
  const [payee, setPayee] = useState<Payee>();
  const [entry, setEntry] = useState<Entry | null>();
  const [check, setCheck] = useState<Verification | string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!crumena) return;
    (async () => {
      const hex = codeToHex(code);
      if (!hex || !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error("That receipt link isn't complete. Check it was copied in full.");
      const id = await crumena.potByCode(hex);
      if (!id) throw new Error("No pot has that link.");
      const [p, list, activity] = await Promise.all([
        crumena.pot(id),
        crumena.payees(id),
        fetch(`/api/pot/${id}/activity`).then((r) => (r.ok ? (r.json() as Promise<{ entries: Entry[] }>) : { entries: [] })),
      ]);
      setPot(p);
      const e = activity.entries.find((x) => x.kind === "Paid" && x.tx.toLowerCase() === tx.toLowerCase()) ?? null;
      setEntry(e);
      if (e) markStep("receipt");
      if (e) setPayee(list.find((x) => x.address.toLowerCase() === String(e.args.payee).toLowerCase()));
      if (e) {
        const { verifyAction } = await import("../lib/verify"); // ML-DSA-87 code loads only here
        verifyAction(crumena, tx as Hex).then(setCheck, (x) => setCheck((x as Error).message));
      }
    })().catch((x) => setError(explain(x)));
  }, [crumena, code, tx]);

  if (error) return <p className="error" style={{ paddingTop: 32 }}>{error}</p>;
  if (!pot || entry === undefined) return <p className="muted" style={{ paddingTop: 32 }}>Finding the payment…</p>;
  if (entry === null)
    return (
      <p className="muted" style={{ paddingTop: 32 }}>
        That payment isn't in this pot's history yet. New payments show up within a few seconds. <a href={potHref(pot.vault)}>Open the pot</a>.
      </p>
    );

  const amount = BigInt(entry.args.amount as string);
  const by = String(entry.args.by);
  const role = by.toLowerCase() === pot.recipient.toLowerCase() ? "the spender" : by.toLowerCase() === pot.funder.toLowerCase() ? "the funder" : "";
  const link = `${potUrl(pot.vault).replace(/#\/p\//, "#/r/")}/${tx}`;

  return (
    <div className="receipt-page">
      <article className="card receipt reveal" aria-labelledby="receipt-title">
        <header className="receipt-head">
          <span className="brand">
            <Mark />
            Crumena
          </span>
          <span className="label">Payment receipt</span>
        </header>
        <h1 id="receipt-title" className="sr-only">
          Receipt for {units(amount, pot.decimals)} {pot.symbol} to {payee?.name ?? "a payee"}
        </h1>
        <div className="receipt-amount">
          <span className="big">
            {units(amount, pot.decimals)}
            <span className="unit">{pot.symbol}</span>
          </span>
          <span className="muted">paid to {payee?.name ?? "an approved payee"}</span>
        </div>
        <dl className="receipt-lines">
          <div>
            <dt>To</dt>
            <dd>
              {payee?.name}
              <span className="mono">{toQor(String(entry.args.payee))}</span>
            </dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>
              {pot.purpose}
              <span className="mono">
                Pot #{pot.id.toString()} · {pot.vault}
              </span>
            </dd>
          </div>
          <div>
            <dt>Signed by</dt>
            <dd>
              {role ? `${role[0]!.toUpperCase()}${role.slice(1)}` : "Signer"}
              <span className="mono">{toQor(by)}</span>
            </dd>
          </div>
          {entry.args.memo ? (
            <div>
              <dt>Memo</dt>
              <dd>{String(entry.args.memo)}</dd>
            </div>
          ) : null}
          <div>
            <dt>When</dt>
            <dd>
              {when(entry.time)}
              <span className="mono">block {entry.block.toLocaleString()}</span>
            </dd>
          </div>
          <div>
            <dt>Transaction</dt>
            <dd>
              <span className="mono">{tx}</span>
              <ExplorerLink tx={tx}>Open on QoreChain's explorer</ExplorerLink>
            </dd>
          </div>
        </dl>
        <section className="receipt-check" aria-live="polite">
          {!check ? (
            <p className="muted small">Checking the ML-DSA-87 signature in your browser…</p>
          ) : typeof check === "string" ? (
            <p className="error">{check}</p>
          ) : (
            <>
              <p className={`pill ${check.valid ? "ok" : "bad"}`}>
                {check.valid ? "Valid ML-DSA-87 signature" : "The signature doesn't check out"}
                {check.keyFingerprint && ` · key ${check.keyFingerprint}`}
              </p>
              {check.statement && <div className="statement">{check.statement}</div>}
              <p className="muted small" style={{ margin: 0 }}>
                Checked in your browser, not by Crumena's server: the contract rebuilt this statement as of block {(check.block - 1n).toString()}, the signer's
                key was read from QoreChain's pqcKeyStatus precompile at that block, and the signature was verified with ML-DSA-87.
              </p>
            </>
          )}
        </section>
      </article>
      <div className="row receipt-actions">
        <button className="btn primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => toast("Receipt link copied."))}>
          Copy link
        </button>
        <a className="btn ghost" href={potHref(pot.vault)}>
          Open the pot
        </a>
      </div>
    </div>
  );
}

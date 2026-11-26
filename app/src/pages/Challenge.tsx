import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { units } from "../lib/format";
import { potCode, potHref } from "../lib/links";

interface State {
  ready: boolean;
  potId?: string;
  vault?: Address;
  balance?: string;
  paidOut?: string;
  refused?: number;
  gotThrough?: number;
  honest?: number;
  attacks?: { id: string; what: string; refused: number }[];
}
interface Result {
  attack: string;
  what: string;
  refused: boolean;
  reason?: string;
  explanation: string;
  statement?: string;
  block?: string;
  hash?: string;
}
type LogLine = (Result & { at: number }) | { at: number; error: string; what: string };

const SHORT: Record<string, string> = {
  payStranger: "Pay yourself",
  overCap: "Go over the cap",
  overPayee: "Go over a payee's amount",
  tamper: "Change the amount after signing",
  replay: "Replay an old payment",
  wrongKey: "Sign with another key",
  approveSelf: "Approve yourself as a payee",
  takeAll: "Take everything",
};

/** "Make this pot misbehave": a real testnet pot that visitors try to misuse, refused live by the contract. */
export function Challenge() {
  const [s, setS] = useState<State>();
  const [busy, setBusy] = useState<string>();
  const [log, setLog] = useState<LogLine[]>([]);

  const load = useCallback(() => {
    fetch("/api/challenge")
      .then((r) => r.json() as Promise<State>)
      .then(setS, () => setS({ ready: false }));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function run(id: string, what: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/challenge/${id}`, { method: "POST" });
      const body = (await r.json()) as Result & { error?: string };
      setLog((l) => [r.ok ? { ...body, at: Date.now() } : { at: Date.now(), error: body.error ?? "Something went wrong.", what }, ...l].slice(0, 8));
      load();
    } catch {
      setLog((l) => [{ at: Date.now(), error: "Couldn't reach the server.", what }, ...l]);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section id="challenge" className="challenge" aria-labelledby="challenge-title">
      <div className="challenge-glow" aria-hidden />
      <div className="challenge-head">
        <span className="label">Live on QoreChain testnet</span>
        <h2 id="challenge-title">Make this pot misbehave.</h2>
        <p>
          A real pot with real test money in it. You're the spender, with a real post-quantum key. Try to spend the money on something it isn't for. The Crumena
          contract on testnet decides, live.
        </p>
        {s?.ready && (
          <div className="challenge-stats" aria-live="polite">
            <div>
              <b>{s.refused?.toLocaleString()}</b>
              <span>tries refused</span>
            </div>
            <div>
              <b className={s.gotThrough ? "bad" : "zero"}>{s.gotThrough}</b>
              <span>got through</span>
            </div>
            <div>
              <b>{s.balance ? units(BigInt(s.balance), 6) : "–"}</b>
              <span>fUSD still in the pot</span>
            </div>
          </div>
        )}
      </div>

      {!s ? (
        <p className="challenge-note">Loading the pot…</p>
      ) : !s.ready ? (
        <p className="challenge-note">The challenge pot is being set up on testnet. Check back in a few minutes.</p>
      ) : (
        <div className="challenge-body">
          <div className="attacks">
            {s.attacks?.map((a) => (
              <button key={a.id} className="attack" onClick={() => run(a.id, a.what)} disabled={!!busy} aria-busy={busy === a.id}>
                <span className="attack-name">{SHORT[a.id] ?? a.id}</span>
                <span className="attack-what">{a.what}</span>
                <span className="attack-n">{busy === a.id ? "Trying…" : a.refused ? `${a.refused} refused` : "Try it"}</span>
              </button>
            ))}
            <button className="attack honest" onClick={() => run("honest", "Pay the approved payee 0.01 fUSD")} disabled={!!busy} aria-busy={busy === "honest"}>
              <span className="attack-name">Or play fair</span>
              <span className="attack-what">Pay the approved payee 0.01 fUSD, properly signed. This one goes through, with a receipt.</span>
              <span className="attack-n">{busy === "honest" ? "Paying…" : `${s.honest ?? 0} paid`}</span>
            </button>
          </div>
          <div className="console" role="log" aria-label="What the contract said">
            <div className="console-head">
              <span>pot #{s.potId}</span>
              {s.vault && <a href={potHref(s.vault)}>open the pot</a>}
            </div>
            {log.length === 0 ? (
              <p className="console-empty">Pick a move on the left. Each one is built the way an attacker would build it, then run against the live contract.</p>
            ) : (
              log.map((l) =>
                "error" in l ? (
                  <div key={l.at} className="cline">
                    <span className="tag">·</span>
                    <div>
                      <div className="cline-what">{l.what}</div>
                      <div className="cline-why">{l.error}</div>
                    </div>
                  </div>
                ) : (
                  <div key={l.at} className={`cline ${l.refused ? "no" : "yes"}`}>
                    <span className="tag">{l.refused ? "✕" : "✓"}</span>
                    <div>
                      <div className="cline-what">{l.what}</div>
                      <div className="cline-why">
                        {l.refused ? (
                          <>
                            Refused by the contract: <code>{l.reason}</code>. {l.explanation}
                          </>
                        ) : (
                          l.explanation
                        )}
                      </div>
                      <div className="cline-meta">
                        {l.refused ? `checked against block ${Number(l.block).toLocaleString()} · never sent, cost nothing` : `block ${Number(l.block).toLocaleString()}`}
                        {l.hash && s.vault && (
                          <>
                            {" · "}
                            <a href={`#/r/${potCode(s.vault)}/${l.hash}`}>receipt</a>
                          </>
                        )}
                      </div>
                      {l.statement && (
                        <details>
                          <summary>What was signed</summary>
                          <pre>{l.statement}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      )}
      <p className="challenge-foot">
        How it works: the server holds this pot's throwaway testnet keys and builds each move exactly as an attacker would, with a real ML-DSA-87 signature where
        the move has one. It then runs the call against the live contract, as the relayer does before sending anything. A refused move never reaches a block. The
        honest payment is sent for real. The same refusals are in the live test run further down, with real transactions.
      </p>
    </section>
  );
}

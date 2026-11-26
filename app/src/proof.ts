/**
 * The latest live run on QoreChain testnet (server/scripts/testnet-run.ts), shown on the home page:
 * docs/testnet-run.json is that run's own output file, copied unchanged.
 */
import run from "../../docs/testnet-run.json";
export interface ProofStep {
  step: string;
  ok: boolean;
  detail: string;
  tx?: string;
  qorechainTx?: string;
}
export interface Proof {
  at: string;
  crumena: string;
  passed: number;
  total: number;
  steps: ProofStep[];
}
export const PROOF: Proof | undefined = run as Proof;

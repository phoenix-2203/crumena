/**
 * The latest live run on QoreChain testnet (server/scripts/testnet-run.ts), shown on the home page.
 * Filled in from drill-results after each run; nothing here is written by hand.
 */
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
export const PROOF: Proof | undefined = undefined;

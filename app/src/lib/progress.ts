/**
 * The demo's "Start here" guide: four steps, ticked off as the visitor does them. Kept in this browser
 * only (localStorage), reset when a new demo starts.
 */
import { useEffect, useState } from "react";

export const DEMO_STEPS = [
  ["create", "Create a pot"],
  ["pay", "Pay a payee"],
  ["refused", "Try to overspend"],
  ["receipt", "Open a receipt"],
] as const;
export type DemoStep = (typeof DEMO_STEPS)[number][0];

const KEY = "crumena:demo-steps";
const EVENT = "crumena:demo-steps";

function read(): DemoStep[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as DemoStep[];
  } catch {
    return [];
  }
}

export function markStep(step: DemoStep) {
  const done = read();
  if (done.includes(step)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...done, step]));
  } catch {
    /* private mode: the guide just won't remember */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetSteps() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to reset */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useSteps(): DemoStep[] {
  const [done, setDone] = useState(read);
  useEffect(() => {
    const on = () => setDone(read());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return done;
}

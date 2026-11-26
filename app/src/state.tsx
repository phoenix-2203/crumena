import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createCrumena, loadConfig, type Config, type Crumena } from "./lib/crumena";
import { demoSigner, loadDemo, meOfPersona, saveDemo, type Persona, type Role } from "./lib/demo";
import { connect, findQorex, type Me, type Qorex } from "./lib/qorex";

/** Who is acting right now: a QoreX account, or one of the demo people. */
export interface Signer {
  me: Me;
  q: Qorex;
  label: string; // "Your QoreX account", "Demo: the funder"
  demo?: Role;
}

interface Pending {
  statement: string;
  fn: string;
  resolve: (ok: boolean) => void;
}

interface AppState {
  config?: Config;
  crumena?: Crumena;
  loadError?: string;
  signer?: Signer;
  demo?: Persona[];
  setDemo: (p: Persona[] | undefined) => void;
  actAs: (role: Role) => void;
  connectQorex: () => Promise<void>;
  signOut: () => void;
  pending?: Pending;
  toast: (message: ReactNode) => void;
  toastMessage?: ReactNode;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
};

const ROLE_LABEL: Record<Role, string> = { funder: "Demo: the funder", spender: "Demo: the spender", shop: "Demo: the shop" };

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config>();
  const [loadError, setLoadError] = useState<string>();
  const [signer, setSigner] = useState<Signer>();
  const [demo, setDemoState] = useState<Persona[] | undefined>(() => loadDemo());
  const [pending, setPending] = useState<Pending>();
  const [toastMessage, setToast] = useState<ReactNode>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    loadConfig().then(setConfig, () => setLoadError("Couldn't reach the Crumena server. Reload in a moment."));
  }, []);

  const toast = useCallback((m: ReactNode) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 7000);
  }, []);

  // Every signature goes through here first: the exact text, shown before QoreX (or the demo signer) signs it.
  const crumena = useMemo(
    () =>
      config &&
      createCrumena(config, {
        onStatement: (statement, fn) => new Promise<boolean>((resolve) => setPending({ statement, fn, resolve: (ok) => (setPending(undefined), resolve(ok)) })),
      }),
    [config],
  );

  const actAs = useCallback(
    (role: Role) => {
      const p = demo?.find((x) => x.role === role);
      if (p) setSigner({ me: meOfPersona(p), q: demoSigner(p), label: ROLE_LABEL[role], demo: role });
    },
    [demo],
  );

  const setDemo = useCallback((p: Persona[] | undefined) => {
    saveDemo(p);
    setDemoState(p);
    const funder = p?.find((x) => x.role === "funder");
    setSigner(funder ? { me: meOfPersona(funder), q: demoSigner(funder), label: ROLE_LABEL.funder, demo: "funder" } : undefined);
  }, []);

  // Coming back to a demo: act as its funder again.
  useEffect(() => {
    if (demo && !signer) actAs("funder");
  }, [demo, signer, actAs]);

  const connectQorex = useCallback(async () => {
    const q = await findQorex();
    const me = await connect(q);
    setSigner({ me, q: q!, label: "Your QoreX account" });
  }, []);

  const value: AppState = {
    config,
    crumena,
    loadError,
    signer,
    demo,
    setDemo,
    actAs,
    connectQorex,
    signOut: () => setSigner(undefined),
    pending,
    toast,
    toastMessage,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The current hash route, e.g. "#/pot/3" → ["pot", "3"]. */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (path: string) => {
  window.location.hash = path;
};

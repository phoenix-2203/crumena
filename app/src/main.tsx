import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Demo } from "./pages/Demo";
import { Home } from "./pages/Home";
import { NewPot } from "./pages/NewPot";
import { PotPage } from "./pages/PotPage";
import { Pots } from "./pages/Pots";
import { AppProvider, useApp, useRoute } from "./state";
import "./fonts";
import "./styles.css";
import { Layout } from "./ui";

function Routes() {
  const [page, arg] = useRoute();
  const { loadError } = useApp();
  if (loadError) return <p className="error">{loadError}</p>;
  switch (page) {
    case undefined:
      return <Home />;
    case "demo":
      return <Demo />;
    case "pots":
      return <Pots />;
    case "new":
      return <NewPot />;
    case "pot":
      return arg && /^\d+$/.test(arg) ? <PotPage key={arg} id={BigInt(arg)} /> : <p>That isn't a pot number.</p>;
    default:
      return (
        <p>
          Page not found. <a href="#/">Go home</a>.
        </p>
      );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <Layout>
        <Routes />
      </Layout>
    </AppProvider>
  </StrictMode>,
);

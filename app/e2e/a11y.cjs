// WCAG 2.1 AA check (axe-core) of each page, light and dark, on the local chain (e2e/local-chain.ts running): node e2e/a11y.cjs
const { chromium } = require("playwright") /* pre-installed */;
const fs = require("fs");
const axe = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const p = await b.newPage({ colorScheme: scheme });
    const check = async (label) => {
      await p.addScriptTag({ content: axe });
      const r = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} — ${v.nodes.slice(0,2).map(n => n.target.join(" ") + " :: " + (n.failureSummary||"").split("\n")[1]).join(" | ")}`));
      console.log(scheme, label, r.length ? r : "clean");
    };
    await p.goto("http://127.0.0.1:8799/"); await p.waitForTimeout(800); await check("home");
    await p.goto("http://127.0.0.1:8799/#/demo"); await p.waitForTimeout(500); await check("demo");
    if (scheme === "light") {
      await p.getByRole("button", { name: "Start the demo" }).click();
      await p.getByRole("heading", { name: "New pot" }).waitFor({ timeout: 30000 });
    } else { await p.goto("http://127.0.0.1:8799/#/new"); await p.waitForTimeout(800); }
    await check("new pot");
    await p.goto("http://127.0.0.1:8799/#/pot/1"); await p.waitForTimeout(2500); await check("pot");
  }
  await b.close();
})();

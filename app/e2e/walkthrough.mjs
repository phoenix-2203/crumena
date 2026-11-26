// Click through the demo on the local chain and save screenshots: node app/e2e/walkthrough.mjs [outDir]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // the pre-installed one in CI-less sandboxes; or add playwright as a dev dependency
const out = process.argv[2] ?? "e2e-shots";
const base = process.env.BASE ?? "http://127.0.0.1:8799";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const sign = async () => {
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: /^Sign as/ }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
};
const toast = async () => (await page.getByRole("status").textContent({ timeout: 20000 }))?.trim();
const as = (r) => page.locator(".demo-bar").getByRole("button", { name: r, exact: true }).click();

await page.goto(base);
await page.getByRole("heading", { name: "Money for one purpose." }).waitFor();
await shot("01-home");
await page.getByRole("link", { name: "Try it in two minutes" }).click();
await page.getByRole("button", { name: "Start the demo" }).click();
await page.getByRole("heading", { name: "New pot" }).waitFor({ timeout: 30000 });
await shot("02-new-pot");
await page.getByRole("button", { name: "Review and sign" }).click();
await page.getByRole("dialog").waitFor();
await shot("03-statement");
await sign();
await page.getByText(/Pot #\d+ ·/).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Add 50 test fUSD (demo)" }).click();
console.log("fund:", await toast());
await page.waitForTimeout(1500);
await page.reload();
await page.getByText("50 fUSD").first().waitFor();
await shot("04-pot-funder");

await as("Spender");
await page.getByLabel(/Amount \(fUSD\)/).fill("12.5");
await page.getByLabel(/Note/).fill("Invoice 1042");
await page.getByRole("button", { name: "Review and sign" }).first().click();
await sign();
console.log("pay:", await toast());
await page.getByLabel(/Amount \(fUSD\)/).fill("25");
await page.getByRole("button", { name: "Review and sign" }).first().click();
await sign(); // signed, but the contract refuses it: over the 20 fUSD cap
console.log("over cap:", await toast());
await page.waitForTimeout(500);
await shot("05-pot-spender");

await as("Vendor");
await page.getByRole("button", { name: /^Confirm as/ }).click();
await sign();
console.log("confirm:", await toast());

await as("Funder");
await page.getByRole("button", { name: "Freeze the pot now" }).click();
await sign();
console.log("freeze:", await toast());
await page.waitForTimeout(2500);
await page.reload();
await page.getByRole("button", { name: "Verify" }).first().waitFor({ timeout: 20000 });
const items = page.locator(".timeline li");
const paid = items.filter({ hasText: "Paid 12.5 fUSD" });
await paid.getByRole("button", { name: "Verify" }).click();
await paid.getByText(/Valid ML-DSA-87 signature|does not check out/).waitFor({ timeout: 20000 });
console.log("verify:", (await paid.locator(".pill").first().textContent())?.trim());
await shot("06-pot-funder-history");

await page.setViewportSize({ width: 390, height: 844 });
await shot("07-mobile");
await page.goto(`${base}/#/pots`);
await page.waitForTimeout(1200);
await shot("08-pots");
console.log("page errors:", errors.length ? errors : "none");
await browser.close();

/**
 * One-off screenshot script for the visual redesign — captures the 7
 * redesigned finance pages so the human reviewer can confirm the live
 * render matches the approved mockup.
 *
 * Run manually:
 *   PW_BASE_URL=http://localhost:5000 npx tsx qa/tools/redesign-screenshots.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PW_BASE_URL ?? "http://localhost:5000";
const USERNAME = process.env.E2E_COO_USERNAME ?? "johannes";
const PASSWORD = process.env.E2E_COO_PASSWORD ?? "2023";
const OUTPUT_DIR = path.join(process.cwd(), "tmp", "redesign-screenshots");

const PAGES = [
  { name: "cashflow", path: "/cashflow" },
  { name: "cashflow-analysis", path: "/cashflow/analysis" },
  { name: "cos", path: "/cos" },
  { name: "cos-analysis", path: "/cos/analysis" },
  { name: "revenue-tracker", path: "/revenue-tracker" },
  { name: "finance-gp-company", path: "/finance/gp/company" },
  { name: "fye-revenue-tracking", path: "/fye-revenue-tracking" },
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Dev auth bypass — /api/auth/dev-login redirects to /auth/ms-callback
  // with an auth code that the SPA exchanges for a session.
  await page.goto(`${BASE}/api/auth/dev-login`);
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 20_000 });
  // Silence unused-cred warning — kept in case the seed-user path is needed.
  void USERNAME;
  void PASSWORD;

  for (const target of PAGES) {
    process.stdout.write(`shooting ${target.name}... `);
    try {
      await page.goto(`${BASE}${target.path}`, { waitUntil: "networkidle", timeout: 20_000 });
    } catch {
      await page.goto(`${BASE}${target.path}`, { waitUntil: "load", timeout: 20_000 });
    }
    await page.waitForTimeout(1500);
    const file = path.join(OUTPUT_DIR, `${target.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    process.stdout.write(`→ ${file}\n`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

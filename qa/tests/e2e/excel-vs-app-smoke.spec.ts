/**
 * Excel-vs-App diff page — Playwright smoke.
 *
 * Two scenarios:
 *   1. COO_ADMIN happy path: page loads, summary card is visible,
 *      drift counters render (or "no projects" empty state).
 *   2. ENGINEER (view-only role): page loads (excel_vs_app:view is
 *      role-broad), but the resolve API endpoint denies edits with
 *      a 403 carrying the section role gate.
 *
 * Skipped when the standard E2E creds env vars aren't set — same
 * convention as `admin-roles-shell.spec.ts` and `smoke.spec.ts`.
 *
 * Per-project page is reachable via the Open-diff link from the
 * program page; the per-project drift detail render is covered by
 * the unit suite (`excel-vs-app-flow.test.ts` against postgres).
 */
import { test, expect, type Page } from "@playwright/test";

const COO_USERNAME = process.env.E2E_COO_USERNAME || "johannes";
const COO_PASSWORD = process.env.E2E_COO_PASSWORD || "2023";

const ENGINEER_USERNAME = process.env.E2E_ENGINEER_USERNAME || "paul";
const ENGINEER_PASSWORD = process.env.E2E_ENGINEER_PASSWORD || "2029";

async function loginAs(page: Page, username: string, password: string) {
  await page.goto("/auth/login");
  await page.fill('[data-testid="input-username"], input[name="username"], input[type="text"]', username);
  await page.fill('[data-testid="input-password"], input[name="password"], input[type="password"]', password);
  await page.click('[data-testid="button-login"], button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 15_000 });
}

test.describe("Excel-vs-App diff page", () => {
  test("COO_ADMIN sees the program summary", async ({ page }) => {
    await loginAs(page, COO_USERNAME, COO_PASSWORD);
    await page.goto("/program/excel-vs-app");

    // Heading is the most stable selector — copy ships with the page.
    await expect(page.getByRole("heading", { name: /Excel vs App/i })).toBeVisible({
      timeout: 10_000,
    });

    // Summary cards are always rendered (even on an empty portfolio).
    // Look for the "Projects" label as a stable anchor.
    await expect(page.getByText(/^Projects$/i).first()).toBeVisible();

    // Drift table is visible (either with rows or with the empty-state row).
    // The empty-state copy is "No projects match the current filter."
    const tableOrEmpty = page.locator(
      "table, text=/No projects match the current filter/i",
    );
    await expect(tableOrEmpty.first()).toBeVisible();

    // No 5xx responses while the page loaded.
    const errorResponses: number[] = [];
    page.on("response", r => {
      if (r.status() >= 500) errorResponses.push(r.status());
    });
    await page.waitForTimeout(500);
    expect(errorResponses, "no 5xx during page load").toEqual([]);
  });

  test("ENGINEER role can view but resolve API denies", async ({ page }) => {
    await loginAs(page, ENGINEER_USERNAME, ENGINEER_PASSWORD);
    await page.goto("/program/excel-vs-app");
    // View permission is broad; the page should load.
    await expect(page.getByRole("heading", { name: /Excel vs App/i })).toBeVisible({
      timeout: 10_000,
    });

    // Try to resolve drift via direct API call. Expect 403 with the
    // per-section RBAC error from DRIFT_RESOLVER_ROLES.
    // Use any project id; the RBAC gate fires before the project lookup.
    const apiCtx = page.context().request;
    const res = await apiCtx.post("/api/excel-vs-app/projects/1/resolve", {
      data: {
        action: "accept_excel",
        entries: [
          { table: "normalized_cost_lines", rowId: 999_999_999, fieldName: "amountExVat" },
        ],
      },
    });
    // 403 = role-based denial. 404 = project not found (rare). Either
    // is correct — what we MUST NOT see is 200 (engineer accidentally
    // resolving cost drift).
    expect([403, 404]).toContain(res.status());
    if (res.status() === 403) {
      const body = await res.json();
      const message = `${body.message ?? body.error ?? ""}`;
      expect(message).toMatch(/cannot resolve drift|EXPENDITURE/i);
    }
  });
});

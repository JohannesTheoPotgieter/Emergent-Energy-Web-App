/**
 * Task #83 — End-to-end render contract for the Opportunity drawer
 * when no engineering shadow ticket exists.
 *
 * Creates a deterministic fixture opportunity (no engineering_tickets
 * row), navigates the admin user to `/opportunities?open=<id>` (the
 * deep-link pattern used by the PD dashboard, see opportunities.tsx
 * line 358-375), and asserts the drawer renders successfully:
 *   - the "Could not load opportunity." fallback (testid
 *     `opportunity-detail-error`) is NOT visible, AND
 *   - the "No engineering ticket" pill (testid
 *     `badge-no-engineering-ticket`) IS visible, AND
 *   - the empty-tickets copy (testid `text-no-pd-tickets-yet`) is
 *     visible in the Tickets section, AND
 *   - the header CRM stat row (Value / Owner / CRM stage) is rendered.
 *
 * Pre-fix, this exact navigation path produced "Could not load
 * opportunity." for every opportunity without a shadow.
 *
 * NOTE on release-gate wiring: this spec is intentionally NOT wired
 * into `qa/release-gate.ts` (mirroring the precedent that
 * `qa/tests/e2e/smoke.spec.ts` is also not in the gate — Playwright
 * browser binaries are not provisioned in the gate runner). The
 * canonical regression guard inside the gate is the integration
 * test at `qa/tests/integration/opportunity-drawer-no-shadow.test.ts`.
 * This spec is run via `npx playwright test -c qa/playwright.config.ts
 * qa/tests/e2e/opportunity-drawer-no-shadow.spec.ts` in environments
 * with chromium available (CI, the testing-skill subagent, dev
 * machines with `npx playwright install chromium` completed).
 */
import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";

const SENTINEL = `TASK_83_DRAWER_E2E_${Date.now()}`;
let pool: Pool;
let fixtureOpportunityId: number;

async function loginAdmin(page: Page) {
  await page.goto("/auth/login");
  await page.fill(
    '[data-testid="input-username"], input[name="username"], input[type="text"]',
    "johannes",
  );
  await page.fill(
    '[data-testid="input-password"], input[name="password"], input[type="password"]',
    "2023",
  );
  await page.click('[data-testid="button-login"], button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 10_000 });
}

test.describe.serial("Opportunity drawer renders with no engineering shadow", () => {
  test.beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const ins = await pool.query(
      `INSERT INTO opportunities (deal_name, notes)
            VALUES ($1, 'Created by qa/tests/e2e/opportunity-drawer-no-shadow.spec.ts (Task #83). Safe to delete.')
       RETURNING id`,
      [SENTINEL],
    );
    fixtureOpportunityId = ins.rows[0].id as number;
    // Confirm fixture pre-condition: no shadow ticket exists.
    const shadowCheck = await pool.query(
      `SELECT 1 FROM engineering_tickets WHERE opportunity_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixtureOpportunityId],
    );
    expect(shadowCheck.rowCount, "fixture must have NO engineering shadow ticket").toBe(0);
  });

  test.afterAll(async () => {
    if (pool && fixtureOpportunityId) {
      await pool.query(`DELETE FROM engineering_tickets WHERE opportunity_id = $1`, [fixtureOpportunityId]).catch(() => {});
      await pool.query(`DELETE FROM opportunities WHERE id = $1`, [fixtureOpportunityId]).catch(() => {});
    }
    await pool?.end().catch(() => {});
  });

  test("the drawer opens, shows the 'No engineering ticket' pill, and never shows the load-failure fallback", async ({ page }) => {
    const responses500: string[] = [];
    page.on("response", (res) => {
      if (res.status() >= 500) responses500.push(`${res.status()} ${res.url()}`);
    });

    await loginAdmin(page);

    // Use the documented deep-link to open the drawer for this exact
    // opportunity (no need to scroll/search the list).
    await page.goto(`/opportunities?open=${fixtureOpportunityId}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    // Wait for the workflow XHR to settle. The drawer renders one of
    // either badge-no-engineering-ticket or badge-engineering-status
    // once the workflow query resolves.
    const noTicketBadge = page.locator('[data-testid="badge-no-engineering-ticket"]');
    const engStatusBadge = page.locator('[data-testid="badge-engineering-status"]');
    await expect.poll(
      async () => (await noTicketBadge.isVisible().catch(() => false)) || (await engStatusBadge.isVisible().catch(() => false)),
      { timeout: 10_000, message: "drawer never resolved either status badge — load probably failed" },
    ).toBe(true);

    // Hard contract assertions:

    // 1. "Could not load opportunity." MUST NOT appear.
    const errorFallback = page.locator('[data-testid="opportunity-detail-error"]');
    await expect(errorFallback, "Task #83 regression: drawer fell through to 'Could not load opportunity.' for an opportunity with no engineering shadow").toBeHidden();
    await expect(page.getByText("Could not load opportunity.", { exact: false })).toBeHidden();

    // 2. The fixture has no shadow, so the no-engineering-ticket pill
    //    is the badge that MUST be visible (the engineering-status
    //    badge would mean a shadow was lazily created — a regression
    //    of the 2026-04-23 auto-spawn removal).
    await expect(noTicketBadge, "fixture has no engineering shadow — the 'No engineering ticket' pill must render").toBeVisible();
    await expect(noTicketBadge).toHaveText(/No engineering ticket/i);
    await expect(engStatusBadge, "engineering-status badge must NOT render for a no-shadow opportunity (would imply auto-spawn regressed)").toBeHidden();

    // 3. The Tickets-section empty-state copy MUST render with the
    //    convert CTA pathway available below it.
    const noTicketsCopy = page.locator('[data-testid="text-no-pd-tickets-yet"]');
    await expect(noTicketsCopy, "Tickets section must show 'No PD tickets yet' empty-state when merged?.projectId is falsy").toBeVisible();

    // 4. The header CRM stat row MUST render — the drawer body
    //    successfully made it past the load-failure gate.
    await expect(page.getByText("Value", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("CRM stage", { exact: true }).first()).toBeVisible();

    // 5. No 5xx response from the workflow endpoint.
    expect(responses500, `unexpected 5xx responses during drawer load: ${responses500.join(", ")}`).toEqual([]);
  });
});

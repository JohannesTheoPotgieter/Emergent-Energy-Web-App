// Task #103 — End-to-end coverage for the rebuilt /admin/roles screen.
//
// Walks a COO_ADMIN user through the People tab the way they would on a
// normal day:
//   1. Log in via the standard form.
//   2. Open /admin/roles and confirm the three-tab shell rendered.
//   3. Switch between Roles, Advanced and back to People — every tab
//      surfaces its primary content (no blank panes).
//   4. Filter the People table to a *known, deterministic* test user
//      (defaults to "paul", a seeded ENGINEER fixture used by the rest
//      of the qa/ suite).
//   5. Pick a permission template from that user's row.
//   6. Wait for the apply dialog to render, including the plain-English
//      diff headline.
//   7. Type a reason, confirm "Apply template", wait for the dialog to
//      close.
//   8. Hit /api/admin/permission-audit-log and assert that a fresh
//      `template_applied_to_user` row exists for our target user/template
//      with the reason text we typed.
//   9. afterEach: re-apply the user's *natural baseline* template
//      (engineer for an ENGINEER) so every divergent override written
//      during the test is removed. applyTemplateToUser deletes any
//      override whose template value matches the role baseline, so this
//      restores the test user to a clean state regardless of test
//      outcome — keeping the release-gate idempotent.

import { test, expect, type Page } from "@playwright/test";

// Note on auth: Playwright's top-level `request` fixture is an isolated
// APIRequestContext that does NOT share cookies with the browser `page`.
// To call admin APIs as the just-logged-in user we always use
// `page.context().request`, which carries the connect.sid session cookie
// set by the form login below.

const COO_USERNAME = process.env.E2E_COO_USERNAME || "johannes";
const COO_PASSWORD = process.env.E2E_COO_PASSWORD || "2023";

// Deterministic target user. Defaults to "paul" — a seeded ENGINEER
// fixture already used by the smoke spec — so the COO walkthrough is
// fully repeatable. Override via env in CI if a different fixture is
// preferred.
const TARGET_USERNAME = process.env.E2E_TARGET_USERNAME || "paul";
// Template to APPLY during the test. Must diverge from the target
// user's role baseline so the diff has real content; project_manager
// vs ENGINEER guarantees plenty of deltas without granting admin rights.
const APPLY_TEMPLATE_KEY = process.env.E2E_APPLY_TEMPLATE || "project_manager";
// Template that MATCHES the target user's natural role baseline. After
// the test we apply this to clear every override the test wrote, since
// applyTemplateToUser drops overrides that match the role baseline.
const BASELINE_TEMPLATE_KEY = process.env.E2E_TARGET_BASELINE_TEMPLATE || "engineer";

interface AdminUser {
  id: number;
  username?: string;
  name?: string;
  role: string;
  email?: string;
}

interface AuditEntry {
  id: number;
  eventType: string;
  targetUserId: number | null;
  targetRole: string | null;
  changedByUserId: number | null;
  changeDetail: Record<string, unknown> | null;
  createdAt: string;
}

async function loginAsCoo(page: Page) {
  await page.goto("/auth/login");
  await page.fill('[data-testid="input-username"]', COO_USERNAME);
  await page.fill('[data-testid="input-password"]', COO_PASSWORD);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 10000 });
}

async function readCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";
  expect(csrf, "csrf-token cookie should have been set after login").not.toBe("");
  return csrf;
}

// Fetch the deterministic target user. We deliberately do NOT pick
// "first non-admin" — that was the original design, but it meant a real
// seeded user could be silently mutated by every gate run. The
// /api/admin/users endpoint returns id/name/email/role (no username
// field), so we match the configured identifier against username (if
// the API ever exposes it), name (case-insensitive) and the local-part
// of email — whichever hits first wins.
async function fetchTargetUser(page: Page): Promise<AdminUser> {
  const apiCtx = page.context().request;
  const res = await apiCtx.get("/api/admin/users");
  expect(res.status(), "GET /api/admin/users should succeed for COO").toBe(200);
  const raw = (await res.json()) as AdminUser[] | { users: AdminUser[] };
  const list = Array.isArray(raw) ? raw : raw.users ?? [];
  const needle = TARGET_USERNAME.toLowerCase();
  const target = list.find((u) => {
    const username = (u.username ?? "").toLowerCase();
    const name = (u.name ?? "").toLowerCase();
    const emailLocal = (u.email ?? "").toLowerCase().split("@")[0] ?? "";
    return username === needle || name === needle || emailLocal === needle;
  });
  expect(
    target,
    `expected dedicated test user "${TARGET_USERNAME}" in /api/admin/users (matched against username/name/email-local-part) — set E2E_TARGET_USERNAME if your env uses a different fixture`,
  ).toBeTruthy();
  return target as AdminUser;
}

test.describe("Admin Roles shell — COO end-to-end (Task #103)", () => {
  test.setTimeout(60_000);

  // Cleanup is keyed off whatever target the test resolves; remember it
  // here so the afterEach hook can restore baseline regardless of which
  // assertion failed.
  let restoreTargetId: number | null = null;

  test.afterEach(async ({ page }) => {
    if (restoreTargetId === null) return;
    // Best-effort cleanup: re-apply the role-matching template so every
    // override written during the test is dropped. Errors here must not
    // mask the test result, but we log them so a broken cleanup is
    // visible in CI output.
    try {
      const csrf = await readCsrfToken(page);
      const apiCtx = page.context().request;
      const cleanupRes = await apiCtx.post(
        `/api/admin/users/${restoreTargetId}/apply-template`,
        {
          data: {
            templateKey: BASELINE_TEMPLATE_KEY,
            reason: "E2E Task #103 cleanup — restore role baseline",
          },
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          failOnStatusCode: false,
        },
      );
      if (cleanupRes.status() !== 200) {
        console.warn(
          `[admin-roles-shell.spec] cleanup apply-template returned ${cleanupRes.status()}; user#${restoreTargetId} may still have residual overrides`,
        );
      }
    } catch (err) {
      console.warn(`[admin-roles-shell.spec] cleanup threw:`, err);
    } finally {
      restoreTargetId = null;
    }
  });

  test("COO walks People tab → applies template → audit row written", async ({ page }) => {
    await loginAsCoo(page);

    const apiCtx = page.context().request;
    const target = await fetchTargetUser(page);
    restoreTargetId = target.id;

    await page.goto("/admin/roles");
    await expect(page.getByTestId("admin-roles-shell"), "shell rendered").toBeVisible();
    await expect(page.getByTestId("tabs-admin-roles"), "tabs rendered").toBeVisible();
    await expect(page.getByTestId("tab-people")).toBeVisible();
    await expect(page.getByTestId("tab-roles")).toBeVisible();
    await expect(page.getByTestId("tab-advanced")).toBeVisible();

    // Cross-tab smoke: every tab surfaces its primary content.
    await page.getByTestId("tab-roles").click();
    await expect(page.getByTestId("roles-tab")).toBeVisible();
    await page.getByTestId("tab-advanced").click();
    // Advanced tab hosts the legacy matrix; assert it actually mounted by
    // looking for any data-testid produced by that page rather than coupling
    // to specific copy.
    await expect(
      page.locator('[data-testid="card-compare-roles"], [data-testid="people-tab"], table, [role="tabpanel"]').first(),
    ).toBeVisible();
    await page.getByTestId("tab-people").click();
    await expect(page.getByTestId("people-tab")).toBeVisible();

    // Filter to our target user — name first, then username, then email,
    // since the PeopleTab.filter handler matches across all of them.
    const filterValue = target.name || target.username || target.email || String(target.id);
    await page.getByTestId("input-people-filter").fill(filterValue);
    const userRow = page.getByTestId(`row-user-${target.id}`);
    await expect(userRow, "filtered user row visible").toBeVisible();

    // Pick the divergent template from the row's apply-template select.
    const templateSelect = page.getByTestId(`select-template-${target.id}`);
    await templateSelect.selectOption(APPLY_TEMPLATE_KEY);

    // Dialog opens, diff calculates.
    const dialog = page.getByTestId("dialog-apply-template");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("text-diff-headline")).toBeVisible();

    const reason = `E2E Task #103 verification @ ${new Date().toISOString()}`;
    await page.getByTestId("input-apply-reason").fill(reason);

    const confirmButton = page.getByTestId("button-confirm-apply");
    await expect(confirmButton).toBeEnabled();

    const applyResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/admin/users/${target.id}/apply-template`) &&
        res.request().method() === "POST",
    );
    await confirmButton.click();
    const apiRes = await applyResponse;
    expect(apiRes.status(), "apply-template API succeeds").toBe(200);

    // Dialog closes on success.
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Audit-log assertion: the freshest template_applied_to_user row must
    // reference our target user, the divergent template and the reason
    // we typed in the dialog.
    const auditRes = await apiCtx.get(
      "/api/admin/permission-audit-log?eventType=template_applied_to_user&limit=20",
    );
    expect(auditRes.status(), "audit log readable by COO").toBe(200);
    const auditBody = (await auditRes.json()) as { entries: AuditEntry[] };
    const match = auditBody.entries.find((entry) => {
      const detail = entry.changeDetail ?? {};
      return (
        entry.eventType === "template_applied_to_user" &&
        entry.targetUserId === target.id &&
        (detail as Record<string, unknown>).templateKey === APPLY_TEMPLATE_KEY &&
        (detail as Record<string, unknown>).reason === reason
      );
    });
    expect(
      match,
      `audit row for user#${target.id} + ${APPLY_TEMPLATE_KEY} + reason "${reason}" should exist`,
    ).toBeTruthy();
  });
});

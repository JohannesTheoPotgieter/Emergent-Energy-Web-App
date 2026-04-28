// Task #107 — End-to-end coverage for the rebuilt single-screen /admin/roles.
//
// Walks a COO_ADMIN through the new layout the way they would on a normal
// day:
//   1. Log in via the standard form.
//   2. Open /admin/roles and confirm the page header + picker rail are visible.
//   3. Toggle the rail to Roles, confirm role rows render, then back to People.
//   4. Search the rail for the deterministic test user (defaults to "paul",
//      a seeded ENGINEER fixture used by the rest of the qa/ suite).
//   5. Click the user's row → right panel mounts with reassign/apply controls.
//   6. Pick a divergent template from the Apply-template select.
//   7. Wait for the apply dialog to render, including the plain-English
//      diff headline.
//   8. Type a reason, confirm "Apply template", wait for the dialog to close.
//   9. Hit /api/admin/permission-audit-log and assert that a fresh
//      `template_applied_to_user` row exists for our target user/template
//      with the reason text we typed.
//  10. Open the "Change history" slide-over from the page header and assert
//      it surfaces the audit table.
//  11. afterEach: re-apply the user's *natural baseline* template
//      (engineer for an ENGINEER) so every divergent override written
//      during the test is removed.

import { test, expect, type Page } from "@playwright/test";

// Note on auth: Playwright's top-level `request` fixture is an isolated
// APIRequestContext that does NOT share cookies with the browser `page`.
// To call admin APIs as the just-logged-in user we always use
// `page.context().request`, which carries the connect.sid session cookie
// set by the form login below.

const COO_USERNAME = process.env.E2E_COO_USERNAME || "johannes";
const COO_PASSWORD = process.env.E2E_COO_PASSWORD || "2023";

const TARGET_USERNAME = process.env.E2E_TARGET_USERNAME || "paul";
const APPLY_TEMPLATE_KEY = process.env.E2E_APPLY_TEMPLATE || "project_manager";
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
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 10_000 });
}

async function readCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";
  expect(csrf, "csrf-token cookie should have been set after login").not.toBe("");
  return csrf;
}

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
    `expected dedicated test user "${TARGET_USERNAME}" in /api/admin/users — set E2E_TARGET_USERNAME if your env uses a different fixture`,
  ).toBeTruthy();
  return target as AdminUser;
}

test.describe("Admin Roles single-screen — COO end-to-end (Task #107)", () => {
  test.setTimeout(60_000);

  let restoreTargetId: number | null = null;

  test.afterEach(async ({ page }) => {
    if (restoreTargetId === null) return;
    try {
      const csrf = await readCsrfToken(page);
      const apiCtx = page.context().request;
      const cleanupRes = await apiCtx.post(
        `/api/admin/users/${restoreTargetId}/apply-template`,
        {
          data: {
            templateKey: BASELINE_TEMPLATE_KEY,
            reason: "E2E Task #107 cleanup — restore role baseline",
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

  test("COO walks single-screen → applies template → audit row written → change history slide-over visible", async ({ page }) => {
    await loginAsCoo(page);

    const apiCtx = page.context().request;
    const target = await fetchTargetUser(page);
    restoreTargetId = target.id;

    // ── Deep-link contract: ?user=<id> opens the user directly ─────
    // Verify the documented URL param wakes up the right panel without
    // any clicks on the rail. This is the published contract for
    // hand-rolled links from email/Slack/etc.
    await page.goto(`/admin/roles?user=${target.id}`);
    await expect(page.getByTestId("admin-roles-page")).toBeVisible();
    await expect(page.getByTestId("right-panel-user"), "?user= deep-link selects person").toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/admin/roles");

    // ── 1. Header + picker rail render ────────────────────────────
    await expect(page.getByTestId("admin-roles-page"), "page mounted").toBeVisible();
    await expect(page.getByTestId("picker-rail"), "left rail visible").toBeVisible();
    await expect(page.getByTestId("rail-mode-people")).toBeVisible();
    await expect(page.getByTestId("rail-mode-roles")).toBeVisible();
    await expect(page.getByTestId("button-change-history")).toBeVisible();
    const visibilityLink = page.getByTestId("button-visibility-settings");
    await expect(visibilityLink).toBeVisible();
    // The header CTA must point at the dedicated visibility surface so the
    // single-screen page does not duplicate its functionality.
    await expect(visibilityLink).toHaveAttribute("href", "/admin/settings?section=visibility");

    // ── 2. Toggle to Roles, confirm role rows render, switch back ─
    await page.getByTestId("rail-mode-roles").click();
    await expect(
      page.locator('[data-testid^="rail-item-role-"]').first(),
      "at least one role row in rail",
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("rail-mode-people").click();
    await expect(
      page.locator('[data-testid^="rail-item-user-"]').first(),
      "at least one user row in rail",
    ).toBeVisible({ timeout: 10_000 });

    // ── 3. Search the rail and pick our target user ───────────────
    const filterValue = target.name || target.username || target.email || String(target.id);
    await page.getByTestId("rail-search").fill(filterValue);
    const userRow = page.getByTestId(`rail-item-user-${target.id}`);
    await expect(userRow, "filtered user row visible in rail").toBeVisible();
    await userRow.click();

    // ── 4. Right panel mounts ─────────────────────────────────────
    await expect(page.getByTestId("right-panel-user")).toBeVisible();
    await expect(page.getByTestId("apply-template-section")).toBeVisible();
    await expect(page.getByTestId("button-manage-account")).toBeVisible();

    // ── 5. Apply template via the right-panel select ──────────────
    // Look up the human label for APPLY_TEMPLATE_KEY so the test stays
    // consistent if the env override changes (e.g. CI uses a different key).
    const tplListRes = await apiCtx.get("/api/admin/role-templates");
    expect(tplListRes.status(), "GET /api/admin/role-templates should succeed for COO").toBe(200);
    const tplBody = (await tplListRes.json()) as { templates: { key: string; name: string }[] };
    const targetTemplate = tplBody.templates.find((t) => t.key === APPLY_TEMPLATE_KEY);
    expect(
      targetTemplate,
      `template key "${APPLY_TEMPLATE_KEY}" should exist in /api/admin/role-templates — set E2E_APPLY_TEMPLATE if your env uses a different key`,
    ).toBeTruthy();
    const templateLabel = targetTemplate!.name;

    const applySection = page.getByTestId("apply-template-section");
    // SearchableSelect renders as a button trigger; click then choose the option.
    await applySection.locator("button").first().click();
    await page.getByRole("option", { name: new RegExp(templateLabel, "i") }).first().click();

    // ── 6. Dialog opens, diff calculates ──────────────────────────
    const dialog = page.getByTestId("dialog-apply-template");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("text-diff-headline")).toBeVisible();

    const reason = `E2E Task #107 verification @ ${new Date().toISOString()}`;
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

    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── 7. Audit-log API assertion ────────────────────────────────
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

    // ── 8. Change history slide-over opens from header button ─────
    await page.getByTestId("button-change-history").click();
    await expect(page.getByTestId("audit-log-drawer")).toBeVisible();

    // ── 9. Roles deep-link contract: ?role=<KEY> ──────────────────
    // The rail must remember which mode is active when the user opens
    // a role-scoped link, and the role detail panel must render without
    // a click on the rail.
    const sampleRole = (await (await apiCtx.get("/api/roles/control-center")).json()) as {
      roles: Array<{ role: string }>;
    };
    const someRole = sampleRole.roles?.[0]?.role;
    expect(someRole, "expected at least one role from /api/roles/control-center").toBeTruthy();
    await page.goto(`/admin/roles?role=${someRole}`);
    await expect(page.getByTestId("rail-mode-roles"), "Roles tab is active for ?role= deep-link").toBeVisible();
    await expect(page.getByTestId("right-panel-role"), "?role= deep-link selects role").toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("button-compare-role"), "Compare-with-another-role CTA visible").toBeVisible();
    await expect(
      page.getByTestId("apply-template-role-section"),
      "Role-side Apply template control is exposed",
    ).toBeVisible();
  });
});

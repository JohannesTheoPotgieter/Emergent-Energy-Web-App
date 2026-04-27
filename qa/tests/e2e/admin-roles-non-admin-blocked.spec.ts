// Task #103 — Negative coverage for /admin/roles.
//
// A non-admin (ENGINEER) must be blocked at two layers:
//   1. UI: navigating to /admin/roles renders the AccessDenied page
//      (no template selectors, no apply dialog).
//   2. API: POST /api/admin/users/:id/apply-template returns 403 even
//      when invoked with the engineer's own session, so a curl-savvy
//      user can't bypass the UI.

import { test, expect, type Page } from "@playwright/test";

const ENGINEER_USERNAME = process.env.E2E_ENGINEER_USERNAME || "paul";
const ENGINEER_PASSWORD = process.env.E2E_ENGINEER_PASSWORD || "2029";

async function loginAsEngineer(page: Page) {
  await page.goto("/auth/login");
  await page.fill('[data-testid="input-username"]', ENGINEER_USERNAME);
  await page.fill('[data-testid="input-password"]', ENGINEER_PASSWORD);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 10000 });
}

test.describe("Admin Roles shell — non-admin blocked (Task #103)", () => {
  test.setTimeout(45_000);

  test("ENGINEER cannot reach /admin/roles in the UI", async ({ page }) => {
    await loginAsEngineer(page);

    await page.goto("/admin/roles");
    // The route guard renders an AccessDenied panel for users without
    // admin_roles.view; assert that and that none of the privileged
    // surfaces (people-tab, roles-tab) ever mounted.
    await expect(page.getByText(/Access Denied/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("people-tab")).toHaveCount(0);
    await expect(page.getByTestId("roles-tab")).toHaveCount(0);
    await expect(page.getByTestId("dialog-apply-template")).toHaveCount(0);
  });

  test("ENGINEER session gets 403 from apply-template API", async ({ page }) => {
    await loginAsEngineer(page);

    // Use the page's own browser-context APIRequestContext so the
    // session cookie set by the form login is sent — without this we'd
    // hit the endpoint anonymously and get 401, which would mask the
    // actual permission-middleware behaviour we want to lock in.
    const ctx = page.context();
    const apiCtx = ctx.request;

    // Mutating endpoints are protected by double-submit CSRF: the server
    // sets a non-httpOnly `csrf-token` cookie and the frontend echoes it
    // back as `X-CSRF-Token`. Without this header the request is
    // rejected by the CSRF middleware (also 403) — but with the wrong
    // reason, so we'd never actually exercise the permission middleware
    // we care about. Read the cookie and forward it explicitly.
    const cookies = await ctx.cookies();
    const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";
    expect(csrf, "csrf-token cookie should have been set after login").not.toBe("");

    // Pick any plausible target user id — the call must be rejected by
    // the permission middleware before it ever reaches the apply logic,
    // so the user id and template key are irrelevant to the assertion.
    const res = await apiCtx.post("/api/admin/users/1/apply-template", {
      data: { templateKey: "engineer", reason: "E2E negative test — should be blocked" },
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      failOnStatusCode: false,
    });
    expect(
      res.status(),
      `apply-template must reject ENGINEER (got ${res.status()})`,
    ).toBe(403);
    // Make sure the rejection came from the permission middleware
    // (entity=admin), not from CSRF/auth bootstrap, otherwise this spec
    // would silently pass even if admin authz was removed.
    const body = await res.json().catch(() => ({}));
    expect(
      JSON.stringify(body).toLowerCase(),
      `403 body should look like a permission denial, got: ${JSON.stringify(body)}`,
    ).toMatch(/forbidden|admin|permission/);

    // Defence in depth: the user-scoped preview endpoint should also be
    // closed to non-admins so the diff can't leak. GET requests don't
    // need CSRF, so this hit is straightforward.
    const previewRes = await apiCtx.get("/api/admin/users/1/preview-template/engineer", {
      failOnStatusCode: false,
    });
    expect(previewRes.status(), "preview endpoint must also be admin-only").toBe(403);
  });
});

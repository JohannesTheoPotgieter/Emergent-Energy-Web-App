// Task #111 — Smoke coverage for the rebuilt /admin/settings?section=visibility.
//
// The legacy page hid PD Inbox visibility and Workstream visibility behind
// two internal tabs; admins kept missing the second tab and calling support.
// The new layout drops the tabs and stacks both sections vertically with
// their own h2 headings. This spec just walks a COO_ADMIN to the page and
// asserts both headings are simultaneously in the DOM, plus that the old
// tab buttons are gone so we don't silently regress to the tabbed layout.

import { test, expect, type Page } from "@playwright/test";

const COO_USERNAME = process.env.E2E_COO_USERNAME || "johannes";
const COO_PASSWORD = process.env.E2E_COO_PASSWORD || "2023";

async function loginAsCoo(page: Page) {
  await page.goto("/auth/login");
  await page.fill('[data-testid="input-username"]', COO_USERNAME);
  await page.fill('[data-testid="input-password"]', COO_PASSWORD);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 10_000 });
}

test.describe("Admin Settings — Visibility single-page layout (Task #111)", () => {
  test.setTimeout(30_000);

  test("COO sees PD Inbox visibility and Workstream visibility stacked on one page", async ({ page }) => {
    await loginAsCoo(page);

    await page.goto("/admin/settings?section=visibility");

    // Page shell mounted as the visibility section.
    await expect(page.getByTestId("section-visibility"), "visibility section mounted").toBeVisible({
      timeout: 10_000,
    });

    // Both h2 headings render simultaneously — that's the whole point of #111.
    const pdHeading = page.getByTestId("heading-pd-visibility");
    const wsHeading = page.getByTestId("heading-workstream-visibility");

    await expect(pdHeading, "PD Inbox visibility heading is rendered").toBeVisible();
    await expect(pdHeading).toHaveText(/PD Inbox visibility/i);

    // No click between the two assertions: both are present at the same time.
    await expect(wsHeading, "Workstream visibility heading is rendered").toBeVisible();
    await expect(wsHeading).toHaveText(/Workstream visibility/i);

    // Section bodies render under the headings (regression guard against the
    // headings shipping without the actual content underneath).
    await expect(page.getByTestId("section-pd-visibility")).toBeVisible();
    await expect(page.getByTestId("section-workstream-visibility")).toBeVisible();

    // The old internal tab buttons must not exist anymore — if either of
    // these comes back we've silently regressed to the tabbed layout the
    // task explicitly removed.
    await expect(page.getByTestId("tab-pd-visibility")).toHaveCount(0);
    await expect(page.getByTestId("tab-workstream-visibility")).toHaveCount(0);
  });
});

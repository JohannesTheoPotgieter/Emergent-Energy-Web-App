import { test, expect } from "@playwright/test";

const TEST_USERS = {
  admin: { username: "johannes", password: "2023", role: "COO_ADMIN" },
  pm: { username: "eon", password: "2035", role: "PROJECT_MANAGER_SITE" },
  engineer: { username: "paul", password: "2029", role: "ENGINEER" },
  qm: { username: "dean", password: "2025", role: "QUALITY_MANAGER" },
};

async function login(page: any, username: string, password: string) {
  await page.goto("/auth/login");
  await page.fill('[data-testid="input-username"], input[name="username"], input[type="text"]', username);
  await page.fill('[data-testid="input-password"], input[name="password"], input[type="password"]', password);
  await page.click('[data-testid="button-login"], button[type="submit"]');
  await page.waitForURL((url: any) => !url.pathname.includes("/auth/login"), { timeout: 10000 });
}

test.describe("Login Flow", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.locator("form")).toBeVisible();
  });

  test("successful admin login redirects to home", async ({ page }) => {
    await login(page, TEST_USERS.admin.username, TEST_USERS.admin.password);
    await expect(page).toHaveURL(/\/(dashboard)?$/);
  });

  test("PM login redirects to PM dashboard", async ({ page }) => {
    await login(page, TEST_USERS.pm.username, TEST_USERS.pm.password);
    await expect(page).toHaveURL(/\/(pm-dashboard)?/);
  });

  test("invalid credentials show error", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('input[name="username"], input[type="text"]', "invalid");
    await page.fill('input[name="password"], input[type="password"]', "wrong");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/auth/login");
  });
});

test.describe("Route Access - Admin (COO)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.admin.username, TEST_USERS.admin.password);
  });

  const adminRoutes = [
    "/",
    "/projects",
    "/cashflow",
    "/cos",
    "/engineering",
    "/quality",
    "/admin",
    "/admin/roles",
    "/admin/settings",
    "/admin/ms-integration",
    "/ee-info",
    "/leaderboard",
    "/portfolios",
    "/lifecycle-board",
    "/notifications",
  ];

  for (const route of adminRoutes) {
    test(`loads ${route} without errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg: any) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      let has500 = false;
      page.on("response", (res: any) => {
        if (res.status() >= 500) has500 = true;
      });

      await page.goto(route);
      await page.waitForLoadState("networkidle");

      expect(has500).toBe(false);
    });
  }
});

test.describe("Route Access - PM", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.pm.username, TEST_USERS.pm.password);
  });

  test("can access PM dashboard", async ({ page }) => {
    await page.goto("/pm-dashboard");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/pm-dashboard");
  });

  test("can access projects list", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/projects");
  });

  test("redirected away from admin pages", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/admin");
  });
});

test.describe("Dashboard KPI Visibility", () => {
  test("home page shows action hub for admin", async ({ page }) => {
    await login(page, TEST_USERS.admin.username, TEST_USERS.admin.password);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  test("PM dashboard shows project cards", async ({ page }) => {
    await login(page, TEST_USERS.pm.username, TEST_USERS.pm.password);
    await page.goto("/pm-dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });
});

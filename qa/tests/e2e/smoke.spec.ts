import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

type RoleKey = "admin" | "pm" | "engineer" | "qualityManager" | "pd";
type RouteCheckStatus = "pass" | "fail" | "blocked" | "skipped";

interface TestUser {
  username: string;
  password: string;
  appRole: string;
  optional?: boolean;
}

interface RouteExpectation {
  route: string;
  label: string;
  resolveFromProjects?: boolean;
  expectedRedirectFor?: Partial<Record<RoleKey, RegExp>>;
  markers: {
    headingOrAnchor: string[];
    primaryWidgetOrAction: string[];
  };
}

interface RouteCheckResult {
  route: string;
  resolvedRoute: string;
  label: string;
  role: RoleKey;
  status: RouteCheckStatus;
  finalUrl: string;
  pageLoaded: boolean;
  headingOrAnchorFound: boolean;
  primaryWidgetOrActionFound: boolean;
  redirectLoopDetected: boolean;
  has500Response: boolean;
  permissionBlocked: boolean;
  missingMarkers: string[];
  suspiciousIncompleteView: boolean;
  notes: string[];
}

const TEST_USERS: Record<RoleKey, TestUser> = {
  admin: { username: "johannes", password: "2023", appRole: "COO_ADMIN" },
  pm: { username: "eon", password: "2035", appRole: "PROJECT_MANAGER_SITE" },
  engineer: { username: "paul", password: "2029", appRole: "ENGINEER" },
  qualityManager: { username: "dean", password: "2025", appRole: "QUALITY_MANAGER" },
  pd: {
    username: process.env.PD_TEST_USERNAME || "",
    password: process.env.PD_TEST_PASSWORD || "",
    appRole: "PROJECT_DEVELOPER",
    optional: true,
  },
};

const ROUTE_MATRIX: RouteExpectation[] = [
  {
    route: "/",
    label: "Home",
    markers: {
      headingOrAnchor: ["text=/Welcome|Company Priorities|Exception Focus|My Work Preview/i", "[data-testid]"],
      primaryWidgetOrAction: ["a[href='/company-priorities']", "a[href='/my-work/tasks']", "a[href='/my-work']"],
    },
  },
  {
    route: "/projects",
    label: "Projects",
    markers: {
      headingOrAnchor: ["text=/Project|Projects/i", "[data-testid='projects-table'], table"],
      primaryWidgetOrAction: ["input[placeholder*='search' i]", "button:has-text('Filter')", "a[href^='/project/']"],
    },
  },
  {
    route: "/project/:projectName",
    label: "Project Detail",
    resolveFromProjects: true,
    markers: {
      headingOrAnchor: ["text=/Project|Phase|Milestone|Handover/i", "[role='tab']"],
      primaryWidgetOrAction: ["button", "textarea", "input"],
    },
  },
  {
    route: "/engineering",
    label: "Engineering",
    markers: {
      headingOrAnchor: ["text=/Engineering|Standup|Task/i"],
      primaryWidgetOrAction: ["button", "table", "input"],
    },
  },
  {
    route: "/engineering/tasks",
    label: "Engineering Tasks",
    markers: {
      headingOrAnchor: ["text=/Engineering|Task/i"],
      primaryWidgetOrAction: ["button", "[data-testid*='task']", "input", "select"],
    },
  },
  {
    route: "/quality",
    label: "Quality",
    markers: {
      headingOrAnchor: ["text=/Quality|QA|Inspection|Defect/i"],
      primaryWidgetOrAction: ["button", "table", "input"],
    },
  },
  {
    route: "/pm-dashboard",
    label: "PM Dashboard",
    expectedRedirectFor: {
      engineer: /\/(|engineering|my-work)$/,
      qualityManager: /\/(|quality|my-work)$/,
      pd: /\/(|pd|my-work)$/,
    },
    markers: {
      headingOrAnchor: ["text=/PM Dashboard|Project Manager|Portfolio/i"],
      primaryWidgetOrAction: ["button", "a[href*='/project/']", "input"],
    },
  },
  {
    route: "/pd",
    label: "PD Dashboard",
    expectedRedirectFor: {
      pm: /\/(|pm-dashboard|my-work)$/,
      engineer: /\/(|engineering|my-work)$/,
      qualityManager: /\/(|quality|my-work)$/,
    },
    markers: {
      headingOrAnchor: ["text=/PD|Product Development|Ticket/i"],
      primaryWidgetOrAction: ["button", "a[href*='/pd/tickets']", "input"],
    },
  },
  {
    route: "/collaboration",
    label: "Collaboration",
    markers: {
      headingOrAnchor: ["text=/Collaboration|Email|Teams/i"],
      primaryWidgetOrAction: ["button", "a[href*='teams']", "a[href*='email']", "input"],
    },
  },
  {
    route: "/my-work",
    label: "My Work",
    markers: {
      headingOrAnchor: ["text=/My Work|Today/i"],
      primaryWidgetOrAction: ["button", "a[href*='/my-work/tasks']", "input"],
    },
  },
  {
    route: "/portfolios",
    label: "Portfolios",
    markers: {
      headingOrAnchor: ["text=/Portfolio|Portfolios/i"],
      primaryWidgetOrAction: ["button", "a[href*='/portfolio']", "input"],
    },
  },
  {
    route: "/handover-control",
    label: "Handover Control",
    markers: {
      headingOrAnchor: ["text=/Handover|Gate|Review/i"],
      primaryWidgetOrAction: ["button", "table", "input", "a[href*='handover']"],
    },
  },
  {
    route: "/admin",
    label: "Admin Root",
    markers: {
      headingOrAnchor: ["text=/Admin|Control Center|Access Denied/i"],
      primaryWidgetOrAction: ["a[href*='/admin/control-center']", "button", "a:has-text('Back to Home')"],
    },
  },
  {
    route: "/admin/control-center",
    label: "Admin Control Center",
    markers: {
      headingOrAnchor: ["text=/Control Center|Admin/i"],
      primaryWidgetOrAction: ["button", "a[href*='/admin']", "input"],
    },
  },
  {
    route: "/admin/settings",
    label: "Admin Settings",
    markers: {
      headingOrAnchor: ["text=/Settings|Role|Admin|Access Denied/i"],
      primaryWidgetOrAction: ["button", "input", "a:has-text('Back to Home')"],
    },
  },
  {
    route: "/admin/roles",
    label: "Admin Roles",
    markers: {
      headingOrAnchor: ["text=/Role|Roles|Admin|Access Denied/i"],
      primaryWidgetOrAction: ["button", "table", "input", "a:has-text('Back to Home')"],
    },
  },
];

const allResults: RouteCheckResult[] = [];

async function login(page: Page, username: string, password: string) {
  await page.goto("/auth/login");
  await page.fill('[data-testid="input-username"], input[name="username"], input[type="text"]', username);
  await page.fill('[data-testid="input-password"], input[name="password"], input[type="password"]', password);
  await page.click('[data-testid="button-login"], button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 10000 });
}

async function elementExists(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

async function resolveProjectDetailRoute(page: Page): Promise<string | null> {
  await page.goto("/projects", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  const projectLink = page.locator('a[href^="/project/"]').first();
  if (await projectLink.isVisible().catch(() => false)) {
    const href = await projectLink.getAttribute("href");
    return href || null;
  }
  return null;
}

function buildReport() {
  const outDir = path.join(process.cwd(), "qa/reports");
  fs.mkdirSync(outDir, { recursive: true });

  const suspicious = allResults.filter((result) => result.suspiciousIncompleteView);
  const missingRoutes = ROUTE_MATRIX.filter((route) => !allResults.some((r) => r.route === route.route));

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      checks: allResults.length,
      pass: allResults.filter((r) => r.status === "pass").length,
      fail: allResults.filter((r) => r.status === "fail").length,
      blocked: allResults.filter((r) => r.status === "blocked").length,
      skipped: allResults.filter((r) => r.status === "skipped").length,
      routesCovered: Array.from(new Set(allResults.map((r) => r.route))).length,
      rolesCovered: Array.from(new Set(allResults.map((r) => r.role))).length,
    },
    missingRoutes: missingRoutes.map((r) => r.route),
    suspiciousIncompleteViews: suspicious,
    results: allResults,
  };

  const jsonPath = path.join(outDir, "route-smoke-e2e-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  const rows = allResults
    .map((r) => `| ${r.route} | ${r.role} | ${r.status.toUpperCase()} | ${r.missingMarkers.length ? r.missingMarkers.join(", ") : "-"} | ${r.permissionBlocked ? "yes" : "no"} |`)
    .join("\n");

  const suspiciousLines = suspicious.length
    ? suspicious.map((r) => `- ${r.route} (${r.role}): ${r.missingMarkers.join(", ") || "missing stable anchors"}`).join("\n")
    : "- None";

  const markdown = `# Route Smoke E2E Report\n\nGenerated: ${payload.generatedAt}\n\n## Coverage\n- Total checks: ${payload.totals.checks}\n- Routes covered: ${payload.totals.routesCovered}\n- Roles covered: ${payload.totals.rolesCovered}\n- Pass: ${payload.totals.pass}\n- Blocked: ${payload.totals.blocked}\n- Skipped: ${payload.totals.skipped}\n- Fail: ${payload.totals.fail}\n\n## Results\n| Route | Role | Status | Missing expected markers | Blocked by permission |\n|---|---|---|---|---|\n${rows}\n\n## Missing routes\n${payload.missingRoutes.length ? payload.missingRoutes.map((r) => `- ${r}`).join("\\n") : "- None"}\n\n## Suspicious/incomplete views\n${suspiciousLines}\n`;

  const mdPath = path.join(outDir, "route-smoke-e2e-report.md");
  fs.writeFileSync(mdPath, markdown);
}

test.describe("Expanded Route Smoke Coverage", () => {
  for (const [role, user] of Object.entries(TEST_USERS) as [RoleKey, TestUser][]) {
    test.describe(`Role: ${role}`, () => {
      test.skip(user.optional && (!user.username || !user.password), `Optional ${role} credentials not configured`);

      test.beforeEach(async ({ page }) => {
        await login(page, user.username, user.password);
      });

      for (const expectation of ROUTE_MATRIX) {
        test(`${role} route smoke: ${expectation.route}`, async ({ page }) => {
          const responses500: string[] = [];
          const mainFrameNavs: string[] = [];
          page.on("response", (res) => {
            if (res.status() >= 500) responses500.push(`${res.status()} ${res.url()}`);
          });
          page.on("framenavigated", (frame) => {
            if (frame === page.mainFrame()) mainFrameNavs.push(frame.url());
          });

          const notes: string[] = [];
          let targetRoute = expectation.route;
          if (expectation.resolveFromProjects) {
            const resolved = await resolveProjectDetailRoute(page);
            if (!resolved) {
              const skippedResult: RouteCheckResult = {
                route: expectation.route,
                resolvedRoute: expectation.route,
                label: expectation.label,
                role,
                status: "skipped",
                finalUrl: page.url(),
                pageLoaded: false,
                headingOrAnchorFound: false,
                primaryWidgetOrActionFound: false,
                redirectLoopDetected: false,
                has500Response: false,
                permissionBlocked: false,
                missingMarkers: ["project detail route unresolved from /projects"],
                suspiciousIncompleteView: false,
                notes: ["No project link found in list"],
              };
              allResults.push(skippedResult);
              test.skip(true, "No project link available for /project/:projectName");
              return;
            }
            targetRoute = resolved;
          }

          await page.goto(targetRoute, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => notes.push("networkidle timeout"));
          await page.waitForTimeout(500);

          const finalUrl = new URL(page.url()).pathname;
          const permissionBlocked = await page.locator("text=Access Denied").first().isVisible().catch(() => false);

          if (expectation.expectedRedirectFor?.[role]) {
            expect(finalUrl).toMatch(expectation.expectedRedirectFor[role]!);
          }

          const headingOrAnchorFound = await elementExists(page, expectation.markers.headingOrAnchor);
          const primaryWidgetOrActionFound = await elementExists(page, expectation.markers.primaryWidgetOrAction);

          const navSample = mainFrameNavs.slice(-12);
          const navUnique = new Set(navSample.map((u) => {
            try {
              return new URL(u).pathname;
            } catch {
              return u;
            }
          }));
          const redirectLoopDetected = navSample.length >= 8 && navUnique.size <= 2;

          const missingMarkers: string[] = [];
          if (!headingOrAnchorFound) missingMarkers.push("expected heading/anchor missing");
          if (!primaryWidgetOrActionFound) missingMarkers.push("expected primary widget/action missing");
          if (redirectLoopDetected) missingMarkers.push("redirect loop detected");
          if (responses500.length > 0) missingMarkers.push("500 response(s) detected");

          const suspiciousIncompleteView = !permissionBlocked && !headingOrAnchorFound && !primaryWidgetOrActionFound;

          const status: RouteCheckStatus = permissionBlocked
            ? "blocked"
            : missingMarkers.length > 0
              ? "fail"
              : "pass";

          allResults.push({
            route: expectation.route,
            resolvedRoute: targetRoute,
            label: expectation.label,
            role,
            status,
            finalUrl,
            pageLoaded: true,
            headingOrAnchorFound,
            primaryWidgetOrActionFound,
            redirectLoopDetected,
            has500Response: responses500.length > 0,
            permissionBlocked,
            missingMarkers,
            suspiciousIncompleteView,
            notes: [...notes, ...responses500],
          });

          expect(redirectLoopDetected).toBeFalsy();
          expect(responses500.length).toBe(0);
          if (!permissionBlocked) {
            expect(headingOrAnchorFound).toBeTruthy();
            expect(primaryWidgetOrActionFound).toBeTruthy();
          }
        });
      }
    });
  }

  test.afterAll(() => {
    buildReport();
  });
});

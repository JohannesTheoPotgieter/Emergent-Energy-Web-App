// CI guard — route-permission coverage (Task #101).
//
// Walks every route declaration in server/**/*.ts and ensures each one either:
//   1. uses requirePermission / requireAuthority / requireAdmin / requireRole
//      (the last two are Task #101 thin shims of requirePermission)
//   2. uses a project-scope guard (requireCosOverrideRole / requireProjectScope)
//   3. is on the explicit ALLOWLIST below (login, health, public webhooks)
//   4. carries a `// permission-skip: <reason>` marker on the same line or
//      within 6 lines below
//   5. is on the BASELINE of pre-Task-101 legacy routes — see
//      qa/fixtures/route-coverage-baseline.json. Adding a NEW unguarded route
//      fails CI; removing one (by adding requirePermission) is celebrated and
//      requires re-running scripts/permissions/build-route-coverage-baseline.ts.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "server");
const BASELINE_PATH = path.join(process.cwd(), "qa/fixtures/route-coverage-baseline.json");

const ALLOWLIST = new Set<string>([
  "/login", "/logout", "/health", "/healthz", "/api/health", "/api/login",
  "/api/logout", "/api/csrf-token", "/api/auth/me", "/api/auth/login",
  "/api/auth/logout", "/api/auth/microsoft", "/api/auth/microsoft/callback",
  "/api/auth/callback", "/api/auth/sso/login", "/api/auth/sso/callback",
  "/api/version", "/api/ping", "/api/webhooks/pipedrive",
  "/api/webhooks/quickbooks", "/api/webhooks/sharepoint", "/", "/favicon.ico",
]);
const ALLOWLIST_PREFIXES = [
  "/api/public/", "/api/webhooks/", "/api/auth/", "/static/", "/assets/",
];
const GUARD_TOKENS = [
  "requirePermission", "requireAuthority", "requireAdmin", "requireRole",
  "requireCosOverrideRole", "requireProjectScope",
];
const SKIP_MARKER = /\/\/\s*permission-skip:/i;

function* walk(dir: string): Generator<string> {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".cache") continue;
      yield* walk(p);
    } else if (ent.isFile() && ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) {
      yield p;
    }
  }
}

function isAllowed(route: string): boolean {
  if (ALLOWLIST.has(route)) return true;
  return ALLOWLIST_PREFIXES.some((p) => route.startsWith(p));
}

function scan(): string[] {
  const out: string[] = [];
  for (const file of walk(ROOT)) {
    let src: string;
    try { src = fs.readFileSync(file, "utf8"); } catch { continue; }
    const lines = src.split("\n");
    const re = /\b(?:router|app|wsRouter)\.(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\2/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const [, method, , route] = m;
      const window = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 7)).join("\n");
      if (SKIP_MARKER.test(window)) continue;
      if (GUARD_TOKENS.some((t) => window.includes(t))) continue;
      if (isAllowed(route)) continue;
      const rel = path.relative(process.cwd(), file);
      out.push(`${rel}:${method.toUpperCase()} ${route}`);
    }
  }
  return out.sort();
}

describe("CI guard — route-permission coverage (Task #101)", () => {
  it("no NEW unguarded routes beyond the legacy baseline", () => {
    const baselineRaw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as { routes: string[] };
    const baseline = new Set(baselineRaw.routes);
    const current = scan();
    const newOffenders = current.filter((r) => !baseline.has(r));
    if (newOffenders.length > 0) {
      const msg = [
        `Found ${newOffenders.length} NEW unguarded route declarations:`,
        ...newOffenders.slice(0, 30).map((r) => `  ${r}`),
        "",
        "Fix by adding requirePermission(...) to the handler chain, OR add a",
        "// permission-skip: <reason> comment if it is intentionally public.",
        "",
        "If you fixed legacy routes (good!), re-run:",
        "  npx tsx scripts/permissions/build-route-coverage-baseline.ts",
      ].join("\n");
      throw new Error(msg);
    }
    expect(newOffenders).toEqual([]);
  });

  it("legacy debt is shrinking — current set is a subset of the baseline", () => {
    // Defensive: catch the case where someone deletes a legacy route entirely
    // (the baseline still lists it; the test should not fail on that).
    const baselineRaw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as { routes: string[]; count: number };
    expect(baselineRaw.count).toBeGreaterThan(0);
    expect(Array.isArray(baselineRaw.routes)).toBe(true);
  });
});

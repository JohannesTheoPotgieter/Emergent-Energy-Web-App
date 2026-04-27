// Build the route-coverage baseline file used by the CI guard.
//
//   tsx scripts/permissions/build-route-coverage-baseline.ts
//
// Run this when intentionally accepting NEW unguarded routes (rare) or after
// a guard sweep that removes legacy entries. The CI guard fails on any route
// not in this file, so re-running it only when the legacy debt actually
// shrinks is the safe behavior.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "server");
const OUT = path.join(process.cwd(), "qa/fixtures/route-coverage-baseline.json");

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
    const src = fs.readFileSync(file, "utf8");
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

const baseline = scan();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: baseline.length,
  notes: "Legacy routes that pre-date the Task #101 canonical-evaluator gate. Adding NEW entries to this list is forbidden — the CI guard will fail. Removing entries (by adding requirePermission to that route) is welcome and shrinks the legacy debt.",
  routes: baseline,
}, null, 2));
console.log(`Wrote ${baseline.length} baseline entries to ${OUT}`);

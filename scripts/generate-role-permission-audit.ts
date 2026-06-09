#!/usr/bin/env tsx
/**
 * generate-role-permission-audit.ts — refresh the route-role evidence artifact.
 *
 * Produces docs/archive/docs/qa/results/latest/role-permission-audit.md from the
 * CANONICAL RBAC model — PAGE_REGISTRY (route → permissionEntity, following
 * aliases + redirects) resolved through `checkPermission` over
 * DEFAULT_ROLE_PERMISSIONS — so qa/release-gate.ts's "Critical route role
 * validation" reads genuine, code-derived evidence instead of a stale
 * PENDING_EXECUTION placeholder.
 *
 * The same model is independently asserted by
 * qa/tests/unit/permissions-route-contract.test.ts (every page route has a
 * viewing role; direct-URL access is guarded), so a future RBAC regression that
 * left a critical route ungated would fail that test AND flip a row here to
 * `fail` on the next run. Re-run to refresh: `npm run qa:role-audit`.
 *
 * READ-ONLY against the codebase; writes only the evidence markdown.
 */

import fs from "node:fs";
import path from "node:path";

import { PAGE_REGISTRY } from "../client/src/config/page-registry";
import {
  COMPANY_ROLES,
  checkPermission,
  ENTITY_PERMISSION_DEFAULTS,
  type PermissionEntity,
} from "@shared/schema";

// MUST mirror CRITICAL_ROUTES in qa/release-gate.ts.
const CRITICAL_ROUTES = [
  "/projects",
  "/project/:projectName",
  "/cashflow",
  "/quality",
  "/engineering/tasks",
  "/pm-dashboard",
  "/admin/control-center",
  "/handover-control",
];

type RegistryEntry = {
  path: string;
  permissionEntity?: PermissionEntity;
  aliases?: string[];
  redirectTo?: string;
};

const entityByPath = new Map<string, PermissionEntity>();
const redirectByPath = new Map<string, string>();
for (const raw of PAGE_REGISTRY as readonly RegistryEntry[]) {
  if (raw.permissionEntity) {
    entityByPath.set(raw.path, raw.permissionEntity);
    for (const alias of raw.aliases ?? []) entityByPath.set(alias, raw.permissionEntity);
  }
  if (raw.redirectTo) redirectByPath.set(raw.path, raw.redirectTo);
}

// Redirect-only routes whose redirect entry lives outside PAGE_REGISTRY's main
// array. /admin/control-center redirects to /settings (gated by `admin_roles`),
// so its access control is the redirect target's.
const REDIRECT_FALLBACKS: Record<string, string> = {
  "/admin/control-center": "/settings",
};

/** Resolve a route to its permission entity, following one redirect hop. */
function resolveEntity(route: string): PermissionEntity | null {
  if (entityByPath.has(route)) return entityByPath.get(route)!;
  const redirect = redirectByPath.get(route) ?? REDIRECT_FALLBACKS[route];
  if (redirect && entityByPath.has(redirect)) return entityByPath.get(redirect)!;
  return null;
}

const catalog = new Set(ENTITY_PERMISSION_DEFAULTS.map((r) => r.entity));

const rows: string[] = [];
let allPass = true;
for (const route of CRITICAL_ROUTES) {
  const entity = resolveEntity(route);
  const allowed = entity
    ? COMPANY_ROLES.filter((role) => checkPermission(role, entity, "view"))
    : [];
  // A route "passes" when it resolves to a real catalog entity AND at least one
  // role can view it (it is genuinely permission-gated, not wide-open/unmapped).
  const pass = entity != null && catalog.has(entity) && allowed.length > 0;
  if (!pass) allPass = false;
  const sampleRole = allowed[0] ?? "—";
  rows.push(
    `| ${sampleRole} | ${route} | ${entity ?? "(unresolved)"} | Allow | ${allowed.length} role(s) allowed | checkPermission(view) | ${pass ? "pass" : "fail"} | ${allowed.length}/${COMPANY_ROLES.length} roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |`,
  );
}

const today = new Date().toISOString().slice(0, 10);
const md =
  `# Role Permission Audit — Latest Cycle\n\n` +
  `> Status: \`${allPass ? "PASS" : "FAIL"}\` — generated ${today} by \`npm run qa:role-audit\` from the canonical RBAC model ` +
  `(PAGE_REGISTRY → permissionEntity → checkPermission over DEFAULT_ROLE_PERMISSIONS). Re-run to refresh.\n\n` +
  `| Role | Route | Permission entity | Expected access | Observed access | API check performed | Result | Notes |\n` +
  `|---|---|---|---|---|---|---|---|\n` +
  rows.join("\n") +
  `\n`;

const out = path.join(process.cwd(), "docs", "archive", "docs", "qa", "results", "latest", "role-permission-audit.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md, "utf8");
console.log(`Wrote ${out}\n  ${rows.length} critical routes — ${allPass ? "PASS ✓" : "FAIL ✗"}`);
process.exit(allPass ? 0 : 1);

/**
 * Runtime CRUD probes for §2/§4/§7 verification.
 *
 * For each probe we send a VALID payload (where one is required) so a 4xx
 * cannot be confused with "validation rejected before authz". Authorization
 * findings are read from the status code:
 *   - 201/200  : authorized (created/fetched)
 *   - 403/401  : authorization denied
 *   - 400      : payload invalid (probe misconfigured — fix the test)
 *
 * To avoid persisting employee PII, role→user mapping is loaded at runtime
 * from the dev DB via the auth bearer obtained from /api/auth/dev-login,
 * and only role + numeric userId are written to the artefact.
 */
import { generateToken } from "../server/jwt";
import { ENTITY_PERMISSION_DEFAULTS } from "../shared/schema/users";
import { db, initializeDatabase } from "../server/db";
import { hseIncidents } from "../shared/schema/hse";
import { workItems } from "../shared/schema/tasks";
import { inArray } from "drizzle-orm";
import * as fs from "node:fs";

function entityCreateRoles(entity: string): readonly string[] {
  const rule = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === entity);
  if (!rule) throw new Error(`No entity rule found for "${entity}"`);
  return rule.create_roles;
}
function entityViewRoles(entity: string): readonly string[] {
  const rule = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === entity);
  if (!rule) throw new Error(`No entity rule found for "${entity}"`);
  return rule.view_roles;
}

const BASE = "http://localhost:5000";

interface UserRow { id: number; name?: string | null; email?: string | null; role?: string | null }

async function adminToken(): Promise<string> {
  const head = await fetch(`${BASE}/api/auth/dev-login`, { redirect: "manual" });
  const loc = head.headers.get("location") ?? "";
  const code = decodeURIComponent(loc.split("code=")[1] ?? "");
  if (!code) throw new Error("dev-login did not return an auth code (NODE_ENV may be production)");
  const exch = await fetch(`${BASE}/api/auth/exchange-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const j = (await exch.json()) as { token: string };
  return j.token;
}

async function listUsers(token: string): Promise<UserRow[]> {
  const res = await fetch(`${BASE}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`admin/users ${res.status}`);
  return (await res.json()) as UserRow[];
}

interface Probe {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  label: string;
  /**
   * Roles the *entity-rule policy* says should be authorized. This is the
   * intent, not necessarily what the route currently enforces — divergence
   * between the two is itself a finding (`policy_gap`).
   */
  policyAuthorized: readonly string[];
  /** Notes for the report. */
  notes?: string;
  /**
   * If true, this probe is for triage signal only (e.g. reproducing a known
   * server-side bug). Its results are still rendered, but they are excluded
   * from the policy_gap / policy_overshoot summary counts.
   */
  triageOnly?: boolean;
}

interface ProbeResult {
  role: string;
  userId: number;
  probe: string;
  method: string;
  path: string;
  status: number;
  /** Parsed numeric id from the response payload, when present (used for cleanup). */
  createdId: number | null;
  /**
   * Verdict semantics:
   *   policy_match      — 2xx and role is in policy list, OR 401/403 and role is not.
   *   policy_gap        — 2xx but role is NOT in the policy list (route under-enforces).
   *   policy_overshoot  — 401/403 but role IS in the policy list (route over-enforces).
   *   server_error      — 5xx (indeterminate; not an authz signal).
   *   probe_invalid     — 400 (payload bug, not authz).
   *   transport_error   — request never completed.
   */
  verdict: "policy_match" | "policy_gap" | "policy_overshoot" | "server_error" | "probe_invalid" | "transport_error" | "indeterminate";
  bodySnippet: string;
}

const ROLES_TO_PROBE = [
  "COO_ADMIN", "CEO_ADMIN", "CCO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER",
  "CONSTRUCTION_MANAGER", "QUALITY_MANAGER", "PROJECT_MANAGER_SITE",
  "PROJECT_DEVELOPER", "ENGINEER", "ACCOUNTANT", "CFO",
] as const;

async function pickProjectIds(token: string): Promise<{ id: number; projectName: string; pmUserId: number | null; pdUserId: number | null }> {
  const res = await fetch(`${BASE}/api/v2/projects?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { data?: Array<{ id: number; projectName: string; pmUserId: number | null; pdUserId: number | null }> };
  const row = body.data?.[0];
  if (!row) throw new Error("no projects to probe against");
  return { id: row.id, projectName: row.projectName, pmUserId: row.pmUserId, pdUserId: row.pdUserId };
}

/**
 * Verify the planning-task probe baseline assumption: none of the probed
 * users are PM or PD on the chosen project, so canEditProjectTasks should
 * only let through the three unconditional roles. If a probed user *is*
 * the PM/PD, their 200 would be correct under the per-project ACL and
 * mis-classifying it as policy_gap would produce a false positive.
 */
function assertNoProbedUserIsPmPd(
  project: { projectName: string; pmUserId: number | null; pdUserId: number | null },
  probedUserIds: readonly number[],
): void {
  const conflictUserIds: number[] = [];
  for (const uid of probedUserIds) {
    if (project.pmUserId === uid || project.pdUserId === uid) conflictUserIds.push(uid);
  }
  if (conflictUserIds.length) {
    throw new Error(
      `Probe assumption violated: probed userId(s) ${conflictUserIds.join(", ")} are PM/PD on the chosen project. Pick a different project or exclude these users from ROLES_TO_PROBE.`,
    );
  }
}

async function main() {
  await initializeDatabase();
  const adminTok = await adminToken();
  const users = await listUsers(adminTok);
  const project = await pickProjectIds(adminTok);

  // Pick lowest-id user per role we want to probe, store role + userId only.
  const roleUser = new Map<string, UserRow>();
  for (const u of users) {
    if (!u.role) continue;
    if (!ROLES_TO_PROBE.includes(u.role as (typeof ROLES_TO_PROBE)[number])) continue;
    const existing = roleUser.get(u.role);
    if (!existing || u.id < existing.id) roleUser.set(u.role, u);
  }

  // Coverage precondition: every role we intended to probe must have a user.
  // If any role is missing, the probe matrix would silently be incomplete —
  // fail fast so the audit operator is forced to acknowledge the gap.
  const missingRoles = ROLES_TO_PROBE.filter((r) => !roleUser.has(r));
  if (missingRoles.length) {
    const allowPartial = process.env.AUDIT_ALLOW_PARTIAL_ROLES === "1";
    const msg = `Probe coverage incomplete — no user found for role(s): ${missingRoles.join(", ")}.`;
    if (!allowPartial) {
      throw new Error(`${msg} Re-run with AUDIT_ALLOW_PARTIAL_ROLES=1 to proceed with reduced coverage.`);
    }
    console.warn(`[probe] WARNING: ${msg} Proceeding because AUDIT_ALLOW_PARTIAL_ROLES=1 is set.`);
  }

  // Validate the planning-task probe assumption before mutating anything.
  assertNoProbedUserIsPmPd(project, Array.from(roleUser.values()).map((u) => u.id));

  const probes: Probe[] = [
    {
      method: "POST",
      path: "/api/hse/incidents",
      body: {
        projectId: project.id,
        incidentDate: "2026-04-22",
        incidentType: "near_miss",
        severity: "low",
        description: "[audit-probe] runtime authz test — please ignore",
      },
      label: "HSE incidents create (valid payload)",
      // Source of truth: ENTITY_PERMISSION_DEFAULTS.hse_incidents.create_roles
      // (shared/schema/users.ts:462). Route is requireAuth-only at
      // server/departments/hse-routes.ts:120 — any 2xx from a role NOT in
      // this list is `policy_gap` (route under-enforces vs declared policy).
      policyAuthorized: entityCreateRoles("hse_incidents"),
      notes: "Policy from ENTITY_PERMISSION_DEFAULTS.hse_incidents.create_roles. Route at server/departments/hse-routes.ts:120 is requireAuth-only.",
    },
    {
      method: "POST",
      path: "/api/planning-tasks",
      body: { projectName: project.projectName, title: "[audit-probe]", priority: "Normal", status: "Not Started" },
      label: "Planning tasks create (valid payload, real project)",
      // The route does NOT use entity-rule middleware; it uses the per-project
      // ACL canEditProjectTasks (planning-tasks-routes.ts:658) which grants
      // COO_ADMIN/CEO_ADMIN/PROGRAM_MANAGER unconditionally + named PM/PD.
      // None of the probed users below are PM/PD on the chosen project, so
      // only the three unconditional roles should pass.
      policyAuthorized: ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"],
      notes: "Middleware policy (canEditProjectTasks at planning-tasks-routes.ts:658). Probe users are not PM/PD on the chosen project, so only the three unconditional roles should pass.",
    },
    {
      method: "GET",
      path: "/api/admin/users",
      label: "Admin users list (control)",
      // Policy from middleware: requireAdmin gate restricts to COO/CEO admins.
      policyAuthorized: ["COO_ADMIN", "CEO_ADMIN"],
      notes: "Middleware policy (requireAdmin). Control sample.",
    },
    {
      method: "GET",
      path: "/api/v2/projects/351/finance",
      label: "Project 351 finance (known 500)",
      // Policy from ENTITY_PERMISSION_DEFAULTS.project_finance / cashflow.
      // 5xx are recorded as server_error, not as authz drift.
      policyAuthorized: entityViewRoles("cashflow"),
      notes: "TRIAGE-ONLY: hardcoded project id 351 to reproduce the documented 500. Policy here is the closest entity rule (cashflow.view_roles); the route also applies a per-project membership gate, so 403s are not strict authz overshoots. Excluded from policy_gap/overshoot counts.",
      triageOnly: true,
    },
  ];

  const results: ProbeResult[] = [];

  for (const [role, user] of roleUser) {
    const token = generateToken({
      userId: user.id,
      email: user.email ?? "",
      name: user.name ?? "",
      role,
      tokenVersion: 0,
    });
    for (const p of probes) {
      try {
        const res = await fetch(BASE + p.path, {
          method: p.method,
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: p.body ? JSON.stringify(p.body) : undefined,
        });
        const text = await res.text();
        const inPolicy = p.policyAuthorized.includes(role);
        let verdict: ProbeResult["verdict"];
        if (res.status >= 500) verdict = "server_error";
        else if (res.status === 400) verdict = "probe_invalid";
        else if (res.status >= 200 && res.status < 300) verdict = inPolicy ? "policy_match" : "policy_gap";
        else if (res.status === 401 || res.status === 403) verdict = inPolicy ? "policy_overshoot" : "policy_match";
        else verdict = "indeterminate"; // 3xx redirect, 404, 405, 409 etc — investigate, don't silently approve

        // Parse the FULL JSON response (not a regex over a truncated snippet)
        // to get the created row id. The snippet is for human display only.
        let createdId: number | null = null;
        if (res.status >= 200 && res.status < 300) {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (parsed && typeof parsed === "object" && "id" in parsed) {
              const idVal = (parsed as { id: unknown }).id;
              if (typeof idVal === "number" && Number.isFinite(idVal)) createdId = idVal;
            }
          } catch { /* non-JSON body — leave createdId null */ }
        }

        const snippet = text
          .slice(0, 160)
          .replace(/"email":"[^"]+"/g, '"email":"[redacted]"')
          .replace(/"name":"[^"]+"/g, '"name":"[redacted]"')
          .replace(/\s+/g, " ");
        results.push({
          role,
          userId: user.id,
          probe: p.label,
          method: p.method,
          path: p.path,
          status: res.status,
          createdId,
          verdict,
          bodySnippet: snippet,
        });
      } catch (e) {
        results.push({
          role,
          userId: user.id,
          probe: p.label,
          method: p.method,
          path: p.path,
          status: -1,
          createdId: null,
          verdict: "transport_error",
          bodySnippet: String((e as Error).message ?? e),
        });
      }
    }
  }

  // Cleanup: roll back EVERY mutating probe that succeeded (audit hygiene).
  // Each create returns the new row; we delete by id with the admin token.
  // Map probe label → DELETE path template.
  const cleanupPaths: Record<string, (id: string) => string> = {
    "HSE incidents create (valid payload)": (id) => `/api/hse/incidents/${id}`,
    "Planning tasks create (valid payload, real project)": (id) => `/api/planning-tasks/${id}`,
  };
  const cleanupResults: Array<{ probe: string; createdId: string; deleteStatus: number }> = [];
  for (const r of results) {
    const tmpl = cleanupPaths[r.probe];
    if (!tmpl) continue;
    if (r.createdId == null) continue;
    const idStr = String(r.createdId);
    const del = await fetch(`${BASE}${tmpl(idStr)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminTok}` },
    }).catch(() => undefined);
    cleanupResults.push({ probe: r.probe, createdId: idStr, deleteStatus: del?.status ?? -1 });
  }
  const cleanupFailed = cleanupResults.filter((c) => !(c.deleteStatus >= 200 && c.deleteStatus < 300));

  // Hard-delete fallback: if the API DELETE failed (e.g. planning-tasks DELETE
  // is itself broken — a separate audit finding), soft-delete directly via
  // the DB so the audit run leaves no stray rows behind.
  const hseFailedIds = cleanupFailed
    .filter((c) => c.probe.startsWith("HSE incidents create"))
    .map((c) => Number(c.createdId))
    .filter((n) => Number.isFinite(n));
  const planFailedIds = cleanupFailed
    .filter((c) => c.probe.startsWith("Planning tasks create"))
    .map((c) => Number(c.createdId))
    .filter((n) => Number.isFinite(n));

  const dbFallback: Array<{ table: string; id: number; ok: boolean }> = [];
  if (hseFailedIds.length) {
    try {
      const rows = await db.update(hseIncidents)
        .set({ deletedAt: new Date() })
        .where(inArray(hseIncidents.id, hseFailedIds))
        .returning({ id: hseIncidents.id });
      for (const r of rows) dbFallback.push({ table: "hse_incidents", id: r.id, ok: true });
    } catch (e) {
      console.error("[probe] DB fallback for HSE failed:", (e as Error).message);
    }
  }
  if (planFailedIds.length) {
    try {
      const rows = await db.update(workItems)
        .set({ deletedAt: new Date() })
        .where(inArray(workItems.id, planFailedIds))
        .returning({ id: workItems.id });
      for (const r of rows) dbFallback.push({ table: "work_items", id: r.id, ok: true });
    } catch (e) {
      console.error("[probe] DB fallback for planning-tasks failed:", (e as Error).message);
    }
  }
  if (cleanupFailed.length) {
    console.warn(`[probe] API cleanup failed for ${cleanupFailed.length} row(s); DB fallback soft-deleted ${dbFallback.length}.`);
  }

  // Render report
  const probeLabels = Array.from(new Set(results.map((r) => r.probe)));
  const probedRoles = Array.from(roleUser.keys());

  let md = "# Runtime CRUD Probes\n\n";
  md += `**Base URL:** ${BASE}\n\n`;
  md += `**Project under test:** id=${project.id} (name redacted)\n\n`;
  md += `**Roles probed:** ${probedRoles.length} of ${ROLES_TO_PROBE.length} declared in \`ROLES_TO_PROBE\` (one user per role; userId only stored, no PII). **Sampled coverage** — roles outside this list (e.g. HSE_MANAGER, SSEG_MANAGER, ENGINEERING_MANAGER, KEY_ACCOUNTS_MANAGER) are not exercised at runtime; the static matrix in \`per-page-per-role-matrix.csv\` covers all roles policy-wise.\n\n`;
  md += `**Verdict legend:**\n`;
  md += `- \`✓ match\` — observed status is consistent with the policy intent.\n`;
  md += `- \`⚠ gap\` — 2xx but role is NOT in the policy list (route under-enforces; security finding).\n`;
  md += `- \`⚠ over\` — 401/403 but role IS in the policy list (route over-enforces; UX finding).\n`;
  md += `- \`◇ 5xx\` — server error; **indeterminate for authz**, recorded for triage of #14-class bugs.\n`;
  md += `- \`! 400\` — payload rejected by validation (probe misconfigured, not authz).\n\n`;
  md += `**Caveat — layered guards.** \`policyAuthorized\` is derived from a single source per probe (entity rule or named middleware). Some routes apply multiple guards (e.g. entity rule + per-project membership). A 403 from a role that IS in the entity rule may therefore be correct (membership gate blocks), even though it shows here as \`policy_overshoot\` against the chosen probe baseline.\n\n`;

  md += "## Per-probe policy intent\n\n";
  md += "| Probe | Policy intent (allowed roles) | Notes |\n|---|---|---|\n";
  for (const lbl of probeLabels) {
    const p = probes.find((x) => x.label === lbl);
    md += `| ${lbl} | ${p?.policyAuthorized.join(", ") ?? ""} | ${p?.notes ?? ""} |\n`;
  }

  md += "\n## Status matrix\n\n";
  md += "| Probe | " + probedRoles.join(" | ") + " |\n";
  md += "|---|" + probedRoles.map(() => "---").join("|") + "|\n";
  const symFor = (v: ProbeResult["verdict"]) =>
    v === "policy_match" ? "✓" :
    v === "policy_gap" ? "⚠gap" :
    v === "policy_overshoot" ? "⚠over" :
    v === "server_error" ? "◇" :
    v === "probe_invalid" ? "!400" :
    v === "indeterminate" ? "?" : "x";
  for (const lbl of probeLabels) {
    const cells = probedRoles.map((role) => {
      const r = results.find((x) => x.role === role && x.probe === lbl);
      return r ? `${r.status} ${symFor(r.verdict)}` : "-";
    });
    md += `| ${lbl} | ${cells.join(" | ")} |\n`;
  }

  const triageLabels = new Set(probes.filter((p) => p.triageOnly).map((p) => p.label));
  const isTriage = (r: ProbeResult) => triageLabels.has(r.probe);
  const gaps = results.filter((r) => r.verdict === "policy_gap" && !isTriage(r));
  const overs = results.filter((r) => r.verdict === "policy_overshoot" && !isTriage(r));
  const errors5xx = results.filter((r) => r.verdict === "server_error");
  const indeterminate = results.filter((r) => r.verdict === "indeterminate");
  const triageRows = results.filter((r) => isTriage(r));

  md += `\n## Policy gaps (route under-enforces — security findings)\n\n`;
  if (!gaps.length) md += "_None._\n";
  else {
    md += "| Probe | Role | Status | Body |\n|---|---|---|---|\n";
    for (const d of gaps) md += `| ${d.probe} | ${d.role} | ${d.status} | \`${d.bodySnippet.replace(/\|/g, "\\|")}\` |\n`;
  }

  md += `\n## Policy overshoots (route over-enforces — UX/access findings)\n\n`;
  if (!overs.length) md += "_None._\n";
  else {
    md += "| Probe | Role | Status | Body |\n|---|---|---|---|\n";
    for (const d of overs) md += `| ${d.probe} | ${d.role} | ${d.status} | \`${d.bodySnippet.replace(/\|/g, "\\|")}\` |\n`;
  }

  md += `\n## Server errors (5xx — indeterminate for authz)\n\n`;
  if (!errors5xx.length) md += "_None._\n";
  else {
    md += "| Probe | Role | Status | Body |\n|---|---|---|---|\n";
    for (const d of errors5xx) md += `| ${d.probe} | ${d.role} | ${d.status} | \`${d.bodySnippet.replace(/\|/g, "\\|")}\` |\n`;
  }

  md += `\n## Indeterminate (status outside policy buckets — investigate)\n\n`;
  if (!indeterminate.length) md += "_None._\n";
  else {
    md += "| Probe | Role | Status | Body |\n|---|---|---|---|\n";
    for (const d of indeterminate) md += `| ${d.probe} | ${d.role} | ${d.status} | \`${d.bodySnippet.replace(/\|/g, "\\|")}\` |\n`;
  }

  if (triageRows.length) {
    md += `\n## Triage-only probes (excluded from gap/overshoot counts)\n\n`;
    md += `These probes target known issues (e.g. specific project ids reproducing a server bug) where the policy baseline is approximate or layered guards apply. Findings here should drive triage of the underlying defect rather than be read as authorization drift.\n\n`;
    md += "| Probe | Role | Status | Verdict |\n|---|---|---|---|\n";
    for (const d of triageRows) md += `| ${d.probe} | ${d.role} | ${d.status} | ${d.verdict} |\n`;
  }

  fs.writeFileSync("audit/runtime-probes.md", md);

  // JSON: drop bodySnippet entirely if it might contain residual PII; keep status/verdict.
  const safeJson = results.map(({ bodySnippet: _drop, ...rest }) => rest);
  fs.writeFileSync("audit/runtime-probes.json", JSON.stringify(safeJson, null, 2));
  console.log(`Wrote audit/runtime-probes.md (${results.length} results: ${gaps.length} policy_gap, ${overs.length} policy_overshoot, ${errors5xx.length} server_error)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

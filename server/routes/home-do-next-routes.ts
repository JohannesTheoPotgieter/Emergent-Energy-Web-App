/**
 * Home "Do Next" routes.
 *
 * Centralised, role-aware ranking of actionable items for the redesigned home
 * page. One endpoint, one ranking model — so the same logic can later feed
 * mobile, email digests, etc.
 *
 *   GET    /api/home/do-next                 → ranked, snooze-aware items
 *   POST   /api/home/do-next/:itemKey/snooze → snooze a chip until a date
 *   POST   /api/home/do-next/:itemKey/dismiss→ dismiss a chip permanently
 *   DELETE /api/home/do-next/:itemKey        → clear snooze / dismiss
 */

import type { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "../auth-context";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { doNextState, type DoNextItem, type DoNextKind } from "@shared/schema/home";
import { normalizeRoleForPermissions } from "@shared/schema/users";

// ---------- Ranking weights per item kind ----------
const KIND_WEIGHT: Record<DoNextKind, number> = {
  approval: 90,
  rag: 85,
  hse_incident: 95,
  qb_sync_failed: 80,
  import_drift: 75,
  blocked_priority: 70,
  escalated_priority: 68,
  overdue_task: 65,
  behind_plan: 60,
  eng_blocker: 55,
  quality_issue: 50,
};

// Roles authorised to see "unassigned" approvals (i.e. anything not yet routed
// to a specific approver). Keeping this tight prevents data overexposure.
const APPROVAL_TRIAGE_ROLES = new Set([
  "COO_ADMIN", "CEO_ADMIN", "CFO", "CCO",
  "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER",
]);

// Roles that should see each kind. Anything not listed defaults to "all".
const KIND_VISIBILITY: Partial<Record<DoNextKind, string[]>> = {
  qb_sync_failed: ["COO_ADMIN", "CEO_ADMIN", "CFO", "PROGRAM_FINANCE_MANAGER", "ACCOUNTANT"],
  import_drift: ["COO_ADMIN", "CEO_ADMIN", "CFO", "PROGRAM_FINANCE_MANAGER", "ACCOUNTANT", "PROGRAM_MANAGER"],
  blocked_priority: ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER"],
  hse_incident: ["COO_ADMIN", "CEO_ADMIN", "HSE_MANAGER", "CONSTRUCTION_MANAGER", "PROGRAM_MANAGER", "PROJECT_MANAGER_SITE"],
  eng_blocker: ["COO_ADMIN", "CEO_ADMIN", "ENGINEERING_MANAGER", "ENGINEER", "PROGRAM_MANAGER", "SSEG_MANAGER"],
  quality_issue: ["COO_ADMIN", "CEO_ADMIN", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER", "PROGRAM_MANAGER", "PROJECT_MANAGER_SITE"],
};

function isVisibleForRole(kind: DoNextKind, role: string): boolean {
  const allow = KIND_VISIBILITY[kind];
  return !allow || allow.includes(role);
}

function ageHours(since: string | null | undefined): number {
  if (!since) return 0;
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function severityBoost(sev: DoNextItem["severity"]): number {
  return sev === "high" ? 20 : sev === "medium" ? 8 : 0;
}

function computeScore(kind: DoNextKind, severity: DoNextItem["severity"], since?: string | null): number {
  // Base + severity + a gentle log-style age boost (capped at +25 for ~1 month old).
  const base = KIND_WEIGHT[kind] ?? 40;
  const age = Math.min(25, Math.log1p(ageHours(since)) * 4);
  return base + severityBoost(severity) + age;
}

// ---------- Source builders ----------
//
// Each builder returns an array of DoNextItem. They wrap calls to existing
// data so the ranking endpoint stays in one file. Errors in a single source
// are logged and skipped — they must never take down the whole strip.

async function buildApprovalItems(req: Request, role: string): Promise<DoNextItem[]> {
  if (!isVisibleForRole("approval", role)) return [];
  const userId = Number((req as any).user?.id);
  // Default: only show approvals routed TO this user. Triage roles also get
  // visibility into pending-but-unassigned approvals so they can route them.
  // This prevents data overexposure of approval titles/projects to non-triage users.
  const includeUnassigned = APPROVAL_TRIAGE_ROLES.has(role);
  try {
    const rows: any[] = await db.execute(sql`
      SELECT a.id,
             a.title,
             a.urgency,
             a.requested_at,
             p.project_name
      FROM approvals a
      LEFT JOIN project_info p ON p.id = a.project_id
      WHERE a.status = 'pending'
        AND a.deleted_at IS NULL
        AND (
          a.assigned_approver = ${userId}
          ${includeUnassigned ? sql`OR a.assigned_approver IS NULL` : sql``}
        )
      ORDER BY a.requested_at ASC
      LIMIT 25
    `).then((r: any) => r.rows ?? r ?? []);

    return rows.map((r: any): DoNextItem => {
      const u = String(r.urgency || "normal").toLowerCase();
      const sev: DoNextItem["severity"] =
        u === "critical" || u === "high" ? "high" :
        u === "low" ? "low" : "medium";
      const since = r.requested_at ? new Date(r.requested_at).toISOString() : null;
      return {
        key: `approval:${r.id}`,
        kind: "approval",
        title: r.title || `Review approval #${r.id}`,
        subtitle: r.project_name || null,
        severity: sev,
        score: computeScore("approval", sev, since),
        href: `/pm/approvals?focus=${encodeURIComponent(String(r.id))}`,
        since,
      };
    });
  } catch (err) {
    console.warn("[do-next] approvals source failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function buildRagItems(_req: Request, role: string): Promise<DoNextItem[]> {
  if (!isVisibleForRole("rag", role)) return [];
  try {
    // RAG status lives on project_execution_state, not project_info.
    // Effective RAG = stored rag_status, BUT if project_info.in_dlp = true
    // (project is in the Defect Liability Period during a handover phase),
    // it is forced to 'red' with reason 'In DLP'. Handover phases are the
    // only ones where in_dlp is meaningful per the canonical lifecycle in
    // shared/phases.ts; the column default false ensures pre-handover
    // projects never accidentally trip this rule.
    const rows: any[] = await db.execute(sql`
      SELECT
        p.project_name, p.pm, p.pd, p.in_dlp,
        e.rag_status, e.rag_updated_at,
        CASE WHEN p.in_dlp THEN 'In DLP' ELSE NULL END AS dlp_reason
      FROM project_execution_state e
      JOIN project_info p ON p.id = e.project_id
      WHERE (e.rag_status = 'red' OR p.in_dlp = true)
        AND p.deleted_at IS NULL
      ORDER BY p.in_dlp DESC, e.rag_updated_at DESC NULLS LAST
      LIMIT 15
    `).then((r: any) => r.rows ?? r ?? []);

    return rows.map((r: any): DoNextItem => ({
      key: `rag:red:${r.project_name}`,
      kind: "rag",
      title: r.in_dlp
        ? `Red RAG · ${r.project_name} · In DLP`
        : `Red RAG · ${r.project_name}`,
      subtitle: r.pm || r.pd || null,
      severity: "high",
      score: computeScore("rag", "high", r.rag_updated_at),
      href: `/project/${encodeURIComponent(r.project_name)}`,
    }));
  } catch (err) {
    console.warn("[do-next] rag source failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function buildOverdueTaskItems(req: Request, _role: string): Promise<DoNextItem[]> {
  const userId = Number((req as any).user?.id);
  if (!userId) return [];
  try {
    // work_items.end_date is text — cast for the comparison. owner_user_id is the assignee.
    const rows: any[] = await db.execute(sql`
      SELECT w.id, w.title, w.end_date, p.project_name
      FROM work_items w
      LEFT JOIN project_info p ON p.id = w.project_id
      WHERE w.owner_user_id = ${userId}
        AND w.deleted_at IS NULL
        AND w.status NOT IN ('complete', 'done', 'closed', 'cancelled')
        AND w.end_date IS NOT NULL
        AND w.end_date <> ''
        -- Strict ISO date prefix + a defensive try_cast: skip rows whose text
        -- value isn't a real calendar date so the source never throws.
        AND w.end_date ~ '^\d{4}-\d{2}-\d{2}$'
        AND (
          SELECT (substring(w.end_date FROM 1 FOR 10))::date < CURRENT_DATE
          WHERE substring(w.end_date FROM 1 FOR 10) ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        ) IS TRUE
      ORDER BY w.end_date ASC
      LIMIT 15
    `).then((r: any) => r.rows ?? r ?? []);

    return rows.map((r: any): DoNextItem => {
      const since = r.end_date ? new Date(r.end_date).toISOString() : null;
      return {
        key: `task:overdue:${r.id}`,
        kind: "overdue_task",
        title: r.title || `Task #${r.id}`,
        subtitle: r.project_name || null,
        severity: "high",
        score: computeScore("overdue_task", "high", since),
        href: `/my-work/tasks?focus=${encodeURIComponent(String(r.id))}`,
        since,
      };
    });
  } catch (err) {
    console.warn("[do-next] overdue tasks source failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function buildBlockedPriorityItems(_req: Request, role: string): Promise<DoNextItem[]> {
  if (!isVisibleForRole("blocked_priority", role)) return [];
  try {
    // Priorities live in mytool_company_priorities. Status enum doesn't include
    // 'blocked'; we treat severity=critical OR status=monitoring as needing attention.
    const rows: any[] = await db.execute(sql`
      SELECT id, title, status, severity
      FROM mytool_company_priorities
      WHERE (severity = 'critical' OR status = 'monitoring')
        AND status NOT IN ('closed', 'complete')
      ORDER BY (severity = 'critical') DESC, updated_at DESC
      LIMIT 10
    `).then((r: any) => r.rows ?? r ?? []);

    return rows.map((r: any): DoNextItem => {
      const sev: DoNextItem["severity"] = r.severity === "critical" ? "high" : "medium";
      return {
        key: `priority:blocked:${r.id}`,
        kind: "blocked_priority",
        title: `Priority needs attention · ${r.title}`,
        subtitle: r.status,
        severity: sev,
        score: computeScore("blocked_priority", sev),
        href: `/priorities?focus=${encodeURIComponent(String(r.id))}`,
      };
    });
  } catch (err) {
    console.warn("[do-next] priorities source failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function buildEscalatedPriorityItems(req: Request, role: string): Promise<DoNextItem[]> {
  const userId = Number((req as any).user?.id);
  if (!userId) return [];
  // Show escalation events that happened in the last 7 days where:
  // - the escalation target is this user's scope (dept head / company lead), OR
  // - this user is the priority owner who needs to follow up
  const ESCALATION_ROLES = new Set([
    "COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER",
    "ENGINEERING_MANAGER", "QUALITY_MANAGER", "HSE_MANAGER", "SSEG_MANAGER",
    "CONSTRUCTION_MANAGER", "PROGRAM_FINANCE_MANAGER",
  ]);
  if (!ESCALATION_ROLES.has(role)) return [];
  try {
    const rows: any[] = await db.execute(sql`
      SELECT
        pa.id,
        pa.priority_id,
        pa.actor_name,
        pa.to_value,
        pa.details,
        pa.created_at,
        p.title AS priority_title,
        p.scope AS priority_scope
      FROM priority_activity pa
      JOIN mytool_company_priorities p ON p.id = pa.priority_id
      WHERE pa.action = 'escalated'
        AND pa.created_at >= NOW() - INTERVAL '7 days'
        AND p.status NOT IN ('closed', 'complete')
      ORDER BY pa.created_at DESC
      LIMIT 8
    `).then((r: any) => r.rows ?? r ?? []);

    return rows.map((r: any): DoNextItem => {
      const reason = (r.details as any)?.reason || r.to_value || "";
      const sev: DoNextItem["severity"] =
        reason === "critical" || reason === "blocked" ? "high" : "medium";
      const since = r.created_at ? new Date(r.created_at).toISOString() : null;
      return {
        key: `escalated:${r.id}`,
        kind: "escalated_priority",
        title: `Escalated · ${r.priority_title || `Priority #${r.priority_id}`}`,
        subtitle: r.actor_name ? `by ${r.actor_name}` : null,
        severity: sev,
        score: computeScore("escalated_priority", sev, since),
        href: `/priorities/${r.priority_id}`,
        since,
      };
    });
  } catch (err) {
    console.warn("[do-next] escalated priorities source failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ---------- Snooze state helpers ----------

interface SnoozeRow {
  item_key: string;
  snoozed_until: Date | null;
  dismissed_at: Date | null;
}

async function loadActiveState(userId: number): Promise<Map<string, SnoozeRow>> {
  const map = new Map<string, SnoozeRow>();
  try {
    const rows: any[] = await db.execute(sql`
      SELECT item_key, snoozed_until, dismissed_at
      FROM do_next_state
      WHERE user_id = ${userId}
    `).then((r: any) => r.rows ?? r ?? []);
    for (const r of rows) map.set(r.item_key, r);
  } catch (err) {
    console.warn("[do-next] state load failed:", err instanceof Error ? err.message : err);
  }
  return map;
}

function applyState(items: DoNextItem[], state: Map<string, SnoozeRow>): DoNextItem[] {
  const now = Date.now();
  const out: DoNextItem[] = [];
  for (const item of items) {
    const s = state.get(item.key);
    if (!s) {
      out.push(item);
      continue;
    }
    if (s.dismissed_at) continue;
    if (s.snoozed_until && new Date(s.snoozed_until).getTime() > now) continue;
    out.push({
      ...item,
      snoozedUntil: s.snoozed_until ? new Date(s.snoozed_until).toISOString() : null,
    });
  }
  return out;
}

// ---------- Route registration ----------

export function registerHomeDoNextRoutes(app: Express) {
  app.get("/api/home/do-next", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    const userId = Number((req as any).user?.id);
    // SECURITY: derive role from the authenticated session ONLY. The
    // `x-company-role` header is used elsewhere as a UI role-simulator and
    // would otherwise let any client widen their own visibility here.
    const sessionRole = (req as any).user?.role || "";
    const role = normalizeRoleForPermissions(sessionRole) || sessionRole;

    if (!userId) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    try {
      const [approvals, rags, overdue, blockedPriorities, escalated, state] = await Promise.all([
        buildApprovalItems(req, role),
        buildRagItems(req, role),
        buildOverdueTaskItems(req, role),
        buildBlockedPriorityItems(req, role),
        buildEscalatedPriorityItems(req, role),
        loadActiveState(userId),
      ]);

      const all = [...approvals, ...rags, ...overdue, ...blockedPriorities, ...escalated];
      const visible = applyState(all, state);
      visible.sort((a, b) => b.score - a.score);

      // Cap at 8 — the strip is meant to feel finite and conquerable.
      res.json({
        role,
        generatedAt: new Date().toISOString(),
        items: visible.slice(0, 8),
        totalBeforeCap: visible.length,
      });
    } catch (err) {
      console.error("[do-next] handler failed:", err);
      res.status(500).json({ error: "do_next_failed" });
    }
  });

  app.post("/api/home/do-next/:itemKey/snooze", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    const userId = Number((req as any).user?.id);
    const itemKey = String(req.params.itemKey || "").slice(0, 256);
    const hours = Math.max(1, Math.min(24 * 30, Number((req.body as any)?.hours) || 24));
    const reason = ((req.body as any)?.reason || null) as string | null;
    if (!userId || !itemKey) return res.status(400).json({ error: "bad_request" });

    const until = new Date(Date.now() + hours * 3_600_000);
    try {
      await db.execute(sql`
        INSERT INTO do_next_state (user_id, item_key, snoozed_until, snooze_count, last_reason, updated_at)
        VALUES (${userId}, ${itemKey}, ${until}, 1, ${reason}, NOW())
        ON CONFLICT (user_id, item_key) DO UPDATE
          SET snoozed_until = EXCLUDED.snoozed_until,
              snooze_count = do_next_state.snooze_count + 1,
              last_reason  = EXCLUDED.last_reason,
              dismissed_at = NULL,
              updated_at   = NOW()
      `);
      res.json({ ok: true, snoozedUntil: until.toISOString() });
    } catch (err) {
      console.error("[do-next] snooze failed:", err);
      res.status(500).json({ error: "snooze_failed" });
    }
  });

  app.post("/api/home/do-next/:itemKey/dismiss", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    const userId = Number((req as any).user?.id);
    const itemKey = String(req.params.itemKey || "").slice(0, 256);
    const reason = ((req.body as any)?.reason || null) as string | null;
    if (!userId || !itemKey) return res.status(400).json({ error: "bad_request" });

    try {
      await db.execute(sql`
        INSERT INTO do_next_state (user_id, item_key, dismissed_at, last_reason, updated_at)
        VALUES (${userId}, ${itemKey}, NOW(), ${reason}, NOW())
        ON CONFLICT (user_id, item_key) DO UPDATE
          SET dismissed_at = NOW(),
              last_reason  = EXCLUDED.last_reason,
              updated_at   = NOW()
      `);
      res.json({ ok: true });
    } catch (err) {
      console.error("[do-next] dismiss failed:", err);
      res.status(500).json({ error: "dismiss_failed" });
    }
  });

  app.delete("/api/home/do-next/:itemKey", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    const userId = Number((req as any).user?.id);
    const itemKey = String(req.params.itemKey || "").slice(0, 256);
    if (!userId || !itemKey) return res.status(400).json({ error: "bad_request" });

    try {
      await db.execute(sql`
        UPDATE do_next_state
        SET snoozed_until = NULL, dismissed_at = NULL, updated_at = NOW()
        WHERE user_id = ${userId} AND item_key = ${itemKey}
      `);
      res.json({ ok: true });
    } catch (err) {
      console.error("[do-next] clear failed:", err);
      res.status(500).json({ error: "clear_failed" });
    }
  });
}

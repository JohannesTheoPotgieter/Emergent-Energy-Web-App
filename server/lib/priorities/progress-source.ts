/**
 * Priority progress source — computes a Priority's progress percent from
 * a linked source (project phase, project %, revenue milestone, tasks
 * roll-up) instead of a manually-typed value.
 *
 * Storage: `mytool_company_priorities.progress_source_type` +
 * `progress_source_ref` (jsonb). See migration 0009.
 *
 * Defensive — never throws. Returns `{ value: null }` when the source is
 * unset/invalid so callers fall back to the existing manual-progress path.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { PHASES } from "../../../shared/phases";

export type ProgressSourceType =
  | "manual"
  | "project_phase"
  | "project_percent"
  | "milestone_revenue"
  | "tasks_rollup";

export interface ProgressSourceRef {
  projectId?: number;
  phaseCode?: string;
  milestoneId?: number;
  workItemIds?: number[];
}

export interface ComputedProgress {
  /** 0–100, integer. `null` when source unset / unresolvable. */
  value: number | null;
  /** Human-readable summary of what drove the value. */
  label: string;
}

const NULL_RESULT: ComputedProgress = { value: null, label: "" };

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function computeProjectPhase(ref: ProgressSourceRef): Promise<ComputedProgress> {
  if (!ref.projectId || !ref.phaseCode) return NULL_RESULT;
  // Read project's current canonical stage_code.
  const rows: any = await db.execute(sql`
    SELECT current_stage_code, project_name
    FROM project_info
    WHERE id = ${ref.projectId}
    LIMIT 1
  `);
  const row = rows.rows?.[0] || rows[0];
  if (!row) return NULL_RESULT;
  const targetIdx = PHASES.findIndex((p) => p.code === ref.phaseCode);
  const currentIdx = PHASES.findIndex((p) => p.code === row.current_stage_code);
  if (targetIdx < 0) return NULL_RESULT;
  const targetPhase = PHASES[targetIdx];
  const projName = row.project_name || `Project #${ref.projectId}`;
  if (currentIdx < 0) {
    // Non-canonical / orthogonal status (Hold, Closed, legacy code) —
    // treat as "unknown phase" rather than 0%, so the priority falls back
    // to manual % instead of showing a misleading drop to zero.
    return { value: null, label: `${projName} status not in canonical phase cycle` };
  }
  // Reach-or-pass semantics: 100% when current phase ≥ target phase,
  // otherwise a partial credit based on phase index proportion.
  if (currentIdx >= targetIdx) {
    return { value: 100, label: `${projName} reached ${targetPhase.label}` };
  }
  const pct = clampPct(((currentIdx + 1) / (targetIdx + 1)) * 100);
  return { value: pct, label: `${projName} at ${PHASES[currentIdx].label} → ${targetPhase.label}` };
}

async function computeProjectPercent(ref: ProgressSourceRef): Promise<ComputedProgress> {
  if (!ref.projectId) return NULL_RESULT;
  const rows: any = await db.execute(sql`
    SELECT pi.project_name, dpk.avg_actual_pct_complete
    FROM project_info pi
    LEFT JOIN derived_project_kpis dpk ON dpk.project_id = pi.id
    WHERE pi.id = ${ref.projectId}
    LIMIT 1
  `);
  const row = rows.rows?.[0] || rows[0];
  if (!row) return NULL_RESULT;
  const raw = row.avg_actual_pct_complete;
  if (raw == null) {
    return { value: 0, label: `${row.project_name} has no progress data yet` };
  }
  const pct = clampPct(Number(raw));
  return { value: pct, label: `${row.project_name} overall % complete` };
}

async function computeMilestoneRevenue(ref: ProgressSourceRef): Promise<ComputedProgress> {
  if (!ref.milestoneId) return NULL_RESULT;
  const rows: any = await db.execute(sql`
    SELECT id, milestone_name, paid_date, invoice_number, project_name
    FROM normalized_revenue_lines
    WHERE id = ${ref.milestoneId} AND deleted_at IS NULL AND effective_to IS NULL
    LIMIT 1
  `);
  const row = rows.rows?.[0] || rows[0];
  if (!row) return NULL_RESULT;
  const name = row.milestone_name || `Milestone #${ref.milestoneId}`;
  if (row.paid_date) {
    return { value: 100, label: `${name} paid` };
  }
  if (row.invoice_number) {
    return { value: 60, label: `${name} invoiced (awaiting payment)` };
  }
  return { value: 0, label: `${name} not yet invoiced` };
}

async function computeTasksRollup(ref: ProgressSourceRef): Promise<ComputedProgress> {
  const ids = (ref.workItemIds || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return NULL_RESULT;
  // Bind the int[] as a single parameter via PG's standard literal syntax;
  // avoids any sql.raw() concatenation surface.
  const arrayLiteral = `{${ids.join(",")}}`;
  const rows: any = await db.execute(sql`
    SELECT
      COALESCE(AVG(COALESCE(pm.percent_complete, wi.percent_complete, 0))::numeric, 0) AS avg_pct,
      COUNT(*) AS n
    FROM work_items wi
    LEFT JOIN work_item_pm pm ON pm.work_item_id = wi.id
    WHERE wi.id = ANY(${arrayLiteral}::int[])
      AND wi.deleted_at IS NULL
  `);
  const row = rows.rows?.[0] || rows[0];
  if (!row || Number(row.n) === 0) return NULL_RESULT;
  const pct = clampPct(Number(row.avg_pct));
  return { value: pct, label: `${row.n} task${Number(row.n) === 1 ? "" : "s"} averaged` };
}

/**
 * Compute the linked progress for a Priority. Returns `{value:null}` when
 * the source is unset or invalid — caller should fall back to manual.
 */
export async function computePriorityProgress(
  type: string | null | undefined,
  ref: any,
): Promise<ComputedProgress> {
  if (!type || type === "manual") return NULL_RESULT;
  const safeRef: ProgressSourceRef = (ref && typeof ref === "object" ? ref : {}) as ProgressSourceRef;
  try {
    switch (type as ProgressSourceType) {
      case "project_phase":
        return await computeProjectPhase(safeRef);
      case "project_percent":
        return await computeProjectPercent(safeRef);
      case "milestone_revenue":
        return await computeMilestoneRevenue(safeRef);
      case "tasks_rollup":
        return await computeTasksRollup(safeRef);
      default:
        return NULL_RESULT;
    }
  } catch (err: any) {
    console.warn("[priority-progress-source] compute failed:", err?.message);
    return NULL_RESULT;
  }
}

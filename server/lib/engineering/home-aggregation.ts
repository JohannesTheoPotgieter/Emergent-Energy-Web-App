/**
 * Engineering Home — pure aggregation logic (no DB, no IO).
 *
 * Built on the canonical spine: the inputs are plain rows sourced from
 * `work_items` (workstream = ENG) + `project_info`/`project_execution_state`
 * (phase, read-only) + the caller's `work_item_assignments`. Keeping this pure
 * makes the Home metrics unit-testable without a database and guarantees the
 * route and any future surface compute the same numbers.
 *
 * Phase is read-only everywhere in Engineering — we only resolve a code to its
 * canonical label via `shared/phases.ts`; we never write it.
 */

import { isTaskComplete } from "@shared/task-status";
import { resolveCanonicalPhase, isInActiveExecutionWindow } from "@shared/phases";

export interface EngHomeTaskInput {
  id: number;
  projectId: number | null;
  status: string;
  /** `work_items.end_date` — ISO `YYYY-MM-DD` or null. */
  endDate: string | null;
  ownerUserId: number | null;
  /** Display name of the task owner (joined from `users.name`), or null. */
  ownerName: string | null;
  title: string;
  priority: string | null;
}

export interface EngHomeProjectInput {
  id: number;
  projectName: string;
  /** Canonical stage code OR free phase string (read-only). */
  phaseCode: string | null;
}

export interface EngineeringHomeFilters {
  /** Scope metrics + portfolio to these project ids. Empty/omitted = all. */
  projectIds?: readonly number[];
  /** Scope metrics + portfolio + My Work to this engineer. Omitted = everyone. */
  ownerUserId?: number;
  /**
   * When false (default), hide completed tasks from every count and list AND
   * drop projects whose phase is outside the active execution window (Done /
   * pre-Financial-Close) from the portfolio.
   */
  includeCompleted?: boolean;
}

export interface EngineeringHomeInput {
  tasks: EngHomeTaskInput[];
  projects: EngHomeProjectInput[];
  myUserId: number;
  myAssignedTaskIds: ReadonlySet<number>;
  /** ISO `YYYY-MM-DD` for "today" so the function is deterministic in tests. */
  today: string;
  /** Optional slicing — site (project), engineer (owner), hide-completed. */
  filters?: EngineeringHomeFilters;
}

export type DueBucket = "overdue" | "today" | "this_week" | "later" | "none";

export interface EngineeringHomeMetrics {
  activeProjects: number;
  openTasks: number;
  dueThisWeek: number;
  overdue: number;
}

export interface EngineeringHomePortfolioRow {
  projectId: number;
  projectName: string;
  phaseCode: string | null;
  phaseLabel: string;
  open: number;
  overdue: number;
  /** 0..100, completed ÷ total ENG tasks on the project. */
  progress: number;
}

export interface EngineeringHomeMyWorkRow {
  id: number;
  title: string;
  projectId: number | null;
  projectName: string | null;
  status: string;
  endDate: string | null;
  due: DueBucket;
}

export interface EngineeringHomeOwner {
  id: number;
  name: string;
}

export interface EngineeringHomeSummary {
  metrics: EngineeringHomeMetrics;
  portfolio: EngineeringHomePortfolioRow[];
  myWork: EngineeringHomeMyWorkRow[];
  /** Distinct engineers that own ENG tasks, alphabetical — drives the
   *  client's Engineer filter. Computed BEFORE the owner filter is applied
   *  so the dropdown always offers every engineer. */
  owners: EngineeringHomeOwner[];
}

/** Add `n` days to an ISO `YYYY-MM-DD` string (UTC, no time component). */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Classify a due date relative to today. ISO date strings compare lexically. */
export function dueBucket(endDate: string | null, today: string): DueBucket {
  if (!endDate) return "none";
  if (endDate < today) return "overdue";
  if (endDate === today) return "today";
  if (endDate <= addDaysIso(today, 6)) return "this_week";
  return "later";
}

const DUE_ORDER: Record<DueBucket, number> = {
  overdue: 0,
  today: 1,
  this_week: 2,
  later: 3,
  none: 4,
};

/**
 * Compute the Engineering Home summary (overview metrics, portfolio
 * "where are we", and the caller's open work) from spine rows.
 */
export function summarizeEngineeringHome(input: EngineeringHomeInput): EngineeringHomeSummary {
  const { tasks, projects, myUserId, myAssignedTaskIds, today, filters } = input;
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const includeCompleted = filters?.includeCompleted ?? false;
  const ownerUserId = filters?.ownerUserId;
  const projectIdFilter =
    filters?.projectIds && filters.projectIds.length > 0 ? new Set(filters.projectIds) : null;

  // Owners dropdown is computed from the UNFILTERED task set so it always
  // offers every engineer with ENG work — independent of the active slice.
  const ownerNameById = new Map<number, string>();
  for (const t of tasks) {
    if (t.ownerUserId != null && !ownerNameById.has(t.ownerUserId)) {
      ownerNameById.set(t.ownerUserId, t.ownerName ?? `User ${t.ownerUserId}`);
    }
  }
  const owners: EngineeringHomeOwner[] = [...ownerNameById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let openTasks = 0;
  let dueThisWeek = 0;
  let overdue = 0;
  const activeProjectIds = new Set<number>();

  const perProject = new Map<number, { open: number; overdue: number; total: number; done: number }>();
  const ensureProject = (pid: number) => {
    let agg = perProject.get(pid);
    if (!agg) {
      agg = { open: 0, overdue: 0, total: 0, done: 0 };
      perProject.set(pid, agg);
    }
    return agg;
  };

  const myWork: EngineeringHomeMyWorkRow[] = [];

  for (const t of tasks) {
    // --- Apply the requested slice ---------------------------------------
    if (projectIdFilter && (t.projectId == null || !projectIdFilter.has(t.projectId))) continue;
    if (ownerUserId != null && t.ownerUserId !== ownerUserId) continue;

    const complete = isTaskComplete(t.status);
    // Hide-completed: completed tasks drop out of every count, list and
    // per-project tally when includeCompleted is false.
    if (complete && !includeCompleted) continue;

    const open = !complete;
    const bucket = dueBucket(t.endDate, today);

    if (t.projectId != null) {
      activeProjectIds.add(t.projectId);
      const agg = ensureProject(t.projectId);
      agg.total += 1;
      if (open) {
        agg.open += 1;
        if (bucket === "overdue") agg.overdue += 1;
      } else {
        agg.done += 1;
      }
    }

    if (open) {
      openTasks += 1;
      if (bucket === "overdue") overdue += 1;
      if (bucket === "today" || bucket === "this_week") dueThisWeek += 1;
    }

    const mine = t.ownerUserId === myUserId || myAssignedTaskIds.has(t.id);
    if (mine && open) {
      const proj = t.projectId != null ? projectById.get(t.projectId) : undefined;
      myWork.push({
        id: t.id,
        title: t.title,
        projectId: t.projectId,
        projectName: proj?.projectName ?? null,
        status: t.status,
        endDate: t.endDate,
        due: bucket,
      });
    }
  }

  const portfolio: EngineeringHomePortfolioRow[] = [];
  for (const [pid, agg] of perProject) {
    const proj = projectById.get(pid);
    if (!proj) continue;
    const phase = resolveCanonicalPhase(proj.phaseCode);
    // When hiding completed work, drop Done / pre-Financial-Close projects
    // (outside the active execution window) from the portfolio entirely.
    if (!includeCompleted && !isInActiveExecutionWindow(proj.phaseCode)) continue;
    portfolio.push({
      projectId: pid,
      projectName: proj.projectName,
      phaseCode: proj.phaseCode,
      phaseLabel: phase?.label ?? proj.phaseCode ?? "—",
      open: agg.open,
      overdue: agg.overdue,
      progress: agg.total > 0 ? Math.round((agg.done / agg.total) * 100) : 0,
    });
  }
  portfolio.sort(
    (a, b) => b.overdue - a.overdue || b.open - a.open || a.projectName.localeCompare(b.projectName),
  );

  myWork.sort(
    (a, b) => DUE_ORDER[a.due] - DUE_ORDER[b.due] || (a.endDate ?? "9999-99-99").localeCompare(b.endDate ?? "9999-99-99"),
  );

  return {
    metrics: {
      activeProjects: activeProjectIds.size,
      openTasks,
      dueThisWeek,
      overdue,
    },
    portfolio,
    myWork,
    owners,
  };
}

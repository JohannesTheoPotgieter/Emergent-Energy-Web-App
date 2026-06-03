/**
 * FYE Tracking — orchestration service.
 *
 * Fetches the imported tracker data (canonical per-line revenue/COS from
 * `FinanceLineLevelRepository`, project metadata + tracker source from
 * `FyeTrackingDataRepository`) and runs the pure compute layer to produce
 * View A (project table + 4-state totals + flags) and View B (dashboard).
 *
 * Future-proof: it operates on whatever projects are imported. New uploads
 * flow through automatically; the only curated input is the exclusion list
 * (configurable — see exclusions.ts) and the manual Revised-Budget figures.
 */

import {
  FinanceLineLevelRepository,
  type FinanceLine,
} from "../../../repositories/finance-line-level-repository";
import {
  FyeTrackingDataRepository,
  type FyeProjectMetaRow,
} from "../../../repositories/fye-tracking-data-repository";
import { getFinanceYearBounds, getCurrentFinanceYear } from "../../finance-year-scope";
import {
  computeProjectTable,
  computeDashboard,
  normalizeName,
  type FyeProjectMeta,
  type FyeProjectType,
  type FyeProjectTableResult,
  type FyeDashboardResult,
  type RevisedBudgetMap,
  type FyeMetric,
} from "./compute";

const SAST_OFFSET_MS = 120 * 60 * 1000;
/** Today's ISO date on the SAST calendar (UTC+2, no DST) — same anchor the
 * finance stack uses for month boundaries. */
export function sastTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 12 FY month keys Sep..Aug for the given FY. */
export function fyMonthKeys(fy: number): string[] {
  const keys: string[] = [];
  for (let m = 9; m <= 12; m++) keys.push(`${fy - 1}-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 8; m++) keys.push(`${fy}-${String(m).padStart(2, "0")}`);
  return keys;
}

/** The last CLOSED month key (the month before today's), clamped to the FY
 * window. Returns null if the FY hasn't started yet. */
export function lastClosedMonthKey(fy: number, todayIso: string): string | null {
  const months = fyMonthKeys(fy);
  const todayKey = todayIso.slice(0, 7);
  // Last closed = the latest FY month strictly before the current month.
  const closed = months.filter((m) => m < todayKey);
  if (closed.length === 0) return null;
  return closed[closed.length - 1];
}

/** Project Type (Active / Past / Compliance). Documented heuristic — Type is a
 * display/grouping column and is not part of the reconciled totals.
 *   Compliance — project sits in the Compliance Handover phase.
 *   Past       — closed/archived, or practical completion already achieved.
 *   Active     — everything else (currently in delivery / pre-delivery).
 */
export function deriveProjectType(meta: FyeProjectMetaRow, todayIso: string): FyeProjectType {
  const phase = (meta.phase ?? "").toUpperCase();
  if (phase.includes("COMPLIANCE")) return "Compliance";
  const archived = (meta.archivedStatus ?? "").toUpperCase();
  if (archived === "ARCHIVED" || archived === "ARCHIVED_MERGED" || archived === "GONE") return "Past";
  if ((meta.projectStatus ?? "").toLowerCase() === "closed") return "Past";
  if (meta.pcActual && meta.pcActual < todayIso) return "Past";
  return "Active";
}

export interface FyeTrackingResult {
  fye: number;
  asAt: { date: string; sourceFileName: string | null; committedAt: string | null };
  projectTable: FyeProjectTableResult;
  dashboard: FyeDashboardResult;
}

export interface FyeServiceDeps {
  financeLines?: FinanceLineLevelRepository;
  data?: FyeTrackingDataRepository;
}

/**
 * Build the full FYE Tracking result for a given FY.
 */
export async function buildFyeTracking(
  fy: number = getCurrentFinanceYear(),
  deps: FyeServiceDeps = {},
  now: Date = new Date(),
): Promise<FyeTrackingResult> {
  const financeRepo = deps.financeLines ?? new FinanceLineLevelRepository();
  const dataRepo = deps.data ?? new FyeTrackingDataRepository();

  const bounds = getFinanceYearBounds(fy);
  const todayIso = sastTodayIso(now);
  const months = fyMonthKeys(fy);
  const lastClosed = lastClosedMonthKey(fy, todayIso);

  const [projectMeta, trackerSource, trackerDates, revisedRows, latestRun] = await Promise.all([
    dataRepo.listProjectMeta(),
    dataRepo.listLatestTrackerSourceByProject(),
    dataRepo.listTrackerMetadataDates(),
    dataRepo.getRevisedBudget(fy),
    dataRepo.getLatestCommittedImportRun(),
  ]);

  const projectIds = projectMeta.map((p) => p.projectId);
  const lines = await financeRepo.getPortfolioFinanceLines(projectIds, {
    fyStart: bounds.startDate,
    fyEnd: bounds.endDate,
  });

  // Build FyeProjectMeta map (type + dates + source).
  const metas = new Map<number, FyeProjectMeta>();
  for (const p of projectMeta) {
    const src = trackerSource.get(p.projectId);
    const td = trackerDates.get(p.projectId);
    const startDate =
      p.constructionStartActual ?? p.constructionStartDate ?? td?.startDate ?? null;
    const pcDate =
      p.pcActual ?? p.pcTarget ?? td?.forecastedCompletion ?? td?.baselineCompletion ?? null;
    metas.set(p.projectId, {
      projectId: p.projectId,
      projectName: p.projectName,
      canonicalKey: normalizeName(p.projectName),
      type: deriveProjectType(p, todayIso),
      startDate,
      pcDate,
      sourceFileName: src?.sourceFileName ?? null,
      sourceFolderPath: null,
    });
  }

  // Group lines by project.
  const linesByProject = new Map<number, FinanceLine[]>();
  for (const l of lines) {
    if (!linesByProject.has(l.projectId)) linesByProject.set(l.projectId, []);
    linesByProject.get(l.projectId)!.push(l);
  }

  // View A.
  const projectTable = computeProjectTable(linesByProject, metas, todayIso);

  // View B — dashboard from the lines of projects that count towards totals
  // (kept after exclusion/de-dup, and not NON_STANDARD_TEMPLATE).
  const countedProjectIds = new Set(
    projectTable.rows.filter((r) => !r.excludedFromTotals).map((r) => r.projectId),
  );
  const dashboardLines = lines.filter((l) => countedProjectIds.has(l.projectId));
  const revised: RevisedBudgetMap = {};
  for (const r of revisedRows) {
    const metric = r.metric as FyeMetric;
    if (metric !== "revenue" && metric !== "cos" && metric !== "gp") continue;
    (revised[metric] ??= {})[r.monthKey] = r.amount;
  }
  const dashboard = computeDashboard(dashboardLines, revised, months, lastClosed, todayIso);

  return {
    fye: fy,
    asAt: {
      date: todayIso,
      sourceFileName: latestRun?.sourceFileName ?? null,
      committedAt: latestRun?.committedAt ? latestRun.committedAt.toISOString() : null,
    },
    projectTable,
    dashboard,
  };
}

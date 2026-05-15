/**
 * Smart Import v2 — Shared KPI formulas
 *
 * Canonical implementations of the small set of derived KPIs that several
 * pages render: actual-vs-expected progress percentage, date-driven
 * expected percentage, and the gap arithmetic that drives schedule RAG.
 *
 * Why this file exists: before the 2026-05-15 KPI-consistency audit
 * (see docs/smart-import-v2-task-dedup-audit.md, Fix 4b), the formula for
 * "expected % from dates" was duplicated across five files, with two of
 * them using calendar days and three using South African working days +
 * public holidays. The same `work_items` row therefore produced different
 * "expected %" — and different RAG colours — depending on which page the
 * operator was looking at.
 *
 * Single source of truth for SA working days: `server/lib/sa-holidays.ts`.
 * Read sites should NOT re-implement the date math.
 */

import { isHoliday, parseDateParts, formatDateKey } from "./sa-holidays";

/**
 * Count working days (Mon–Fri, excluding SA public holidays) inclusive
 * between two YYYY-MM-DD dates. Returns `null` if either input is missing
 * or malformed; returns `0` if `endDateStr` < `startDateStr`. Both
 * boundaries are counted.
 *
 * Lifted from the five duplicated copies in
 * planning-tasks-routes / dashboard-routes / lifecycle-routes /
 * project-routes / project-summary-helpers — those copies should
 * progressively migrate to call this helper.
 */
export function saWorkingDays(
  startDateStr: string | null,
  endDateStr: string | null,
): number | null {
  if (
    !startDateStr ||
    !endDateStr ||
    !/^\d{4}-\d{2}-\d{2}/.test(startDateStr) ||
    !/^\d{4}-\d{2}-\d{2}/.test(endDateStr)
  ) {
    return null;
  }
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const ds = formatDateKey(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate(),
    );
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Canonical date-driven "expected %" formula. Returns a value in 0..1
 * (canonical scale, matches `work_items.expectedPctComplete`).
 *
 * Rules:
 *   - Either date missing or malformed → null
 *   - `today` before `start` → 0
 *   - `today` after `end` → 1
 *   - Otherwise → elapsedWorkingDays / totalWorkingDays, clamped to [0, 1]
 *
 * Replaces five inline implementations across the readers (some using
 * calendar days, others using SA working days). All readers should call
 * this so the Plan tab, Program Dashboard, Programme reports, and
 * KPI service give the same expected % for the same row.
 */
export function expectedPctFromDates(
  startDateStr: string | null,
  endDateStr: string | null,
  todayStr: string,
): number | null {
  if (!startDateStr || !endDateStr) return null;
  const start = startDateStr.slice(0, 10);
  const end = endDateStr.slice(0, 10);
  const today = todayStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null;
  }
  if (today < start) return 0;
  if (today > end) return 1;
  const totalWd = saWorkingDays(start, end);
  const elapsedWd = saWorkingDays(start, today);
  if (totalWd == null || elapsedWd == null || totalWd <= 0) {
    return totalWd === 0 ? 1 : null;
  }
  return Math.min(Math.max(elapsedWd / totalWd, 0), 1);
}

/**
 * Coerce a percent-style value to the canonical 0..100 scale used by
 * downstream gap arithmetic and severity bands.
 *
 * After the 2026-05-15 normalisation migration every value in
 * `work_items.percentComplete` / `expectedPctComplete` is in 0..1, so
 * `pctTo100(0.75) === 75`. The defensive "value > 1 means it's already
 * 0..100" branch handles any straggler that pre-dates the migration or
 * comes from a writer that hasn't been updated yet. The intent is that
 * once every writer routes through `clampPercent`, this function only
 * ever sees 0..1.
 *
 * Returns `null` for null / undefined / NaN inputs — callers must decide
 * how to treat missing values explicitly (some count as zero, some skip).
 */
export function pctTo100(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n <= 1) return n * 100;
  if (n <= 100) return n;
  return 100;
}

/**
 * Schedule RAG band derived from the percentage-point gap between actual
 * and expected progress (`actual - expected`, both on the 0..100 scale).
 *
 * Bands mirror the existing `severityFromGap` / lifecycle-stage-gate /
 * project-platform-summary thresholds:
 *   - delta < -15  → "red"
 *   - delta < -5   → "amber"
 *   - otherwise    → "green"
 */
export type ScheduleRag = "green" | "amber" | "red";

export function scheduleRagFromVariance(
  actualPct100: number | null,
  expectedPct100: number | null,
): ScheduleRag | null {
  if (actualPct100 == null || expectedPct100 == null) return null;
  const delta = actualPct100 - expectedPct100;
  if (delta < -15) return "red";
  if (delta < -5) return "amber";
  return "green";
}

/**
 * Canonical Actual % / Expected % per project.
 *
 * One formula across the Plan tab, the Execution Dashboard, the All
 * Projects table, and the lifecycle board. Before this helper existed
 * each surface re-derived the percentages with its own loop — the Plan
 * tab used duration-weighted across *all* tasks, the dashboards used
 * simple-average across leaf tasks — so the same project row showed
 * "12% / 14%" on one page and "9% / 11%" on another.
 *
 * Rules (locked 2026-05-15):
 *   - Filter out section-header rows ("no.", "no", "#").
 *   - Only count LEAF tasks (rows that no other task points at via
 *     parentRowNumber, indent inheritance, or WBS prefix). Phase parents
 *     are summary rollups, not work, so including them would weight
 *     their children twice.
 *   - Weight each leaf by `max(1, durationDays)` — schedule weight, not
 *     headcount. A 30-day task counts 30× a 1-day task.
 *   - Stored `actualPctComplete` / `expectedPctComplete` arrive on a
 *     0..1 scale (post-2026-05-15 normalisation). `pctTo100` accepts
 *     both 0..1 and 0..100 stragglers.
 *   - When `expectedPctComplete` is missing on a row, fall back to
 *     `expectedPctFromDates(start, end, today)` so the formula doesn't
 *     bias toward zero whenever the workbook leaves the column blank.
 */
export interface ProgressTaskInput {
  taskNo: string | null;
  rowNumber: number | null;
  parentRowNumber: number | null;
  indentLevel: number | null;
  durationDays: number | null;
  actualPctComplete: number | null;
  expectedPctComplete: number | null;
  startDate: string | null;
  endDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
}

export interface ProjectProgress {
  actualPct: number;
  expectedPct: number;
  variancePct: number;
  leafCount: number;
}

const SECTION_HEADER_TASKNOS = new Set(["no.", "no", "#"]);

function isSectionHeader(t: ProgressTaskInput): boolean {
  const tn = (t.taskNo || "").toString().toLowerCase().trim();
  return SECTION_HEADER_TASKNOS.has(tn);
}

function collectParentRowNumbers(tasks: ProgressTaskInput[]): Set<number> {
  const parents = new Set<number>();
  for (const t of tasks) {
    if (t.parentRowNumber != null) parents.add(t.parentRowNumber);
  }
  // Indent inheritance: a row is a parent of the row immediately below
  // it when the next row's indent is deeper. Matches the legacy logic in
  // program-dashboard-repository.ts.
  for (let i = 0; i < tasks.length - 1; i++) {
    const currIndent = tasks[i].indentLevel ?? 0;
    const nextIndent = tasks[i + 1].indentLevel ?? 0;
    if (nextIndent > currIndent && tasks[i].rowNumber != null) {
      parents.add(tasks[i].rowNumber as number);
    }
  }
  return parents;
}

export function computeProjectProgress(
  tasks: ProgressTaskInput[],
  todayIso: string,
): ProjectProgress {
  const filtered = tasks.filter((t) => !isSectionHeader(t));
  const parentRows = collectParentRowNumbers(filtered);
  const leaves = filtered.filter(
    (t) => t.rowNumber == null || !parentRows.has(t.rowNumber),
  );
  const items = leaves.length > 0 ? leaves : filtered;

  let actualWeightedSum = 0;
  let expectedWeightedSum = 0;
  let totalWeight = 0;
  for (const t of items) {
    const weight = Math.max(1, t.durationDays ?? 1);
    const actual100 = pctTo100(t.actualPctComplete) ?? 0;
    let expected100 = pctTo100(t.expectedPctComplete);
    if (expected100 == null) {
      const s = t.actualStartDate || t.startDate;
      const e = t.actualEndDate || t.endDate;
      const fraction = expectedPctFromDates(s, e, todayIso);
      expected100 = fraction == null ? 0 : fraction * 100;
    }
    actualWeightedSum += actual100 * weight;
    expectedWeightedSum += expected100 * weight;
    totalWeight += weight;
  }

  const actualPct = totalWeight > 0 ? Math.round(actualWeightedSum / totalWeight) : 0;
  const expectedPct = totalWeight > 0 ? Math.round(expectedWeightedSum / totalWeight) : 0;
  return {
    actualPct,
    expectedPct,
    variancePct: actualPct - expectedPct,
    leafCount: items.length,
  };
}

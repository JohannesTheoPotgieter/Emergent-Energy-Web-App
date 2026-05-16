/**
 * Client-side mirror of server/lib/kpi-formulas.ts → computeProjectProgress.
 *
 * The Plan tab renders Actual % / Expected % pills before the
 * Execution Dashboard's API response is in scope, so it computes the
 * percentages from the per-task data it already has. To keep the pill
 * numbers identical to the dashboards', the formula here matches the
 * server helper exactly — duration-weighted average across leaf tasks,
 * with a date-derived fallback when expectedPctComplete is null.
 *
 * If you change the formula, change both files together.
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

function pctTo100(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n <= 1) return n * 100;
  if (n <= 100) return n;
  return 100;
}

function expectedPctFromDatesCalendar(
  startDateStr: string | null,
  endDateStr: string | null,
  todayStr: string,
): number | null {
  if (!startDateStr || !endDateStr) return null;
  const s = startDateStr.slice(0, 10);
  const e = endDateStr.slice(0, 10);
  const t = todayStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
  if (t < s) return 0;
  if (t > e) return 1;
  const startMs = Date.UTC(
    Number(s.slice(0, 4)),
    Number(s.slice(5, 7)) - 1,
    Number(s.slice(8, 10)),
  );
  const endMs = Date.UTC(
    Number(e.slice(0, 4)),
    Number(e.slice(5, 7)) - 1,
    Number(e.slice(8, 10)),
  );
  const todayMs = Date.UTC(
    Number(t.slice(0, 4)),
    Number(t.slice(5, 7)) - 1,
    Number(t.slice(8, 10)),
  );
  const total = Math.max(1, (endMs - startMs) / 86400000);
  const elapsed = (todayMs - startMs) / 86400000;
  return Math.min(Math.max(elapsed / total, 0), 1);
}

function isSectionHeader(t: ProgressTaskInput): boolean {
  const tn = (t.taskNo || "").toString().toLowerCase().trim();
  return SECTION_HEADER_TASKNOS.has(tn);
}

function collectParentRowNumbers(tasks: ProgressTaskInput[]): Set<number> {
  const parents = new Set<number>();
  for (const t of tasks) {
    if (t.parentRowNumber != null) parents.add(t.parentRowNumber);
  }
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
      const fraction = expectedPctFromDatesCalendar(s, e, todayIso);
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

import { toCanonicalEngineeringStageStatus, toCanonicalQualityStatus } from "@shared/status-logic";

export interface ProjectCompletion {
  actualPct: number;
  expectedPct: number;
  delta: number;
}

export function computeProjectCompletion(plans: any[]): ProjectCompletion {
  const todayStr = new Date().toISOString().split("T")[0];
  const validPlans = plans.filter((p: any) => {
    const hasActual = (p.actualPctComplete ?? p.percentComplete) != null;
    const hasExpected = (p.expectedPctComplete ?? p.expectedProgress) != null;
    const hasDateRange = p.actualStart && p.actualEnd;
    return hasActual || hasExpected || hasDateRange;
  });
  if (validPlans.length === 0) return { actualPct: 0, expectedPct: 0, delta: 0 };

  let totalWeight = 0;
  let weightedActual = 0;
  let weightedExpected = 0;

  for (const p of validPlans) {
    const dur = p.durationDays && p.durationDays > 0 ? p.durationDays : 1;
    const act = p.actualPctComplete ?? p.percentComplete ?? 0;
    weightedActual += (parseFloat(act) || 0) * dur;

    let exp = p.expectedPctComplete ?? p.expectedProgress ?? null;
    if (exp == null) {
      const tStart = p.actualStart?.substring(0, 10);
      const tEnd = p.actualEnd?.substring(0, 10);
      if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
        if (todayStr >= tEnd) exp = 1.0;
        else if (todayStr <= tStart) exp = 0.0;
        else {
          const totalDays = Math.max(1, (new Date(tEnd).getTime() - new Date(tStart).getTime()) / 86400000);
          const elapsedDays = (new Date(todayStr).getTime() - new Date(tStart).getTime()) / 86400000;
          exp = Math.min(elapsedDays / totalDays, 1.0);
        }
      } else {
        exp = 0;
      }
    }
    weightedExpected += (parseFloat(exp) || 0) * dur;
    totalWeight += dur;
  }

  if (totalWeight === 0) return { actualPct: 0, expectedPct: 0, delta: 0 };

  const rawActual = weightedActual / totalWeight;
  const rawExpected = weightedExpected / totalWeight;
  const actualPct = rawActual <= 1.0 ? Math.round(rawActual * 1000) / 10 : Math.round(rawActual * 10) / 10;
  const expectedPct = rawExpected <= 1.0 ? Math.round(rawExpected * 1000) / 10 : Math.round(rawExpected * 10) / 10;
  return { actualPct, expectedPct, delta: Math.round((actualPct - expectedPct) * 10) / 10 };
}

export function summarizeSchedule(items: ProjectCompletion[]) {
  const valid = items.filter((i) => i.actualPct > 0 || i.expectedPct > 0);
  const avgActualPct = valid.length > 0 ? Math.round((valid.reduce((s, i) => s + i.actualPct, 0) / valid.length) * 10) / 10 : 0;
  const avgExpectedPct = valid.length > 0 ? Math.round((valid.reduce((s, i) => s + i.expectedPct, 0) / valid.length) * 10) / 10 : 0;
  const avgDelta = valid.length > 0 ? Math.round((valid.reduce((s, i) => s + i.delta, 0) / valid.length) * 10) / 10 : 0;
  const behindCount = items.filter((i) => i.delta < -5).length;
  const atRiskCount = items.filter((i) => i.delta < -10).length;

  return {
    avgActualPct,
    avgExpectedPct,
    avgDelta,
    behindCount,
    onTrackCount: items.length - behindCount,
    atRiskCount,
    overallHealth: atRiskCount > 0 ? "At Risk" : behindCount > 0 ? "Behind" : "On Track",
  };
}

export function summarizeEngineeringStatuses(rows: Array<{ status: unknown }>) {
  return rows.reduce(
    (acc, row) => {
      const canonical = toCanonicalEngineeringStageStatus(row.status);
      acc.total += 1;
      if (canonical === "complete") acc.complete += 1;
      else if (canonical === "in_progress") acc.inProgress += 1;
      else acc.notStarted += 1;
      return acc;
    },
    { total: 0, complete: 0, inProgress: 0, notStarted: 0 },
  );
}

export function summarizeQualityStatuses(rows: Array<{ status: unknown }>) {
  return rows.reduce(
    (acc, row) => {
      const canonical = toCanonicalQualityStatus(row.status);
      acc.total += 1;
      if (canonical === "approved") acc.approved += 1;
      else if (canonical === "failed") acc.failed += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, approved: 0, pending: 0, failed: 0 },
  );
}

export function calculateGrossMarginPercent(actualRevenue: number, actualExpenses: number): number {
  if (actualRevenue <= 0) return 0;
  return Math.round((((actualRevenue - actualExpenses) / actualRevenue) * 100) * 100) / 100;
}

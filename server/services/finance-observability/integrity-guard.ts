/**
 * Weekly finance integrity guard — the freeze's safety net.
 *
 * Since the finance computation code is FROZEN, the residual risk is DATA /
 * integration drift: a tracker edit, a QB re-sync, or a snapshot anomaly that
 * silently breaks a number a human must know about. This guard runs the same
 * read-only proofs as `npm run verify:golden` + `npm run verify:finance`,
 * IN-PROCESS against production, weekly:
 *
 *   - golden        : independent golden-fixture tie (qa oracle vs prod views)
 *   - cross-surface : one value per metric on every surface (§ 3.3.2)
 *   - reconciliation: app==tracker, period-lock logic, tracker==QB snapshot tie
 *
 * On ANY drift it pages the owner immediately and records the run for the
 * on-demand health view + monthly digest. Strictly read-only (S7): no writes
 * to finance data, ever.
 */

import { getDbMode } from "../../db";
import { db } from "../../db";
import { financeIntegrityRuns, type InsertFinanceIntegrityRun } from "@shared/schema";
import {
  rollupIntegrity,
  type IntegrityCheckOutcome,
  type IntegrityCheckResult,
} from "../../lib/finance-observability";
import { notifyFinanceOwner } from "./notify";
import { recordFinanceJobRun } from "./job-heartbeats";
import { errMsg } from "../../lib/api-error";

export const FINANCE_INTEGRITY_JOB_KEY = "finance-integrity-guard";

interface CheckReport extends IntegrityCheckResult {
  detail: Record<string, unknown>;
}

export interface IntegrityGuardResult {
  runId: number | null;
  status: IntegrityCheckOutcome;
  driftCount: number;
  golden: CheckReport;
  crossSurface: CheckReport;
  reconciliation: CheckReport;
  alertDispatched: boolean;
  durationMs: number;
  summary: string;
}

/** Injectable seams — defaults wire the real verifiers + DB + alert pipeline. */
export interface IntegrityGuardDeps {
  runGolden: () => Promise<CheckReport>;
  runCrossSurface: () => Promise<CheckReport>;
  runReconciliation: () => Promise<CheckReport>;
  persistRun: (row: InsertFinanceIntegrityRun) => Promise<number | null>;
  markAlerted: (runId: number) => Promise<void>;
  notify: (payload: Parameters<typeof notifyFinanceOwner>[0]) => Promise<void>;
  recordHeartbeat: typeof recordFinanceJobRun;
  getDbMode: () => string;
  now: () => Date;
}

async function defaultRunGolden(): Promise<CheckReport> {
  try {
    const { runGoldenVerification } = await import("../../lib/golden-verification");
    const r = await runGoldenVerification();
    if (r.skipped) return { outcome: "skipped", driftCount: 0, detail: { skipReason: r.skipReason } };
    return {
      outcome: r.pass ? "pass" : "drift",
      driftCount: r.driftCount,
      detail: { counts: r.counts, sample: r.rows.filter((x) => x.status !== "tie").slice(0, 20) },
    };
  } catch (err) {
    return { outcome: "error", driftCount: 0, detail: { error: errMsg(err) } };
  }
}

async function defaultRunCrossSurface(): Promise<CheckReport> {
  try {
    const { runCrossSurfaceFinanceVerification } = await import("../../scripts/verify-cross-surface-finance");
    const r = await runCrossSurfaceFinanceVerification();
    return {
      outcome: r.pass ? "pass" : "drift",
      driftCount: r.failures.length,
      detail: { comparisons: r.comparisons, failures: r.failures.slice(0, 20) },
    };
  } catch (err) {
    return { outcome: "error", driftCount: 0, detail: { error: errMsg(err) } };
  }
}

async function defaultRunReconciliation(): Promise<CheckReport> {
  try {
    const { runReconciliationVerification } = await import("../../scripts/verify-all-projects-reconciliation");
    const r = await runReconciliationVerification();
    const companyFails = r.companyRows.filter((c) => !c.pass).length;
    const driftCount = r.counts.projFail + companyFails + (r.counts.lockPass ? 0 : 1);
    return {
      outcome: r.overallPass ? "pass" : "drift",
      driftCount,
      detail: {
        projectChecks: r.projectRows.length,
        projFail: r.counts.projFail,
        projWarn: r.counts.projWarn,
        lockPass: r.counts.lockPass,
        companyFails,
        sample: r.projectRows.filter((p) => !p.pass && !p.warn).slice(0, 20),
      },
    };
  } catch (err) {
    return { outcome: "error", driftCount: 0, detail: { error: errMsg(err) } };
  }
}

const defaultDeps: IntegrityGuardDeps = {
  runGolden: defaultRunGolden,
  runCrossSurface: defaultRunCrossSurface,
  runReconciliation: defaultRunReconciliation,
  persistRun: async (row) => {
    const [inserted] = await db.insert(financeIntegrityRuns).values(row).returning({ id: financeIntegrityRuns.id });
    return inserted?.id ?? null;
  },
  markAlerted: async (runId) => {
    const { eq } = await import("drizzle-orm");
    await db.update(financeIntegrityRuns).set({ alertDispatched: true }).where(eq(financeIntegrityRuns.id, runId));
  },
  notify: notifyFinanceOwner,
  recordHeartbeat: recordFinanceJobRun,
  getDbMode,
  now: () => new Date(),
};

export interface RunIntegrityGuardOptions {
  runType?: "scheduled" | "manual";
  triggeredBy?: string;
  deps?: Partial<IntegrityGuardDeps>;
}

/**
 * Run the integrity guard once. Read-only against prod; records the run and
 * pages the owner on any drift.
 */
export async function runFinanceIntegrityGuard(
  options: RunIntegrityGuardOptions = {},
): Promise<IntegrityGuardResult> {
  const deps: IntegrityGuardDeps = { ...defaultDeps, ...options.deps };
  const runType = options.runType ?? "scheduled";
  const triggeredBy = options.triggeredBy ?? "scheduler";
  const startedAt = deps.now();

  // SQLite/dev reports environment health only — never finance trust (S7/S9).
  if (deps.getDbMode() === "sqlite") {
    const skippedSummary = "Skipped — SQLite/dev environment (finance trust requires Postgres).";
    const skippedRow: InsertFinanceIntegrityRun = {
      runType,
      startedAt,
      finishedAt: deps.now(),
      status: "skipped",
      goldenStatus: "skipped",
      crossSurfaceStatus: "skipped",
      reconciliationStatus: "skipped",
      driftCount: 0,
      summary: skippedSummary,
      detail: { reason: "sqlite" },
      durationMs: 0,
      triggeredBy,
      alertDispatched: false,
    };
    const runId = await deps.persistRun(skippedRow).catch(() => null);
    await deps.recordHeartbeat({ jobKey: FINANCE_INTEGRITY_JOB_KEY, status: "success", startedAt, finishedAt: deps.now() }).catch(() => {});
    return {
      runId,
      status: "skipped",
      driftCount: 0,
      golden: { outcome: "skipped", driftCount: 0, detail: {} },
      crossSurface: { outcome: "skipped", driftCount: 0, detail: {} },
      reconciliation: { outcome: "skipped", driftCount: 0, detail: {} },
      alertDispatched: false,
      durationMs: 0,
      summary: skippedSummary,
    };
  }

  const [golden, crossSurface, reconciliation] = await Promise.all([
    deps.runGolden(),
    deps.runCrossSurface(),
    deps.runReconciliation(),
  ]);

  const rollup = rollupIntegrity([golden, crossSurface, reconciliation]);
  const finishedAt = deps.now();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const summary = buildSummary(rollup.status, rollup.driftCount, { golden, crossSurface, reconciliation });

  const row: InsertFinanceIntegrityRun = {
    runType,
    startedAt,
    finishedAt,
    status: rollup.status,
    goldenStatus: golden.outcome,
    crossSurfaceStatus: crossSurface.outcome,
    reconciliationStatus: reconciliation.outcome,
    driftCount: rollup.driftCount,
    summary,
    detail: { golden: golden.detail, crossSurface: crossSurface.detail, reconciliation: reconciliation.detail },
    durationMs,
    triggeredBy,
    alertDispatched: false,
  };
  const runId = await deps.persistRun(row).catch((err) => {
    console.warn("[finance-integrity-guard] persist failed:", errMsg(err));
    return null;
  });

  let alertDispatched = false;
  if (rollup.shouldAlert) {
    await deps.notify({
      eventType: "finance_integrity_drift",
      title: "Finance integrity guard found DRIFT",
      body:
        `${summary} The frozen finance numbers are diverging from the golden oracle / across surfaces — ` +
        `data or an integration changed under the freeze. Review the finance-health view.`,
      entityId: runId ?? 1,
      critical: true,
    });
    alertDispatched = true;
    if (runId != null) await deps.markAlerted(runId).catch(() => {});
  }

  // The guard counts as a successful RUN unless it could not execute at all
  // (every check errored) — a drift result means the guard did its job.
  await deps
    .recordHeartbeat({
      jobKey: FINANCE_INTEGRITY_JOB_KEY,
      status: rollup.status === "error" ? "failure" : "success",
      startedAt,
      finishedAt,
      error: rollup.status === "error" ? summary : null,
      metadata: { status: rollup.status, driftCount: rollup.driftCount },
    })
    .catch(() => {});

  return {
    runId,
    status: rollup.status,
    driftCount: rollup.driftCount,
    golden,
    crossSurface,
    reconciliation,
    alertDispatched,
    durationMs,
    summary,
  };
}

function buildSummary(
  status: IntegrityCheckOutcome,
  driftCount: number,
  checks: { golden: CheckReport; crossSurface: CheckReport; reconciliation: CheckReport },
): string {
  const part = (label: string, c: CheckReport): string => `${label}=${c.outcome}${c.driftCount ? `(${c.driftCount})` : ""}`;
  const checksStr = [
    part("golden", checks.golden),
    part("cross-surface", checks.crossSurface),
    part("reconciliation", checks.reconciliation),
  ].join(", ");
  const head =
    status === "drift"
      ? `DRIFT (${driftCount} finding${driftCount === 1 ? "" : "s"})`
      : status === "error"
        ? "ERROR (a check could not run)"
        : status === "skipped"
          ? "SKIPPED (environment not eligible)"
          : "PASS";
  return `Integrity guard: ${head} — ${checksStr}.`;
}

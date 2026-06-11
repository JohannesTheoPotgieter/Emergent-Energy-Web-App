/**
 * Finance job heartbeats — the dead-man's switch.
 *
 * Every monitored finance scheduled job calls `recordFinanceJobRun()` on each
 * run; `sweepFinanceJobHeartbeats()` (driven by the finance watchdog) reads the
 * last success against each job's expected interval and pages the owner when a
 * job stops succeeding — INCLUDING a job that silently died and is recording
 * nothing, which the reactive integration-run alerting can never catch.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { financeJobHeartbeats, type FinanceJobHeartbeat, type FinanceJobHealthState } from "@shared/schema";
import {
  FINANCE_JOBS,
  getFinanceJob,
  resolveJobConfig,
  deriveJobHeartbeatState,
  shouldAlertJobTransition,
  type FinanceJobDescriptor,
} from "../../lib/finance-observability";
import { notifyFinanceOwner } from "./notify";

const MAX_ERR = 1000;

/**
 * Idempotent seed: one heartbeat row per registered job so the dead-man's
 * switch can detect a scheduler that NEVER started (the row's createdAt is the
 * "registered at" anchor). Safe to call on every boot.
 */
export async function registerFinanceJobHeartbeats(): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const job of FINANCE_JOBS) {
    const existing = await db
      .select({ id: financeJobHeartbeats.id })
      .from(financeJobHeartbeats)
      .where(eq(financeJobHeartbeats.jobKey, job.key))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(financeJobHeartbeats).values({ jobKey: job.key });
    inserted += 1;
  }
  return { inserted };
}

export interface RecordFinanceJobRunParams {
  jobKey: string;
  status: "success" | "failure";
  startedAt: Date;
  finishedAt?: Date;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Upsert a job's heartbeat from one run. Auto-registers the row if missing so a
 * job can self-register the first time it runs.
 */
export async function recordFinanceJobRun(params: RecordFinanceJobRunParams): Promise<void> {
  const finishedAt = params.finishedAt ?? new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - params.startedAt.getTime());
  const isSuccess = params.status === "success";
  const errText = params.error ? String(params.error).slice(0, MAX_ERR) : null;
  const metadata = (params.metadata as unknown) ?? null;

  const baseSet = {
    lastStartedAt: params.startedAt,
    lastStatus: params.status,
    lastDurationMs: durationMs,
    runCount: sql`${financeJobHeartbeats.runCount} + 1`,
    metadata,
    updatedAt: new Date(),
  };
  const set = isSuccess
    ? { ...baseSet, lastSuccessAt: finishedAt, consecutiveFailures: 0 }
    : {
        ...baseSet,
        lastFailureAt: finishedAt,
        lastError: errText,
        consecutiveFailures: sql`${financeJobHeartbeats.consecutiveFailures} + 1`,
      };

  await db
    .insert(financeJobHeartbeats)
    .values({
      jobKey: params.jobKey,
      lastStartedAt: params.startedAt,
      lastSuccessAt: isSuccess ? finishedAt : null,
      lastFailureAt: isSuccess ? null : finishedAt,
      lastStatus: params.status,
      lastDurationMs: durationMs,
      lastError: isSuccess ? null : errText,
      consecutiveFailures: isSuccess ? 0 : 1,
      runCount: 1,
      metadata,
    })
    .onConflictDoUpdate({ target: financeJobHeartbeats.jobKey, set });
}

export interface JobHeartbeatStatus {
  job: FinanceJobDescriptor;
  state: FinanceJobHealthState;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  ageMs: number | null;
  expectedIntervalMs: number;
  graceMs: number;
}

/** Read every registered job's current heartbeat status (derived on read). */
export async function getJobHeartbeatStatuses(now: Date = new Date()): Promise<JobHeartbeatStatus[]> {
  const rows = (await db.select().from(financeJobHeartbeats)) as FinanceJobHeartbeat[];
  const byKey = new Map(rows.map((r) => [r.jobKey, r]));

  return FINANCE_JOBS.map((base) => {
    const job = resolveJobConfig(base);
    const row = byKey.get(job.key);
    const state = deriveJobHeartbeatState({
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastFailureAt: row?.lastFailureAt ?? null,
      lastStatus: row?.lastStatus ?? null,
      registeredAt: row?.createdAt ?? null,
      expectedIntervalMs: job.expectedIntervalMs,
      graceMs: job.graceMs,
      now,
    });
    return {
      job,
      state,
      lastSuccessAt: row?.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
      lastFailureAt: row?.lastFailureAt ? row.lastFailureAt.toISOString() : null,
      lastStatus: row?.lastStatus ?? null,
      lastError: row?.lastError ?? null,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      ageMs: row?.lastSuccessAt ? now.getTime() - row.lastSuccessAt.getTime() : null,
      expectedIntervalMs: job.expectedIntervalMs,
      graceMs: job.graceMs,
    };
  });
}

export interface HeartbeatSweepResult {
  checked: number;
  fired: number;
  transitions: Array<{ jobKey: string; prev: string | null; next: FinanceJobHealthState; reason: string }>;
}

/** Injectable seams so the sweep is testable without a live DB. */
export interface HeartbeatSweepDeps {
  loadRows: () => Promise<FinanceJobHeartbeat[]>;
  persistAlertState: (id: number, next: FinanceJobHealthState, fired: boolean, now: Date) => Promise<void>;
  notify: (payload: Parameters<typeof notifyFinanceOwner>[0]) => Promise<void>;
}

const defaultHeartbeatSweepDeps: HeartbeatSweepDeps = {
  loadRows: async () => (await db.select().from(financeJobHeartbeats)) as FinanceJobHeartbeat[],
  persistAlertState: async (id, next, fired, now) => {
    await db
      .update(financeJobHeartbeats)
      .set({ lastAlertState: next, updatedAt: now, ...(fired ? { lastAlertAt: now } : {}) })
      .where(eq(financeJobHeartbeats.id, id));
  },
  notify: notifyFinanceOwner,
};

/**
 * The dead-man's switch. For each registered job: derive its current state,
 * compare to the last state we paged on (persisted as lastAlertState so a
 * sustained outage doesn't re-page every sweep), and dispatch on transition.
 */
export async function sweepFinanceJobHeartbeats(
  now: Date = new Date(),
  deps: HeartbeatSweepDeps = defaultHeartbeatSweepDeps,
): Promise<HeartbeatSweepResult> {
  const rows = await deps.loadRows();
  const byKey = new Map(rows.map((r) => [r.jobKey, r]));
  const result: HeartbeatSweepResult = { checked: 0, fired: 0, transitions: [] };

  for (const base of FINANCE_JOBS) {
    const job = resolveJobConfig(base);
    const row = byKey.get(job.key);
    result.checked += 1;

    const next = deriveJobHeartbeatState({
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastFailureAt: row?.lastFailureAt ?? null,
      lastStatus: row?.lastStatus ?? null,
      registeredAt: row?.createdAt ?? null,
      expectedIntervalMs: job.expectedIntervalMs,
      graceMs: job.graceMs,
      now,
    });
    const prev = (row?.lastAlertState as FinanceJobHealthState | null) ?? null;
    const reason = shouldAlertJobTransition({ prev, next });

    // Persist the state regardless of firing — that's what stops re-paging.
    if (row && prev !== next) {
      await deps.persistAlertState(row.id, next, reason !== null, now);
    }

    if (!reason) continue;
    result.fired += 1;
    result.transitions.push({ jobKey: job.key, prev, next, reason });
    await deps.notify(buildHeartbeatAlert(job, reason, row, now));
  }

  return result;
}

function buildHeartbeatAlert(
  job: FinanceJobDescriptor,
  reason: NonNullable<ReturnType<typeof shouldAlertJobTransition>>,
  row: FinanceJobHeartbeat | undefined,
  now: Date,
): Parameters<typeof notifyFinanceOwner>[0] {
  const lastOk = row?.lastSuccessAt ? `${ageHours(row.lastSuccessAt, now)}h ago` : "never";
  const entityId = row?.id ?? hashKey(job.key);

  if (reason === "recovered_to_healthy") {
    return {
      eventType: "finance_job_recovered",
      title: `Finance job recovered: ${job.displayName}`,
      body: `${job.displayName} is succeeding again.`,
      alertTarget: job.alertTarget,
      entityId,
      critical: false,
    };
  }

  if (reason === "now_failing") {
    const fails = row?.consecutiveFailures ?? 1;
    return {
      eventType: "finance_job_failing",
      title: `Finance job FAILING: ${job.displayName}`,
      body:
        `${job.displayName} has failed ${fails} time(s) in a row (last success ${lastOk}). ` +
        `${job.impact}${row?.lastError ? ` Last error: ${row.lastError}` : ""}`,
      alertTarget: job.alertTarget,
      entityId,
      critical: job.critical,
    };
  }

  // now_stale
  return {
    eventType: "finance_job_stale",
    title: `Finance job STALE: ${job.displayName}`,
    body:
      `${job.displayName} has not succeeded within its expected window (last success ${lastOk}). ` +
      `The scheduler may be dead. ${job.impact}`,
    alertTarget: job.alertTarget,
    entityId,
    critical: job.critical,
  };
}

function ageHours(then: Date, now: Date): string {
  return ((now.getTime() - then.getTime()) / (60 * 60 * 1000)).toFixed(1);
}

/** Stable small-int fallback entityId when no row exists yet (throttle key). */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 1_000_000;
  return h;
}

/** Re-export so callers don't need to know the registry lives elsewhere. */
export { getFinanceJob };

/**
 * Finance observability — freeze-hardening monitoring surface.
 *
 * Two append/upsert tables that make the finance pipeline's silent failure
 * modes loud during the unattended 6-month freeze:
 *
 *   finance_job_heartbeats  — one row per registered finance scheduled job
 *                             (dead-man's switch). Every job upserts its last
 *                             start / success / failure here; an active sweep
 *                             reads this against each job's expected interval
 *                             (held in the code registry, server/lib/
 *                             finance-observability.ts) and pages the owner
 *                             when a job stops succeeding — even when the job
 *                             is completely dead and recording nothing else.
 *
 *   finance_integrity_runs  — one row per weekly integrity-guard run
 *                             (verify:finance cross-surface + reconciliation,
 *                             read-only against prod). The freeze's safety net:
 *                             since the finance code is frozen, this catches
 *                             DATA / integration drift a human needs to know about.
 *
 * Both are additive and observability-only — they hold NO finance figures and
 * gate NO finance computation. Read paths stay the canonical single read path.
 */

import { pgTable, text, integer, timestamp, serial, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ===================== JOB HEARTBEATS =====================

/** Last observed run status for a heartbeat row. */
export const FINANCE_JOB_RUN_STATUSES = ["running", "success", "failure"] as const;
export type FinanceJobRunStatus = (typeof FINANCE_JOB_RUN_STATUSES)[number];

/**
 * Derived liveness state — computed on read from lastSuccessAt vs the job's
 * expected interval (never stored as the live truth; lastAlertState below is
 * only the dedup memory of the last state we PAGED on).
 *   healthy : succeeded within (interval + grace)
 *   stale   : no success within (interval + grace), last run not a failure
 *   failing : last run failed and is newer than the last success
 *   unknown : never recorded a run
 */
export const FINANCE_JOB_HEALTH_STATES = ["healthy", "stale", "failing", "unknown"] as const;
export type FinanceJobHealthState = (typeof FINANCE_JOB_HEALTH_STATES)[number];

/**
 * One row per registered finance job. Upserted by `recordFinanceJobRun()`;
 * the interval/criticality config lives in the code registry so thresholds
 * can be tuned without a migration.
 */
export const financeJobHeartbeats = pgTable("finance_job_heartbeats", {
  id: serial("id").primaryKey(),
  /** Stable machine key matching the code registry, e.g. 'derived-project-kpis'. */
  jobKey: text("job_key").notNull().unique(),
  /** Wall-clock start of the most recent run attempt. */
  lastStartedAt: timestamp("last_started_at"),
  /** Wall-clock time of the most recent SUCCESSFUL run. Drives staleness. */
  lastSuccessAt: timestamp("last_success_at"),
  /** Wall-clock time of the most recent FAILED run. */
  lastFailureAt: timestamp("last_failure_at"),
  /** running | success | failure — status of the most recent run. */
  lastStatus: text("last_status"),
  /** Duration of the most recent finished run, ms. */
  lastDurationMs: integer("last_duration_ms"),
  /** Error detail from the most recent failure (truncated). */
  lastError: text("last_error"),
  /** Consecutive failures since the last success — escalates the page copy. */
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  /** Total runs recorded (lifetime). */
  runCount: integer("run_count").notNull().default(0),
  /** Last liveness state we DISPATCHED a page for. Stops re-paging a sustained outage. */
  lastAlertState: text("last_alert_state"),
  /** When the last page fired. */
  lastAlertAt: timestamp("last_alert_at"),
  /** Free-form per-run detail (counts, ids). */
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFinanceJobHeartbeatSchema = createInsertSchema(financeJobHeartbeats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
} as any);
export type InsertFinanceJobHeartbeat = z.infer<typeof insertFinanceJobHeartbeatSchema>;
export type FinanceJobHeartbeat = typeof financeJobHeartbeats.$inferSelect;

// ===================== INTEGRITY GUARD RUNS =====================

/**
 * Outcome of one integrity-guard check (or the run overall):
 *   pass    — all green
 *   drift   — a tie broke / surfaces disagreed (the alert-worthy case)
 *   error   — the check could not run (exception)
 *   skipped — environment not eligible (e.g. SQLite dev, or missing RO views);
 *             reports environment health only, never finance trust (S7/S9)
 */
export const FINANCE_INTEGRITY_OUTCOMES = ["pass", "drift", "error", "skipped"] as const;
export type FinanceIntegrityOutcome = (typeof FINANCE_INTEGRITY_OUTCOMES)[number];

/**
 * One row per integrity-guard run. The latest row drives the on-demand
 * finance-health view and the monthly digest; the history is the drift trail.
 */
export const financeIntegrityRuns = pgTable("finance_integrity_runs", {
  id: serial("id").primaryKey(),
  /** 'scheduled' | 'manual' */
  runType: text("run_type").notNull().default("scheduled"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  /** Roll-up outcome across all checks. */
  status: text("status").notNull(),
  /** Deprecated — retained nullable for historical rows; the golden-oracle
   *  check was removed, so new runs leave this null. */
  goldenStatus: text("golden_status"),
  /** verify:finance cross-surface equality outcome. */
  crossSurfaceStatus: text("cross_surface_status"),
  /** verify:finance reconciliation (app==tracker, tracker==QB) outcome. */
  reconciliationStatus: text("reconciliation_status"),
  /** Total number of drift findings across all checks. */
  driftCount: integer("drift_count").notNull().default(0),
  /** Human-readable one-line summary for the digest / inbox. */
  summary: text("summary"),
  /** Structured per-check detail (counts, a sample of drift rows). */
  detail: jsonb("detail"),
  durationMs: integer("duration_ms"),
  /** 'scheduler' | a user id/email when manually triggered. */
  triggeredBy: text("triggered_by"),
  /** True when this run dispatched a drift alert. */
  alertDispatched: boolean("alert_dispatched").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFinanceIntegrityRunSchema = createInsertSchema(financeIntegrityRuns).omit({
  id: true,
  createdAt: true,
} as any);
export type InsertFinanceIntegrityRun = z.infer<typeof insertFinanceIntegrityRunSchema>;
export type FinanceIntegrityRun = typeof financeIntegrityRuns.$inferSelect;

/**
 * Finance observability — pure core.
 *
 * The registry of monitored finance jobs and ALL the threshold / transition
 * decision logic, kept side-effect-free so the unit tests can pin every alert
 * boundary without a DB, a queue, or a clock. The services in
 * server/services/finance-observability/* wire these decisions to the real
 * heartbeat table, the dispatchAlert pipeline, and the schedulers.
 *
 * Nothing here reads or writes finance figures — this is monitoring only.
 */

import type { FinanceJobHealthState } from "@shared/schema";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ===================== JOB REGISTRY =====================

/**
 * A monitored finance scheduled job. `expectedIntervalMs` is how often the
 * job should SUCCEED; `graceMs` is the extra slack before we call it stale
 * (covers jitter, a single missed tick, and clock skew). `critical` jobs
 * also escalate to the best-effort Teams channel on top of the COO inbox.
 *
 * Intervals can be tuned during the freeze without a deploy via the env
 * override `FINANCE_JOB_<KEY_UPPER_SNAKE>_INTERVAL_MS` (see resolveJobConfig).
 */
export interface FinanceJobDescriptor {
  key: string;
  displayName: string;
  /** What goes dark when this job dies — shown in the page body. */
  impact: string;
  expectedIntervalMs: number;
  graceMs: number;
  /** Role to page (resolved to user ids at dispatch time). */
  alertTarget: string;
  critical: boolean;
}

const COO = "COO_ADMIN";

export const FINANCE_JOBS: readonly FinanceJobDescriptor[] = [
  {
    key: "derived-project-kpis",
    displayName: "Derived project KPIs cache",
    impact:
      "The priority dashboard, project-header finance tiles and strategic chain view will show increasingly stale numbers.",
    expectedIntervalMs: 15 * MINUTE,
    graceMs: 75 * MINUTE, // stale after ~90 min of no success
    alertTarget: COO,
    critical: false,
  },
  {
    key: "qb-recon-refresh",
    displayName: "Tracker-vs-QuickBooks reconciliation refresh",
    impact:
      "Tracker-vs-QB reconciliation (GP3) stops refreshing — QB drift would go unnoticed.",
    expectedIntervalMs: DAY,
    graceMs: 4 * HOUR, // stale after ~28h
    alertTarget: COO,
    critical: true,
  },
  {
    key: "qb-payment-refresh",
    displayName: "QuickBooks payment-status refresh",
    impact:
      "AR/AP settlement status (GP4) and the cashflow paid/unpaid signal stop updating from QuickBooks.",
    expectedIntervalMs: DAY,
    graceMs: 4 * HOUR,
    alertTarget: COO,
    critical: false,
  },
  {
    key: "tracker-import",
    displayName: "Tracker Smart Import (SharePoint)",
    impact:
      "No new tracker data is reaching the app — every finance figure is frozen at the last import.",
    // Generous: trackers are not edited daily during a freeze. A whole week
    // with no import means either the scheduler is dead or the source went
    // quiet — both worth a nudge. The softer 'no import in N days' freshness
    // warning fires earlier (see freshness service).
    expectedIntervalMs: 7 * DAY,
    graceMs: DAY,
    alertTarget: COO,
    critical: true,
  },
  {
    key: "finance-integrity-guard",
    displayName: "Weekly finance integrity guard",
    impact:
      "The freeze's safety net stopped running — data/integration drift against the golden oracle would go undetected.",
    expectedIntervalMs: 7 * DAY,
    graceMs: 2 * DAY,
    alertTarget: COO,
    critical: true,
  },
] as const;

const JOB_BY_KEY = new Map(FINANCE_JOBS.map((j) => [j.key, j]));

export function getFinanceJob(key: string): FinanceJobDescriptor | undefined {
  return JOB_BY_KEY.get(key);
}

/**
 * Resolve a job's effective config, applying any env interval override.
 * Pure given `env` (defaults to process.env). Override is in milliseconds:
 *   FINANCE_JOB_DERIVED_PROJECT_KPIS_INTERVAL_MS=5400000
 */
export function resolveJobConfig(
  job: FinanceJobDescriptor,
  env: NodeJS.ProcessEnv = process.env,
): FinanceJobDescriptor {
  const envKey = `FINANCE_JOB_${job.key.replace(/-/g, "_").toUpperCase()}_INTERVAL_MS`;
  const raw = env[envKey];
  if (!raw) return job;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return job;
  return { ...job, expectedIntervalMs: parsed };
}

// ===================== JOB HEARTBEAT STATE =====================

export interface JobHeartbeatInput {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastStatus: string | null;
  expectedIntervalMs: number;
  graceMs: number;
  /**
   * When the heartbeat row was first registered (seeded at boot). Lets the
   * dead-man's switch catch a scheduler that never STARTED: a job with no run
   * at all, registered longer ago than its window, is stale (not merely
   * unknown). Null/undefined means "no registration anchor" → unknown.
   */
  registeredAt?: Date | null;
  now?: Date;
}

/**
 * PURE: derive a job's liveness state. Mirrors deriveIntegrationHealth but
 * uses the job's OWN expected interval (+grace) instead of a fixed 25h window,
 * which is the whole point of the dead-man's switch for sub-daily jobs.
 */
export function deriveJobHeartbeatState(input: JobHeartbeatInput): FinanceJobHealthState {
  const now = input.now ?? new Date();
  const { lastSuccessAt, lastFailureAt, lastStatus, registeredAt } = input;
  const window = input.expectedIntervalMs + input.graceMs;

  // A failure newer than (or equal to) the last success means it's failing.
  if (lastFailureAt && (!lastSuccessAt || lastFailureAt >= lastSuccessAt)) {
    return "failing";
  }

  if (!lastSuccessAt) {
    if (lastStatus === "failure") return "failing";
    // Registered but never produced a success. Within the first expected window
    // it's genuinely unknown; past it, the scheduler is presumed dead → stale.
    if (registeredAt && now.getTime() - registeredAt.getTime() > window) return "stale";
    return "unknown";
  }

  const ageMs = now.getTime() - lastSuccessAt.getTime();
  return ageMs <= window ? "healthy" : "stale";
}

export type JobAlertReason = "now_failing" | "now_stale" | "recovered_to_healthy" | null;

/**
 * PURE: heartbeat transition rule. Unlike the integration-health rule (which
 * suppresses everything touching 'unknown' to avoid boot noise), this DOES
 * fire 'stale' from any prior state — a registered finance job going stale is
 * always worth a page during the freeze. 'unknown' itself never pages (still
 * inside the first expected window).
 */
export function shouldAlertJobTransition(params: {
  prev: FinanceJobHealthState | null;
  next: FinanceJobHealthState;
}): JobAlertReason {
  const { prev, next } = params;
  if (prev === next) return null;
  if (next === "unknown") return null;
  if (next === "failing") return "now_failing";
  if (next === "stale") return "now_stale";
  if (next === "healthy" && (prev === "failing" || prev === "stale")) {
    return "recovered_to_healthy";
  }
  return null;
}

// ===================== FRESHNESS THRESHOLDS =====================

/** Tunable freshness thresholds (env-overridable for the freeze). */
export interface FreshnessThresholds {
  /** Page when no tracker import has succeeded in this long. */
  trackerImportMaxAgeMs: number;
  /** Page when the tracker-vs-QB reconciliation snapshot is older than this. */
  qbReconMaxAgeMs: number;
  /** Page when company tracker-vs-QB |variance| exceeds this many Rand. */
  trackerVsQbVarianceRand: number;
  /** Page when this many project×period app-vs-tracker checks are non-green (drift/structural). */
  appVsTrackerDriftCount: number;
}

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  trackerImportMaxAgeMs: 4 * DAY,
  qbReconMaxAgeMs: 2 * DAY,
  trackerVsQbVarianceRand: 1000,
  appVsTrackerDriftCount: 1,
};

export function resolveFreshnessThresholds(
  env: NodeJS.ProcessEnv = process.env,
  base: FreshnessThresholds = DEFAULT_FRESHNESS_THRESHOLDS,
): FreshnessThresholds {
  const numEnv = (key: string, fallback: number): number => {
    const raw = env[key];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    trackerImportMaxAgeMs: numEnv("FINANCE_FRESHNESS_TRACKER_IMPORT_MAX_AGE_MS", base.trackerImportMaxAgeMs),
    qbReconMaxAgeMs: numEnv("FINANCE_FRESHNESS_QB_RECON_MAX_AGE_MS", base.qbReconMaxAgeMs),
    trackerVsQbVarianceRand: numEnv("FINANCE_FRESHNESS_TRACKER_VS_QB_VARIANCE_RAND", base.trackerVsQbVarianceRand),
    appVsTrackerDriftCount: numEnv("FINANCE_FRESHNESS_APP_VS_TRACKER_DRIFT_COUNT", base.appVsTrackerDriftCount),
  };
}

export type FreshnessSignalKey =
  | "tracker_import_stale"
  | "qb_recon_stale"
  | "tracker_vs_qb_variance"
  | "app_vs_tracker_drift";

export interface FreshnessSignal {
  key: FreshnessSignalKey;
  breached: boolean;
  /** Observed value (ms age, or Rand, or count). */
  value: number | null;
  /** Threshold the value is compared against. */
  threshold: number;
  detail: string;
}

export interface FreshnessInput {
  trackerImportAgeMs: number | null;
  qbReconAgeMs: number | null;
  trackerVsQbVarianceRand: number | null;
  appVsTrackerDriftCount: number | null;
}

/**
 * PURE: classify every freshness/drift signal against the thresholds. A null
 * observation is NOT a breach here (the service decides whether "never seen"
 * is itself alert-worthy via the heartbeats), keeping freshness about staleness
 * of a thing that DID exist.
 */
export function classifyFreshness(
  input: FreshnessInput,
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS_THRESHOLDS,
): FreshnessSignal[] {
  const ageH = (ms: number | null): string => (ms == null ? "n/a" : `${(ms / HOUR).toFixed(1)}h`);
  return [
    {
      key: "tracker_import_stale",
      breached: input.trackerImportAgeMs != null && input.trackerImportAgeMs > thresholds.trackerImportMaxAgeMs,
      value: input.trackerImportAgeMs,
      threshold: thresholds.trackerImportMaxAgeMs,
      detail: `Last tracker import ${ageH(input.trackerImportAgeMs)} ago (limit ${ageH(thresholds.trackerImportMaxAgeMs)}).`,
    },
    {
      key: "qb_recon_stale",
      breached: input.qbReconAgeMs != null && input.qbReconAgeMs > thresholds.qbReconMaxAgeMs,
      value: input.qbReconAgeMs,
      threshold: thresholds.qbReconMaxAgeMs,
      detail: `Tracker-vs-QB reconciliation ${ageH(input.qbReconAgeMs)} old (limit ${ageH(thresholds.qbReconMaxAgeMs)}).`,
    },
    {
      key: "tracker_vs_qb_variance",
      breached:
        input.trackerVsQbVarianceRand != null &&
        Math.abs(input.trackerVsQbVarianceRand) > thresholds.trackerVsQbVarianceRand,
      value: input.trackerVsQbVarianceRand,
      threshold: thresholds.trackerVsQbVarianceRand,
      detail: `Company tracker-vs-QB variance R${(input.trackerVsQbVarianceRand ?? 0).toFixed(2)} (limit R${thresholds.trackerVsQbVarianceRand.toFixed(2)}).`,
    },
    {
      key: "app_vs_tracker_drift",
      breached:
        input.appVsTrackerDriftCount != null &&
        input.appVsTrackerDriftCount >= thresholds.appVsTrackerDriftCount,
      value: input.appVsTrackerDriftCount,
      threshold: thresholds.appVsTrackerDriftCount,
      detail: `${input.appVsTrackerDriftCount ?? 0} project×period app-vs-tracker check(s) drifting (limit ${thresholds.appVsTrackerDriftCount}).`,
    },
  ];
}

// ===================== ERROR-RATE THRESHOLD =====================

export interface ErrorRateThresholds {
  windowMs: number;
  /** Page when finance 5xx + unhandled exceptions in the window reach this. */
  countThreshold: number;
}

export const DEFAULT_ERROR_RATE_THRESHOLDS: ErrorRateThresholds = {
  windowMs: 15 * MINUTE,
  countThreshold: 5,
};

export function resolveErrorRateThresholds(
  env: NodeJS.ProcessEnv = process.env,
  base: ErrorRateThresholds = DEFAULT_ERROR_RATE_THRESHOLDS,
): ErrorRateThresholds {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    windowMs: num("FINANCE_ERROR_WINDOW_MS", base.windowMs),
    countThreshold: num("FINANCE_ERROR_COUNT_THRESHOLD", base.countThreshold),
  };
}

/** PURE: is the finance error count over threshold for the window? */
export function isErrorRateBreached(
  countInWindow: number,
  thresholds: ErrorRateThresholds = DEFAULT_ERROR_RATE_THRESHOLDS,
): boolean {
  return countInWindow >= thresholds.countThreshold;
}

// ===================== INTEGRITY OUTCOME ROLL-UP =====================

export type IntegrityCheckOutcome = "pass" | "drift" | "error" | "skipped";

export interface IntegrityCheckResult {
  outcome: IntegrityCheckOutcome;
  driftCount: number;
}

export interface IntegrityRollup {
  status: IntegrityCheckOutcome;
  driftCount: number;
  /** True when a human needs to look — any check drifted. */
  shouldAlert: boolean;
}

/**
 * PURE: roll three check results into one outcome.
 *   drift   if ANY check drifted (alert-worthy)
 *   error   else if any check errored
 *   skipped else if every check skipped (env not eligible — no finance trust signal)
 *   pass    otherwise (at least one real check ran and all green)
 */
export function rollupIntegrity(checks: readonly IntegrityCheckResult[]): IntegrityRollup {
  const driftCount = checks.reduce((sum, c) => sum + (c.outcome === "drift" ? c.driftCount : 0), 0);
  const anyDrift = checks.some((c) => c.outcome === "drift");
  const anyError = checks.some((c) => c.outcome === "error");
  const allSkipped = checks.length > 0 && checks.every((c) => c.outcome === "skipped");

  let status: IntegrityCheckOutcome;
  if (anyDrift) status = "drift";
  else if (anyError) status = "error";
  else if (allSkipped) status = "skipped";
  else status = "pass";

  return { status, driftCount, shouldAlert: anyDrift };
}

// ===================== OVERALL HEALTH ROLL-UP =====================

export type FinanceHealthLevel = "healthy" | "warn" | "critical" | "unknown";

const LEVEL_RANK: Record<FinanceHealthLevel, number> = {
  critical: 3,
  warn: 2,
  unknown: 1,
  healthy: 0,
};

/** PURE: worst-wins roll-up of component health levels. */
export function worstHealthLevel(levels: readonly FinanceHealthLevel[]): FinanceHealthLevel {
  if (levels.length === 0) return "unknown";
  return levels.reduce((acc, l) => (LEVEL_RANK[l] >= LEVEL_RANK[acc] ? l : acc), "healthy");
}

/** Map a job/integration health state to the coarse finance-health level. */
export function jobStateToLevel(state: FinanceJobHealthState): FinanceHealthLevel {
  switch (state) {
    case "failing":
      return "critical";
    case "stale":
      return "warn";
    case "unknown":
      return "unknown";
    case "healthy":
      return "healthy";
  }
}

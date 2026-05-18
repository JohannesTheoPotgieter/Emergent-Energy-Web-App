/**
 * B5 (audit closeout) — COS period auto-lock scheduler.
 *
 * Runs a daily check. When today (in SAST) is the 3rd business day of
 * the current month, the previous month is automatically locked.
 * Business days = Monday..Friday MINUS South African public holidays
 * from the calendar_holiday table.
 *
 * Resilience:
 *   - Idempotent: if the previous month is already locked (auto or
 *     manual), the scheduler is a no-op.
 *   - Fault-tolerant: a failure in one run does not take down the
 *     server; errors are logged and the next run tries again.
 *   - Catch-up: if the scheduler missed a day (e.g. the server was
 *     down on the 3rd business day), the next run re-checks the same
 *     calendar logic and will still lock if the target day has passed.
 *     Specifically: when today >= 3rd business day of this month AND
 *     the previous month has no active lock, auto-lock now.
 *
 * Startup wiring:
 *   server/bootstrap/startup-orchestrator.ts imports
 *   scheduleCosPeriodAutoLock() and calls it after DB init.
 */

import { db } from "../db";
import { cosPeriodLocks } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  loadZaHolidays,
  nthBusinessDayOfMonth,
  previousMonthFirst,
  toIsoDateSast,
} from "../lib/finance/period-lock";
import logger from "../lib/logger";

const DAILY_MS = 24 * 60 * 60 * 1000;
const JITTER_MS = 60 * 1000; // ±60s jitter so multiple instances do not all fire at once

let scheduledInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;
let schemaEnsured = false;

async function ensureCosPeriodLocksTable(): Promise<void> {
  if (schemaEnsured) return;

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS cos_period_locks (
      id SERIAL PRIMARY KEY,
      period_month DATE NOT NULL,
      locked_at TIMESTAMP NOT NULL DEFAULT NOW(),
      locked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      auto_locked BOOLEAN NOT NULL DEFAULT FALSE,
      unlocked_at TIMESTAMP NULL,
      unlocked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      unlock_reason TEXT NULL,
      notes TEXT NULL,
      CONSTRAINT uq_cos_period_locks_period UNIQUE (period_month),
      CONSTRAINT chk_cos_period_locks_month_is_first_of_month
        CHECK (date_trunc('month', period_month::timestamp)::date = period_month),
      CONSTRAINT chk_cos_period_locks_unlock_consistency
        CHECK (
          (unlocked_at IS NULL AND unlocked_by_user_id IS NULL AND unlock_reason IS NULL)
          OR
          (unlocked_at IS NOT NULL)
        )
    );
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cos_period_locks_period
      ON cos_period_locks(period_month);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cos_period_locks_active
      ON cos_period_locks(period_month)
      WHERE unlocked_at IS NULL;
  `));

  schemaEnsured = true;
}

/**
 * Run one pass of the auto-lock check. Exported for manual trigger
 * (e.g. admin debug endpoint, unit tests, catch-up run after a
 * schema migration).
 */
export async function runCosPeriodAutoLockCheck(opts?: { now?: Date }): Promise<{
  ranAt: string;
  targetMonth: string | null;
  autoLocked: boolean;
  reason: string;
}> {
  await ensureCosPeriodLocksTable();

  const now = opts?.now ?? new Date();
  const today = toIsoDateSast(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));

  const holidays = await loadZaHolidays();
  const thirdBusinessDay = nthBusinessDayOfMonth(y, m, 3, holidays);

  // Catch-up rule: if today is AT OR AFTER the 3rd business day of the
  // current month, we want to make sure the previous month is locked.
  if (today < thirdBusinessDay) {
    return {
      ranAt: today,
      targetMonth: null,
      autoLocked: false,
      reason: `Today (${today}) is before the 3rd business day of the month (${thirdBusinessDay}). No auto-lock yet.`,
    };
  }

  const prevMonth = previousMonthFirst(now);

  // Already locked? No-op.
  const existing = await db
    .select()
    .from(cosPeriodLocks)
    .where(
      and(
        eq(cosPeriodLocks.periodMonth, prevMonth),
        isNull(cosPeriodLocks.unlockedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return {
      ranAt: today,
      targetMonth: prevMonth,
      autoLocked: false,
      reason: `Period ${prevMonth} already has an active lock — no action needed.`,
    };
  }

  // Auto-lock gate: stage the lock proposal in the Pending Approval inbox
  // instead of locking the period directly. A user must release it from
  // /pending-approvals; on approval the handler re-attributes the lock to
  // the approver (autoLocked = false, lockedByUserId = approver).
  const { proposeApproval } = await import("../services/pending-approvals-service");
  await proposeApproval({
    kind: "cos_period_lock_create",
    targetTable: "cos_period_locks",
    summary: `Lock COS period ${prevMonth} (proposed on ${today}, 3rd business day of ${today.slice(0, 7)})`,
    payload: {
      periodMonth: prevMonth,
      notes: `Auto-proposed by scheduled job on ${today} (3rd business day of ${today.slice(0, 7)}).`,
    } as Record<string, unknown>,
    sourceLabel: "system:cos-period-lock-scheduler",
    sourceRef: `cos-period:${prevMonth}`,
  });

  logger.info(`[cos-period-lock] Proposed lock for ${prevMonth} (awaiting approval).`);
  return {
    ranAt: today,
    targetMonth: prevMonth,
    autoLocked: true,
    reason: `Locked ${prevMonth} because today (${today}) is the 3rd business day of ${today.slice(0, 7)}.`,
  };
}

/**
 * Wire the scheduler into the server lifecycle. Call this once at
 * boot time. The scheduler:
 *   - Runs one check immediately (covers the case where the server
 *     was down on the 3rd business day).
 *   - Then runs every 24 hours with a small jitter.
 *   - Is a no-op on any run where the target month is already locked.
 */
export function scheduleCosPeriodAutoLock(): void {
  if (scheduledInterval) return;

  const safeRun = async () => {
    try {
      const today = toIsoDateSast(new Date());
      if (lastRunDate === today) return; // already ran today
      lastRunDate = today;
      await runCosPeriodAutoLockCheck();
    } catch (err) {
      logger.error("[cos-period-lock] Scheduler run failed:", err);
    }
  };

  // Fire once at startup.
  void safeRun();

  // Then every 24 hours ±60s jitter.
  const jitter = Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
  scheduledInterval = setInterval(safeRun, DAILY_MS + jitter);
  if (typeof scheduledInterval.unref === "function") {
    scheduledInterval.unref();
  }
  logger.info("[cos-period-lock] Auto-lock scheduler registered (daily + 1 immediate run).");
}

/** Testing hook — stop the scheduler and reset state. */
export function stopCosPeriodAutoLockForTests(): void {
  if (scheduledInterval) {
    clearInterval(scheduledInterval);
    scheduledInterval = null;
  }
  lastRunDate = null;
}

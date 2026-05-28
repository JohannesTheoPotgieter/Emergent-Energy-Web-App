/**
 * TF-28 (audit V3) — VAT period tracking service.
 *
 * SA VAT is bi-monthly. Category A vendors close at the end of Feb,
 * Apr, Jun, Aug, Oct, Dec. Category B vendors close on the opposite
 * months. This service supports either by accepting a `periodMonth`
 * (always the first-of-month of the close period — e.g. 2026-04-01
 * for the Mar-Apr 2026 period).
 *
 * After a period is locked:
 *   - The lock is recorded with the operator id + timestamp.
 *   - Output/input VAT totals at lock time are captured so a later
 *     reconciliation can compare current totals against the submitted
 *     ones.
 *   - The cost/revenue line PATCH gate (TF-20) refuses paid_date /
 *     invoice_date edits whose effective month falls inside a locked
 *     period unless the operator has financials:approve and supplies
 *     an unlock reason.
 *
 * Unlock is soft: the row stays, its `unlocked_at / unlocked_by` is
 * stamped, and the audit trail shows the full lock → unlock history.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { vatPeriodLocks } from "@shared/schema";

export interface VatPeriodLockSummary {
  id: number;
  periodMonth: string;
  lockedAt: Date;
  lockedByUserId: number | null;
  vat201SubmissionRef: string | null;
  outputVatTotal: string | null;
  inputVatTotal: string | null;
}

/**
 * Returns the active lock for a given period-month (first-of-month),
 * or null if the period is unlocked.
 */
export async function getActiveVatPeriodLock(
  periodMonth: string,
): Promise<VatPeriodLockSummary | null> {
  const [row] = await db
    .select({
      id: vatPeriodLocks.id,
      periodMonth: vatPeriodLocks.periodMonth,
      lockedAt: vatPeriodLocks.lockedAt,
      lockedByUserId: vatPeriodLocks.lockedByUserId,
      vat201SubmissionRef: vatPeriodLocks.vat201SubmissionRef,
      outputVatTotal: vatPeriodLocks.outputVatTotal,
      inputVatTotal: vatPeriodLocks.inputVatTotal,
    })
    .from(vatPeriodLocks)
    .where(
      and(
        eq(vatPeriodLocks.periodMonth, periodMonth),
        isNull(vatPeriodLocks.unlockedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface LockVatPeriodInput {
  /** First-of-month of the bi-monthly close period (e.g. "2026-04-01"). */
  periodMonth: string;
  lockedByUserId: number;
  /** Optional SARS submission reference if known at lock time. */
  vat201SubmissionRef?: string;
  /** Snapshot totals at lock time for later reconciliation. */
  outputVatTotal?: string;
  inputVatTotal?: string;
  notes?: string;
}

export async function lockVatPeriod(input: LockVatPeriodInput): Promise<VatPeriodLockSummary> {
  // Refuse to double-lock a period that is currently locked.
  const existing = await getActiveVatPeriodLock(input.periodMonth);
  if (existing) {
    throw new Error(
      `VAT period ${input.periodMonth} is already locked (id=${existing.id}). Unlock first if you need to change it.`,
    );
  }

  const [created] = await db
    .insert(vatPeriodLocks)
    .values({
      periodMonth: input.periodMonth,
      lockedByUserId: input.lockedByUserId,
      vat201SubmissionRef: input.vat201SubmissionRef ?? null,
      outputVatTotal: input.outputVatTotal ?? null,
      inputVatTotal: input.inputVatTotal ?? null,
      notes: input.notes ?? null,
    })
    .returning({
      id: vatPeriodLocks.id,
      periodMonth: vatPeriodLocks.periodMonth,
      lockedAt: vatPeriodLocks.lockedAt,
      lockedByUserId: vatPeriodLocks.lockedByUserId,
      vat201SubmissionRef: vatPeriodLocks.vat201SubmissionRef,
      outputVatTotal: vatPeriodLocks.outputVatTotal,
      inputVatTotal: vatPeriodLocks.inputVatTotal,
    });
  return created;
}

export interface UnlockVatPeriodInput {
  /** The lock row id (NOT the period-month — same period can be locked twice). */
  lockId: number;
  unlockedByUserId: number;
  /** Free-text reason — required, recorded against the lock row. */
  unlockReason: string;
}

export async function unlockVatPeriod(input: UnlockVatPeriodInput): Promise<void> {
  if (!input.unlockReason || input.unlockReason.trim().length < 10) {
    throw new Error(
      "VAT period unlock requires a reason of at least 10 characters (audit trail).",
    );
  }
  await db
    .update(vatPeriodLocks)
    .set({
      unlockedAt: new Date(),
      unlockedByUserId: input.unlockedByUserId,
      unlockReason: input.unlockReason,
    })
    .where(
      and(
        eq(vatPeriodLocks.id, input.lockId),
        isNull(vatPeriodLocks.unlockedAt),
      ),
    );
}

/**
 * Derive the VAT period (first-of-month) for a given calendar date.
 * Category-A close months are Feb / Apr / Jun / Aug / Oct / Dec.
 * E.g. 15 May → period_month = 2026-06-01 (the Jun close covering May-Jun).
 *
 * Bi-monthly = the period_month is always an EVEN-numbered month.
 */
export function deriveVatPeriodMonth(date: Date, category: "A" | "B" = "A"): string {
  const sast = new Date(date.getTime() + 120 * 60 * 1000);
  const year = sast.getUTCFullYear();
  const month0 = sast.getUTCMonth(); // 0-11
  // For category A, period closes on EVEN months (Feb=1, Apr=3, Jun=5,
  // Aug=7, Oct=9, Dec=11 in 0-indexed). Round up to the next even month.
  // For category B, period closes on ODD months.
  const targetParity = category === "A" ? 1 : 0;
  let periodMonth0 = month0;
  if (month0 % 2 !== targetParity) periodMonth0 = month0 + 1;
  let periodYear = year;
  if (periodMonth0 > 11) {
    periodMonth0 = periodMonth0 - 12;
    periodYear = year + 1;
  }
  const mm = String(periodMonth0 + 1).padStart(2, "0");
  return `${periodYear}-${mm}-01`;
}

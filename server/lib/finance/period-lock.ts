/**
 * B5 (audit closeout) — COS period lock helpers.
 *
 * Responsibilities:
 *   - Business-day arithmetic with South African public holidays.
 *   - Compute the "3rd business day of a month" used by the auto-lock job.
 *   - Check whether a given effective date falls in a currently-locked
 *     period, and whether the caller is allowed to bypass the lock.
 *
 * Design rules (from the follow-up discussion):
 *   - Business days = Monday..Friday MINUS South African public holidays
 *     from the calendar_holiday table (country_code = 'ZA' by default).
 *   - The auto-lock cadence is "3rd business day of the following month".
 *     e.g. March is locked on the 3rd business day of April.
 *   - Bypass / override roles are COO_ADMIN, CEO_ADMIN, CFO. Program
 *     Finance Manager (PFM) can override individual COS recognitions via
 *     B4, but CANNOT bypass a period lock — that requires the stricter
 *     COO/CFO/CEO control.
 *   - This module is timezone-aware: all business-day arithmetic is done
 *     in Africa/Johannesburg (SAST / UTC+2) because that is where the
 *     finance team operates. An invoice dated 2026-03-31 23:59 SAST is
 *     in the March period even though it is already 2026-04-01 UTC.
 */

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { calendarHoliday, cosPeriodLocks } from "@shared/schema";
import { db } from "../../db";

const SAST_OFFSET_MINUTES = 120; // Africa/Johannesburg is UTC+2 year-round (no DST)
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Roles allowed to bypass an active period lock and to unlock a locked
 * period. Deliberately NARROWER than the B4 COS override whitelist —
 * PFM can override individual recognitions (B4) but cannot unlock a
 * whole month.
 */
export const PERIOD_LOCK_OVERRIDE_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "CFO",
]);

// ── Date primitives ──

/**
 * Parse a YYYY-MM-DD or YYYY-MM string into a UTC Date representing
 * midnight SAST of that day. Returns null if the input is falsy or
 * unparseable.
 */
export function parseSastDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input;
  }
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  // Accept YYYY-MM as the first-of-month for convenience.
  const ymMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (ymMatch) {
    const [, y, m] = ymMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1, -SAST_OFFSET_MINUTES / 60, 0, 0));
  }
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), -SAST_OFFSET_MINUTES / 60, 0, 0));
  }
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Return the first day of the SAST month that contains the given date
 * as a YYYY-MM-DD string, e.g. "2026-03-01".
 */
export function firstOfMonthSast(date: Date): string {
  const sast = new Date(date.getTime() + SAST_OFFSET_MINUTES * 60_000);
  const y = sast.getUTCFullYear();
  const m = sast.getUTCMonth();
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Return the YYYY-MM-DD label for a SAST date (no time component).
 */
export function toIsoDateSast(date: Date): string {
  const sast = new Date(date.getTime() + SAST_OFFSET_MINUTES * 60_000);
  const y = sast.getUTCFullYear();
  const m = String(sast.getUTCMonth() + 1).padStart(2, "0");
  const d = String(sast.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Return the month BEFORE the given date as "YYYY-MM-01".
 * Used by the auto-lock job to determine which month it should lock
 * when today is the 3rd business day of the following month.
 */
export function previousMonthFirst(date: Date): string {
  const sast = new Date(date.getTime() + SAST_OFFSET_MINUTES * 60_000);
  const y = sast.getUTCFullYear();
  const m0 = sast.getUTCMonth(); // 0-indexed (Jan=0)
  const prevY = m0 === 0 ? y - 1 : y;
  // DF-34 (audit V2): rename for clarity. This is the 1-indexed previous
  // month (Jan→12 of previous year; Feb→1; …; Dec→11). The string output
  // format wants month numbers 01-12, not 0-indexed. Verified by reading:
  // when m0=1 (February), prevM1Indexed=1 → output "01" (January) ✓.
  // When m0=0 (January), prevM1Indexed=12 → output "12" of previous year ✓.
  const prevM1Indexed = m0 === 0 ? 12 : m0;
  return `${prevY}-${String(prevM1Indexed).padStart(2, "0")}-01`;
}

// ── Business day arithmetic ──

/**
 * Test whether a date (interpreted in SAST) is a weekend day.
 */
export function isWeekendSast(date: Date): boolean {
  const sast = new Date(date.getTime() + SAST_OFFSET_MINUTES * 60_000);
  const day = sast.getUTCDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

/**
 * Test whether a date is in the set of public holidays.
 * The set is expected to contain YYYY-MM-DD strings.
 */
export function isHolidaySast(date: Date, holidays: Set<string>): boolean {
  return holidays.has(toIsoDateSast(date));
}

/**
 * Compute the Nth business day of a month, where:
 *   - N is 1-indexed (N=1 is the first business day).
 *   - A business day is Mon..Fri that is NOT in the holidays set.
 *   - Returns a YYYY-MM-DD string in SAST.
 *
 * If the month has fewer than N business days (e.g. a very holiday-
 * heavy month plus a short calendar month), returns the last business
 * day of the month.
 */
export function nthBusinessDayOfMonth(year: number, month1Based: number, n: number, holidays: Set<string>): string {
  if (n < 1) throw new Error("n must be >= 1");
  // Start at the first of the month in SAST.
  let cursor = new Date(Date.UTC(year, month1Based - 1, 1, -SAST_OFFSET_MINUTES / 60, 0, 0));
  let found = 0;
  let lastBusinessDay: string | null = null;
  // Cap at 35 iterations so we can't spin forever in a pathological month.
  for (let i = 0; i < 35; i += 1) {
    const asSast = new Date(cursor.getTime() + SAST_OFFSET_MINUTES * 60_000);
    if (asSast.getUTCMonth() + 1 !== month1Based) break;     // crossed into next month
    if (!isWeekendSast(cursor) && !isHolidaySast(cursor, holidays)) {
      found += 1;
      lastBusinessDay = toIsoDateSast(cursor);
      if (found === n) return lastBusinessDay;
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  // Fallback: return the last business day we saw, or the 1st if none
  // found at all (truly degenerate case — a month with no business days).
  return lastBusinessDay ?? toIsoDateSast(new Date(Date.UTC(year, month1Based - 1, 1, -SAST_OFFSET_MINUTES / 60, 0, 0)));
}

// ── Holiday loader ──

let holidayCache: { expiresAt: number; set: Set<string> } | null = null;
const HOLIDAY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Load South African public holidays from the calendar_holiday table.
 * Cached for 1 hour. Resilient: if the DB query fails, returns an empty
 * set (weekends-only business-day arithmetic) and logs the error.
 */
export async function loadZaHolidays(forceRefresh = false): Promise<Set<string>> {
  const now = Date.now();
  if (!forceRefresh && holidayCache && holidayCache.expiresAt > now) {
    return holidayCache.set;
  }
  try {
    const rows = await db
      .select({ date: calendarHoliday.date })
      .from(calendarHoliday)
      .where(eq(calendarHoliday.countryCode, "ZA"));
    const set = new Set<string>();
    for (const r of rows) {
      if (r.date) set.add(String(r.date).slice(0, 10));
    }
    holidayCache = { expiresAt: now + HOLIDAY_CACHE_TTL_MS, set };
    return set;
  } catch (err) {
    console.warn("[period-lock] Failed to load ZA holidays — falling back to weekends-only:", err);
    const empty = new Set<string>();
    holidayCache = { expiresAt: now + 60_000, set: empty };
    return empty;
  }
}

/** Testing hook — clear the cache so tests don't leak state. */
export function resetHolidayCacheForTests(): void {
  holidayCache = null;
}

// ── Lock state check ──

export type PeriodLockStatus = {
  period: string;                // YYYY-MM-01
  locked: boolean;
  lockedAt: Date | null;
  lockedByUserId: number | null;
  autoLocked: boolean;
  canOverride: boolean;          // true if the given role is in the bypass whitelist
};

/**
 * Check whether the given effective date is in a currently-locked period.
 * Call this from any write handler that mutates a cost line before doing
 * the DB update.
 *
 * Returns a status object the caller inspects:
 *   - locked === false              -> proceed
 *   - locked && canOverride=false   -> return 423 Locked, block the write
 *   - locked && canOverride=true    -> log a "locked period override" audit
 *                                     entry and proceed
 */
export async function checkCosPeriodLock(params: {
  effectiveDate: string | Date | null | undefined;
  role: string | null | undefined;
}): Promise<PeriodLockStatus | null> {
  const parsed = parseSastDate(params.effectiveDate);
  if (!parsed) return null; // no effective date = no lock to check
  const period = firstOfMonthSast(parsed);

  const rows = await db
    .select()
    .from(cosPeriodLocks)
    .where(
      and(
        eq(cosPeriodLocks.periodMonth, period as any),
        isNull(cosPeriodLocks.unlockedAt),
      ),
    )
    .limit(1);

  const role = String(params.role ?? "");
  const canOverride = PERIOD_LOCK_OVERRIDE_ROLES.has(role);

  if (rows.length === 0) {
    return {
      period,
      locked: false,
      lockedAt: null,
      lockedByUserId: null,
      autoLocked: false,
      canOverride,
    };
  }

  const row = rows[0];
  return {
    period,
    locked: true,
    lockedAt: row.lockedAt,
    lockedByUserId: row.lockedByUserId,
    autoLocked: row.autoLocked,
    canOverride,
  };
}

/**
 * Lock a period. Returns the inserted row id.
 * Caller is responsible for authorising the user — this helper does
 * not check permissions.
 */
export async function lockCosPeriod(params: {
  periodMonth: string;           // YYYY-MM-DD (must be first of month)
  lockedByUserId: number | null;
  autoLocked: boolean;
  notes?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(cosPeriodLocks)
    .values({
      periodMonth: params.periodMonth as any,
      lockedByUserId: params.lockedByUserId,
      autoLocked: params.autoLocked,
      notes: params.notes ?? null,
    })
    .returning({ id: cosPeriodLocks.id });
  return row.id;
}

/**
 * Mark the active lock for a period as unlocked. If there is no active
 * lock, returns false. Otherwise returns the updated row id.
 */
export async function unlockCosPeriod(params: {
  periodMonth: string;           // YYYY-MM-DD
  unlockedByUserId: number | null;
  reason: string;
}): Promise<number | null> {
  const rows = await db
    .select()
    .from(cosPeriodLocks)
    .where(
      and(
        eq(cosPeriodLocks.periodMonth, params.periodMonth as any),
        isNull(cosPeriodLocks.unlockedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const id = rows[0].id;
  await db
    .update(cosPeriodLocks)
    .set({
      unlockedAt: new Date(),
      unlockedByUserId: params.unlockedByUserId,
      unlockReason: params.reason,
    })
    .where(eq(cosPeriodLocks.id, id));
  return id;
}

/**
 * Get the lock state for a range of months (used by the dashboard UI
 * to render padlock badges across recent months).
 */
export async function getCosPeriodLockStatuses(params: {
  fromMonth: string; // YYYY-MM-01 inclusive
  toMonth: string;   // YYYY-MM-01 inclusive
}): Promise<Array<{ period: string; locked: boolean; lockedAt: Date | null; autoLocked: boolean }>> {
  const rows = await db
    .select()
    .from(cosPeriodLocks)
    .where(
      and(
        // Drizzle's gte/lte handles the cast safely on both PG (date
        // column) and SQLite (text). Previously used `::date` casts
        // which threw on SQLite and broke the dashboard's padlock UI
        // in dev. CLAUDE.md DO-NOT list explicitly forbids `::` casts.
        gte(cosPeriodLocks.periodMonth, params.fromMonth as any),
        lte(cosPeriodLocks.periodMonth, params.toMonth as any),
        isNull(cosPeriodLocks.unlockedAt),
      ),
    );
  type LockRow = { id: number; periodMonth: unknown; lockedAt: Date | null; autoLocked: boolean };
  const typedRows = rows as unknown as LockRow[];
  // Build the month list from fromMonth to toMonth inclusive.
  const months: Array<{ period: string; locked: boolean; lockedAt: Date | null; autoLocked: boolean }> = [];
  let cursorY = Number(params.fromMonth.slice(0, 4));
  let cursorM = Number(params.fromMonth.slice(5, 7));
  const endY = Number(params.toMonth.slice(0, 4));
  const endM = Number(params.toMonth.slice(5, 7));
  while (cursorY < endY || (cursorY === endY && cursorM <= endM)) {
    const period = `${cursorY}-${String(cursorM).padStart(2, "0")}-01`;
    const row = typedRows.find((r: LockRow) => String(r.periodMonth).slice(0, 10) === period);
    months.push({
      period,
      locked: !!row,
      lockedAt: row?.lockedAt ?? null,
      autoLocked: !!row?.autoLocked,
    });
    cursorM += 1;
    if (cursorM > 12) {
      cursorM = 1;
      cursorY += 1;
    }
  }
  return months;
}

/**
 * South African Public Holidays and Working Day Calculations
 *
 * Extracted from routes.ts (duplicated across 5 route files).
 * Provides: parseDateParts, formatDateKey, isHoliday, saWorkingDays
 *
 * Used by project summary aggregation, planning tasks, dashboards,
 * lifecycle routes, and project routes.
 */

export function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const s = dateStr.substring(0, 10);
  return { year: parseInt(s.substring(0, 4)), month: parseInt(s.substring(5, 7)), day: parseInt(s.substring(8, 10)) };
}

export function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function computeEaster(year: number): { year: number; month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function getSAPublicHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => {
    holidays.add(formatDateKey(year, m, d));
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCDay() === 0) {
      const next = new Date(dt);
      next.setUTCDate(next.getUTCDate() + 1);
      holidays.add(formatDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()));
    }
  };
  add(1, 1);   // New Year's Day
  add(3, 21);  // Human Rights Day
  add(4, 27);  // Freedom Day
  add(5, 1);   // Workers' Day
  add(6, 16);  // Youth Day
  add(8, 9);   // National Women's Day
  add(9, 24);  // Heritage Day
  add(12, 16); // Day of Reconciliation
  add(12, 25); // Christmas Day
  add(12, 26); // Day of Goodwill

  // Easter-based holidays (Good Friday & Family Day)
  const easter = computeEaster(year);
  const goodFriday = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(formatDateKey(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()));
  const familyDay = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  familyDay.setUTCDate(familyDay.getUTCDate() + 1);
  holidays.add(formatDateKey(familyDay.getUTCFullYear(), familyDay.getUTCMonth() + 1, familyDay.getUTCDate()));

  return holidays;
}

const holidayCacheByYear = new Map<number, Set<string>>();

export function isHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4));
  if (!holidayCacheByYear.has(year)) {
    holidayCacheByYear.set(year, getSAPublicHolidays(year));
  }
  return holidayCacheByYear.get(year)!.has(dateStr);
}

/**
 * Count working days (Mon–Fri, excluding SA public holidays) inclusive of
 * both endpoints. Returns null for malformed input, 0 when end < start.
 *
 * Canonical implementation — previously copy-pasted into several route files.
 */
export function saWorkingDays(startDateStr: string | null, endDateStr: string | null): number | null {
  if (!startDateStr || !endDateStr || !/^\d{4}-\d{2}-\d{2}/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}/.test(endDateStr)) return null;
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const ds = formatDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function isWorkingDate(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !isHoliday(formatDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
}

/**
 * Date that is `n` SA working days after `dateStr` (Mon–Fri minus public
 * holidays). n = 0 returns the same date if it is a working day, else the next
 * working day. Returns null on malformed input. Used by the reschedule engine.
 */
export function addWorkingDays(dateStr: string | null, n: number): string | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
  const p = parseDateParts(dateStr);
  let cursor = new Date(Date.UTC(p.year, p.month - 1, p.day));
  let remaining = Math.max(0, Math.floor(n));
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 86400000);
    if (isWorkingDate(cursor)) remaining--;
  }
  while (!isWorkingDate(cursor)) cursor = new Date(cursor.getTime() + 86400000);
  return formatDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
}

/** `n` SA working days BEFORE `dateStr` (inverse of addWorkingDays). */
export function subtractWorkingDays(dateStr: string | null, n: number): string | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
  const p = parseDateParts(dateStr);
  let cursor = new Date(Date.UTC(p.year, p.month - 1, p.day));
  let remaining = Math.max(0, Math.floor(n));
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() - 86400000);
    if (isWorkingDate(cursor)) remaining--;
  }
  while (!isWorkingDate(cursor)) cursor = new Date(cursor.getTime() - 86400000);
  return formatDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
}

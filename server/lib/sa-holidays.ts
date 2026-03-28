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

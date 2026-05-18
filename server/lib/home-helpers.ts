/**
 * Home / Reporting Helpers — shared utility functions used by
 * home-summary, upcoming-events, and upcoming-financials route handlers.
 *
 * Extracted from server/routes.ts to create a clean seam for
 * Home/Reporting route extraction.
 */

// ── Numeric / date helpers ──

export function safeNum(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function isWithinDays(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateStr);
  const diffMs = targetDate.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
}

export function isThisWeek(dateStr: string | null | undefined): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = new Date();
  const target = new Date(dateStr);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return target >= monday && target <= sunday;
}

export function isThisMonth(dateStr: string | null | undefined): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = new Date();
  const target = new Date(dateStr);
  return target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
}

export function getFYRange(date: Date = new Date()): { start: string; end: string } {
  const year = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1; // Sep=8
  return {
    start: `${year}-09-01`,
    end: `${year + 1}-08-31`
  };
}

// ── South African public holiday engine ──

function formatDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const s = dateStr.substring(0, 10);
  return { year: parseInt(s.substring(0, 4)), month: parseInt(s.substring(5, 7)), day: parseInt(s.substring(8, 10)) };
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

export function getSAPublicHolidays(year: number): Set<string> {
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

// ── Plan date extraction helpers ──

interface PlanDateRow {
  highLevelProgramme?: string | null;
  trueActualEnd?: string | null;
  actualEnd?: string | null;
  trueActualStart?: string | null;
  actualStart?: string | null;
}

export function findMaxEndDate(plans: PlanDateRow[], patterns: string[]): string | null {
  let maxDate: string | null = null;
  for (const task of plans) {
    const desc = (task.highLevelProgramme || '').toLowerCase();
    const matches = patterns.some(p => desc.includes(p.toLowerCase()));
    if (!matches) continue;
    const dateVal = task.trueActualEnd || task.actualEnd;
    if (dateVal && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
      const dateStr = dateVal.substring(0, 10);
      if (!maxDate || dateStr > maxDate) maxDate = dateStr;
    }
  }
  return maxDate;
}

export function findMinStartDate(plans: PlanDateRow[], patterns: string[]): string | null {
  let minDate: string | null = null;
  for (const task of plans) {
    const desc = (task.highLevelProgramme || '').toLowerCase();
    const matches = patterns.some(p => desc.includes(p.toLowerCase()));
    if (!matches) continue;
    const dateVal = task.trueActualStart || task.actualStart;
    if (dateVal && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
      const dateStr = dateVal.substring(0, 10);
      if (!minDate || dateStr < minDate) minDate = dateStr;
    }
  }
  return minDate;
}

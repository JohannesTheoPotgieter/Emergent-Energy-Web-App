/**
 * Project Summary Helpers
 *
 * Pure computation functions extracted from routes.ts /api/projects-summary endpoint.
 * These handle project name normalization, date calculations, and milestone inference
 * used during project summary aggregation.
 *
 * Extracted to enable independent testing and reuse.
 */

import { parseDateParts, formatDateKey, isHoliday } from "../lib/sa-holidays";

// ── SA Working Days ──────────────────────────────────────────────

/**
 * Compute South African working days between two date strings.
 * Excludes weekends (Sat/Sun) and SA public holidays.
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

// ── Milestone Date Inference ─────────────────────────────────────

/** Subset of plan-task fields used for milestone-date inference. */
export interface PlanTaskDateRow {
  highLevelProgramme?: string | null;
  trueActualEnd?: string | null;
  actualEnd?: string | null;
  trueActualStart?: string | null;
  actualStart?: string | null;
}

/**
 * Find the latest (max) end date from plan tasks matching description patterns.
 * Used to infer milestone dates (commissioning, handover, etc.) from plan task descriptions.
 */
export function findMaxEndDate(plans: PlanTaskDateRow[], patterns: string[]): string | null {
  let maxDate: string | null = null;
  for (const task of plans) {
    const desc = (task.highLevelProgramme || "").toLowerCase();
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

/**
 * Find the earliest (min) start date from plan tasks matching description patterns.
 * Used to infer construction start date from plan task descriptions.
 */
export function findMinStartDate(plans: PlanTaskDateRow[], patterns: string[]): string | null {
  let minDate: string | null = null;
  for (const task of plans) {
    const desc = (task.highLevelProgramme || "").toLowerCase();
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

/**
 * Compute calendar days difference between two date strings.
 * Returns positive if a > b, negative if a < b.
 */
export function daysDiff(a: string | null, b: string | null): number | null {
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null;
  const da = new Date(a.substring(0, 10));
  const db = new Date(b.substring(0, 10));
  return Math.round((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Project Name Normalization ───────────────────────────────────

/**
 * Deep normalization for project name matching.
 * Handles _Tracker suffixes, underscores, abbreviations (ph→phase, std→standard).
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/_Tracker\d*$/i, "")
    .replace(/[_\-]/g, " ")
    .replace(/\bph(\d)/gi, "phase $1")
    .replace(/\bphase\s*(\d)/gi, "phase $1")
    .replace(/\bstd\b/gi, "standard")
    .replace(/\bgq\b/gi, "gq")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const JUNK_NAMES = new Set(["PROJECT SIZE (kWp)", "FY 2026 Adhoc", "PROJECT MANAGERS"]);

/**
 * Check if a project name is a junk/placeholder name that should be excluded.
 */
export function isJunkName(name: string): boolean {
  return JUNK_NAMES.has(name) || /^(FY\s*\d|PROJECT\s+(SIZE|MANAGER))/i.test(name);
}

/**
 * Build a canonical name resolver from a set of known project info names.
 * Uses 3-tier matching: exact → fuzzy (suffix matching) → deep normalization (word-level).
 *
 * Returns a function that maps any project name to its canonical projectInfo name.
 */
export function buildCanonicalResolver(projectInfoNames: Set<string>): (name: string) => string {
  const projectInfoNormMap = new Map<string, string>();
  for (const piName of projectInfoNames) {
    const norm = piName.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim();
    projectInfoNormMap.set(norm, piName);
  }

  const projectInfoDeepNormMap = new Map<string, string>();
  for (const piName of projectInfoNames) {
    projectInfoDeepNormMap.set(normalizeForMatch(piName), piName);
  }

  return function resolveToCanonical(name: string): string {
    if (projectInfoNames.has(name)) return name;

    // Tier 1: exact variant matching
    const variants = [
      name.replace(/ /g, "_") + "_Tracker",
      name + "_Tracker",
      name.replace(/ /g, "_"),
    ];
    for (const v of variants) {
      if (projectInfoNames.has(v)) return v;
    }

    // Tier 2: fuzzy suffix matching
    const normKey = name.replace(/[_ ]/g, " ").toLowerCase().trim();
    const fuzzyMatch = projectInfoNormMap.get(normKey);
    if (fuzzyMatch) return fuzzyMatch;
    for (const [piNorm, piName] of projectInfoNormMap) {
      if (piNorm.endsWith(normKey) || normKey.endsWith(piNorm)) return piName;
    }

    // Tier 3: deep normalization with word-level matching
    const deepNorm = normalizeForMatch(name);
    const deepMatch = projectInfoDeepNormMap.get(deepNorm);
    if (deepMatch) return deepMatch;

    for (const [piDeep, piName] of projectInfoDeepNormMap) {
      if (piDeep.includes(deepNorm) || deepNorm.includes(piDeep)) return piName;
    }

    const nameWords = deepNorm.split(" ").filter(w => w.length > 1);
    if (nameWords.length >= 1) {
      let bestMatch: string | null = null;
      let bestScore = 0;
      for (const [piDeep, piName] of projectInfoDeepNormMap) {
        const piWords = piDeep.split(" ").filter(w => w.length > 1);
        const matchingWords = nameWords.filter(w => piWords.some(pw => pw.includes(w) || w.includes(pw)));
        const score = matchingWords.length / Math.max(nameWords.length, piWords.length);
        if (score > bestScore && score >= 0.5) {
          bestScore = score;
          bestMatch = piName;
        }
      }
      if (bestMatch) return bestMatch;
    }

    return name;
  };
}

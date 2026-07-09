/**
 * Pure NCR analytics + CSV helpers (Task 1.2).
 *
 * Extracted so the aging-bucket, trend, and CSV-serialisation logic is
 * unit-testable without a live DB. The route fetches a project-scoped row
 * set (bounded by `getQualityHseScope`) and aggregates it here — the tested
 * logic is exactly the shipped logic.
 *
 * Aging buckets are measured in whole days from `created_at`:
 *   "0-7"  → 0..7 days, "8-30" → 8..30 days, "30+" → older than 30 days.
 */

export type NcrAgeBucket = "0-7" | "8-30" | "30+";

export interface NcrAgingBuckets {
  "0-7": number;
  "8-30": number;
  "30+": number;
  total: number;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Whole days elapsed between `createdAt` and `now` (never negative). */
export function ncrAgeDays(createdAt: Date | string, now: Date): number {
  const ms = now.getTime() - toDate(createdAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function ncrAgeBucket(ageDays: number): NcrAgeBucket {
  if (ageDays <= 7) return "0-7";
  if (ageDays <= 30) return "8-30";
  return "30+";
}

export interface AgingInputRow {
  createdAt: Date | string;
}

/** Bucket a set of (typically non-terminal) NCRs by age. */
export function computeNcrAging(rows: AgingInputRow[], now: Date): NcrAgingBuckets {
  const buckets: NcrAgingBuckets = { "0-7": 0, "8-30": 0, "30+": 0, total: 0 };
  for (const r of rows) {
    buckets[ncrAgeBucket(ncrAgeDays(r.createdAt, now))]++;
    buckets.total++;
  }
  return buckets;
}

export interface TrendInputRow {
  createdAt: Date | string;
  status: string;
  severity: string;
}

export interface NcrTrendPoint {
  month: string; // YYYY-MM
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
}

function monthKey(createdAt: Date | string): string {
  const d = toDate(createdAt);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Monthly counts by status + severity, ascending by month. */
export function computeNcrTrend(rows: TrendInputRow[]): NcrTrendPoint[] {
  const byMonth = new Map<string, NcrTrendPoint>();
  for (const r of rows) {
    const key = monthKey(r.createdAt);
    let point = byMonth.get(key);
    if (!point) {
      point = { month: key, total: 0, byStatus: {}, bySeverity: {} };
      byMonth.set(key, point);
    }
    point.total++;
    point.byStatus[r.status] = (point.byStatus[r.status] ?? 0) + 1;
    point.bySeverity[r.severity] = (point.bySeverity[r.severity] ?? 0) + 1;
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// --------------------------------------------------------------------------
// CSV (RFC 4180). Mirrors the finance-audit-export quoting rules; kept here
// as a pure, reusable serialiser for the NCR register export.
// --------------------------------------------------------------------------

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  // Neutralise spreadsheet formula injection: Excel / Sheets evaluate a cell
  // that begins with = + - @ (or a leading tab / CR) as a formula. NCR title /
  // project / assignee are free text, so prefix such a cell with a single
  // quote before RFC-4180 quoting.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** Serialise header + rows into a full CSV body with a UTF-8 BOM for Excel. */
export function rowsToCsv(header: string[], rows: unknown[][]): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/**
 * Shared utilities for monthly report routes.
 * Extracted to avoid duplication between PM and Engineering routes.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { smartImportRuns } from "@shared/schema/imports";
import { workItems } from "@shared/schema/tasks";
import { and, eq, isNotNull, isNull, desc } from "drizzle-orm";
export { requireAuth } from "../auth-context";

/** Validate YYYY-MM format with logical month 01-12 */
export function validateMonth(month: string | undefined): { valid: boolean; error?: string } {
  if (!month) return { valid: false, error: "month query parameter required (YYYY-MM)" };
  if (!/^\d{4}-\d{2}$/.test(month)) return { valid: false, error: "Invalid month format. Use YYYY-MM." };
  const monthNum = parseInt(month.split("-")[1]);
  if (monthNum < 1 || monthNum > 12) return { valid: false, error: "Invalid month value (must be 01-12)" };
  return { valid: true };
}

/**
 * Freshness signal for monthly report snapshots.
 *
 * The snapshot is a frozen JSONB blob captured at generation time —
 * there's no `effective_to` versioning. To honour the freshness
 * contract in `docs/data-import-and-source-of-truth.md`, the read
 * endpoints must compare the snapshot's `generatedAt` against the
 * latest underlying canonical change. `lastDataChangeAt` here is
 * coarse: the most recent of (last committed Smart Import run,
 * last update on a SMART_IMPORT-sourced work_item). It will produce
 * some false positives — a regenerate clears them.
 */
export interface MonthlyReportFreshness {
  isStale: boolean;
  generatedAt: string | null;
  lastDataChangeAt: string | null;
}

const FRESHNESS_TOLERANCE_MS = 5_000;

export async function computeReportFreshness(
  generatedAt: Date | string | null,
): Promise<MonthlyReportFreshness> {
  const genIso = generatedAt
    ? (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).toISOString()
    : null;
  const genTs = generatedAt
    ? (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).getTime()
    : null;

  const [importRow, workItemRow] = await Promise.all([
    db
      .select({ committedAt: smartImportRuns.committedAt })
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.status, "committed"), isNotNull(smartImportRuns.committedAt)))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1),
    db
      .select({ updatedAt: workItems.updatedAt })
      .from(workItems)
      .where(and(eq(workItems.source, "SMART_IMPORT"), isNull(workItems.deletedAt)))
      .orderBy(desc(workItems.updatedAt))
      .limit(1),
  ]);

  const importTs = importRow[0]?.committedAt
    ? new Date(importRow[0].committedAt as any).getTime()
    : null;
  const workItemTs = workItemRow[0]?.updatedAt
    ? new Date(workItemRow[0].updatedAt as any).getTime()
    : null;
  const candidates = [importTs, workItemTs].filter((t): t is number => t != null);
  const lastChangeTs = candidates.length > 0 ? Math.max(...candidates) : null;
  const lastDataChangeAt = lastChangeTs != null ? new Date(lastChangeTs).toISOString() : null;

  const isStale =
    genTs != null && lastChangeTs != null && lastChangeTs > genTs + FRESHNESS_TOLERANCE_MS;

  return { isStale, generatedAt: genIso, lastDataChangeAt };
}

/** Compute deltas between two KPI objects for comparison */
export function computeKpiDeltas(kpisA: Record<string, any>, kpisB: Record<string, any>): Record<string, { a: number; b: number; delta: number; deltaPct: number | null }> {
  const result: Record<string, any> = {};
  const allKeys = new Set([...Object.keys(kpisA), ...Object.keys(kpisB)]);
  for (const key of allKeys) {
    const a = typeof kpisA[key] === "number" ? kpisA[key] : 0;
    const b = typeof kpisB[key] === "number" ? kpisB[key] : 0;
    const delta = b - a;
    const deltaPct = a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null;
    result[key] = { a, b, delta, deltaPct };
  }
  return result;
}

/**
 * Shared utilities for monthly report routes.
 * Extracted to avoid duplication between PM and Engineering routes.
 */

import type { Request, Response, NextFunction } from "express";
export { requireAuth } from "../auth-context";

/** Validate YYYY-MM format with logical month 01-12 */
export function validateMonth(month: string | undefined): { valid: boolean; error?: string } {
  if (!month) return { valid: false, error: "month query parameter required (YYYY-MM)" };
  if (!/^\d{4}-\d{2}$/.test(month)) return { valid: false, error: "Invalid month format. Use YYYY-MM." };
  const monthNum = parseInt(month.split("-")[1]);
  if (monthNum < 1 || monthNum > 12) return { valid: false, error: "Invalid month value (must be 01-12)" };
  return { valid: true };
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

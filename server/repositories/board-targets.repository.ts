/**
 * Board finance targets — data access.
 *
 * Admin-entered per-FY board revenue target + target margin %. Read by the
 * Finance Home Revenue KPI as a display comparison only (never a finance
 * computation). Mirrors the screenSettings.repository upsert pattern.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { boardFinanceTargets } from "@shared/schema";
import type { BoardFinanceTarget } from "@shared/schema";

/** Wire shape — numeric columns arrive as strings from pg; coerce to number|null. */
export interface BoardTargetView {
  fy: number;
  revenueTarget: number | null;
  targetMarginPct: number | null;
  reason: string | null;
  updatedByUserId: number | null;
  updatedAt: string | null;
}

export interface UpsertBoardTargetInput {
  revenueTarget: number | null;
  targetMarginPct: number | null;
  reason: string | null;
  updatedByUserId: number | null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toView(row: BoardFinanceTarget): BoardTargetView {
  return {
    fy: row.fy,
    revenueTarget: toNumberOrNull(row.revenueTarget),
    targetMarginPct: toNumberOrNull(row.targetMarginPct),
    reason: row.reason ?? null,
    updatedByUserId: row.updatedByUserId ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export const boardTargetsRepository = {
  async getAll(): Promise<BoardTargetView[]> {
    const rows = await db.select().from(boardFinanceTargets);
    return rows.map(toView);
  },

  async getByFy(fy: number): Promise<BoardTargetView | null> {
    const rows = await db
      .select()
      .from(boardFinanceTargets)
      .where(eq(boardFinanceTargets.fy, fy))
      .limit(1);
    const row = rows[0];
    return row ? toView(row) : null;
  },

  async upsert(fy: number, input: UpsertBoardTargetInput): Promise<BoardTargetView> {
    // numeric columns take string|number; store as-is (pg coerces), null clears.
    const values = {
      fy,
      revenueTarget: input.revenueTarget,
      targetMarginPct: input.targetMarginPct,
      reason: input.reason,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    };
    await db
      .insert(boardFinanceTargets)
      .values(values)
      .onConflictDoUpdate({
        target: boardFinanceTargets.fy,
        set: {
          revenueTarget: input.revenueTarget,
          targetMarginPct: input.targetMarginPct,
          reason: input.reason,
          updatedByUserId: input.updatedByUserId,
          updatedAt: new Date(),
        },
      });
    const saved = await this.getByFy(fy);
    // getByFy always returns after an upsert; fall back defensively.
    return saved ?? { fy, ...input, updatedAt: new Date().toISOString() };
  },
};

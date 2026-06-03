/**
 * FYE Tracking API Routes — reproduces the "FY26 Project Tracking
 * (EE - from trackers)" workbook from the imported tracker lines.
 *
 * Two views, both computed live from the canonical per-line revenue/COS
 * (`FinanceLineLevelRepository`, the single § 3.3 read path) via the pure
 * compute layer in `server/lib/finance/fye-tracking/`:
 *
 *   GET  /api/fye-revenue-tracking/projects        → View A: project table,
 *        4-state portfolio totals (Realised/Committed/Planned/Unrealised),
 *        amber flags, excluded/de-duped trackers, TOTAL row.
 *   GET  /api/fye-revenue-tracking/dashboard       → View B: Revenue/COS/GP
 *        monthly + YTD-running for Revised Budget / Actual / Plan-ahead.
 *   GET  /api/fye-revenue-tracking/revised-budget  → manual once-off monthly
 *        Revised-Budget figures (editable).
 *   PUT  /api/fye-revenue-tracking/revised-budget  → upsert one cell.
 *   GET  /api/fye-revenue-tracking/years           → FY selector options.
 *
 * Everything except the Revised-Budget figures recomputes from the imported
 * tracker data on refresh; the tab adapts automatically to new uploads.
 *
 * (Replaces the former pipeline / lost-deals / snapshot-export feature. Those
 * tables remain in the schema but are no longer served here.)
 */

import { Router, type Express, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { getCurrentFinanceYear } from "../lib/finance-year-scope";
import { buildFyeTracking } from "../lib/finance/fye-tracking/service";
import { FyeTrackingDataRepository } from "../repositories/fye-tracking-data-repository";
import type { FyeMetric } from "../lib/finance/fye-tracking/compute";

const router = Router();
const dataRepo = new FyeTrackingDataRepository();

/** Parse an FY query value. Accepts a 4-digit year (2026) or a 2-digit short
 * year (26 → 2026); falls back to the current finance year. */
function parseFy(raw: unknown): number {
  const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw ?? ""), 10);
  if (!Number.isFinite(n)) return getCurrentFinanceYear();
  if (n >= 2000 && n <= 2100) return n;
  if (n >= 0 && n < 100) return 2000 + n;
  return getCurrentFinanceYear();
}

function logAndFail(res: Response, where: string, error: unknown): void {
  // Never leak raw DB / stack details to the client (§ 5).
  console.error(`[fye-tracking] ${where}:`, error instanceof Error ? error.message : error);
  res.status(500).json({ error: `Failed to ${where}` });
}

// ─── GET /years ──────────────────────────────────────────────────────────────
router.get(
  "/api/fye-revenue-tracking/years",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (_req, res) => {
    try {
      const current = getCurrentFinanceYear();
      const years = new Set<number>([current - 1, current, current + 1]);
      try {
        for (const fy of [current - 2, current - 1, current, current + 1]) {
          const rows = await dataRepo.getRevisedBudget(fy);
          if (rows.length > 0) years.add(fy);
        }
      } catch {
        /* non-fatal — defaults still returned */
      }
      res.json({ years: [...years].sort((a, b) => b - a), currentFye: current });
    } catch (error) {
      logAndFail(res, "fetch FYE years", error);
    }
  },
);

// ─── GET /projects (View A) ──────────────────────────────────────────────────
router.get(
  "/api/fye-revenue-tracking/projects",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fy = parseFy(req.query.fy ?? req.query.fye);
      const result = await buildFyeTracking(fy);
      res.json({
        fye: result.fye,
        asAt: result.asAt,
        rows: result.projectTable.rows,
        totals: result.projectTable.totals,
        stateTotals: result.projectTable.stateTotals,
        excluded: result.projectTable.excluded,
        projectCount: result.projectTable.projectCount,
      });
    } catch (error) {
      logAndFail(res, "fetch FYE projects", error);
    }
  },
);

// ─── GET /dashboard (View B) ─────────────────────────────────────────────────
router.get(
  "/api/fye-revenue-tracking/dashboard",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fy = parseFy(req.query.fy ?? req.query.fye);
      const result = await buildFyeTracking(fy);
      res.json({ fye: result.fye, asAt: result.asAt, dashboard: result.dashboard });
    } catch (error) {
      logAndFail(res, "fetch FYE dashboard", error);
    }
  },
);

// ─── Revised Budget (manual once-off monthly) ────────────────────────────────
router.get(
  "/api/fye-revenue-tracking/revised-budget",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fy = parseFy(req.query.fy ?? req.query.fye);
      const rows = await dataRepo.getRevisedBudget(fy);
      res.json({ fye: fy, rows });
    } catch (error) {
      logAndFail(res, "fetch revised budget", error);
    }
  },
);

router.put(
  "/api/fye-revenue-tracking/revised-budget",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const schema = z.object({
        fye: z.number().int(),
        metric: z.enum(["revenue", "cos", "gp"]),
        monthKey: z.string().regex(/^\d{4}-\d{2}$/),
        amount: z.union([z.string(), z.number()]),
      });
      const data = schema.parse(req.body);
      const userId = (req as { user?: { id?: number } }).user?.id ?? null;
      await dataRepo.upsertRevisedBudget({
        fye: data.fye,
        metric: data.metric as FyeMetric,
        monthKey: data.monthKey,
        amount: String(data.amount),
        userId,
      });
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      logAndFail(res, "save revised budget", error);
    }
  },
);

/**
 * Seed the Revised-Budget table from the ManCo "Adjusted Budget" monthly line
 * for FY26 (idempotent — only when the FY has no rows yet). These are the
 * operator's starting figures; they remain fully editable in-app.
 */
const MANCO_FY26_ADJUSTED_BUDGET: ReadonlyArray<[string, number, number]> = [
  // [monthKey, revenue, cos]
  ["2025-09", 9348308.37, 8083466.99],
  ["2025-10", 18892558.25, 16346971.77],
  ["2025-11", 23185462.07, 20063809.84],
  ["2025-12", 14313016.1, 12381959.44],
  ["2026-01", 14328580.47, 12395435.22],
  ["2026-02", 23948744.22, 20724666.98],
  ["2026-03", 23811191.68, 20599956.6],
  ["2026-04", 26808799.27, 23137378.14],
  ["2026-05", 36331899.47, 31403537.82],
  ["2026-06", 48187541.07, 41710854.07],
  ["2026-07", 45191393.46, 39116760.2],
  ["2026-08", 85332843.65, 73983831.01],
];

async function seedRevisedBudgetFromManCo(): Promise<void> {
  try {
    const existing = await dataRepo.getRevisedBudget(2026);
    if (existing.length > 0) return; // already seeded / operator-edited
    for (const [monthKey, revenue, cos] of MANCO_FY26_ADJUSTED_BUDGET) {
      await dataRepo.upsertRevisedBudget({ fye: 2026, metric: "revenue", monthKey, amount: String(revenue), userId: null });
      await dataRepo.upsertRevisedBudget({ fye: 2026, metric: "cos", monthKey, amount: String(cos), userId: null });
      await dataRepo.upsertRevisedBudget({ fye: 2026, metric: "gp", monthKey, amount: String(revenue - cos), userId: null });
    }
    console.log("[fye-tracking] Seeded FY26 Revised Budget from ManCo Adjusted Budget (36 rows).");
  } catch (err) {
    console.error("[fye-tracking] Revised-budget seed error:", err instanceof Error ? err.message : err);
  }
}

export function registerFyeRevenueTrackingRoutes(app: Express): void {
  app.use(router);
  seedRevisedBudgetFromManCo().catch(() => {});
}

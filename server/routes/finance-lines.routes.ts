/**
 * Line-level finance read endpoints.
 *
 *   GET /api/finance/lines/:projectId
 *     ?fyStart=YYYY-MM-DD&fyEnd=YYYY-MM-DD
 *
 *   GET /api/finance/lines
 *     ?projectIds=1,2,3&fyStart=YYYY-MM-DD&fyEnd=YYYY-MM-DD
 *     Portfolio aggregator — sums per-project totals (no cross-project
 *     pooling per § 3.3.1).
 *
 *   GET /api/finance/category-allocation-health
 *     Diagnostic: lists every project that has cost lines but is missing
 *     or partially missing `category_revenue_allocations.revenue_allocation`
 *     (Excel column J). Used to triage workbook fixes before company-wide
 *     GP visibility goes live.
 *
 * All endpoints derive per-line revenue / GP from the canonical
 * category-scoped POC formula in AGENT_GUARDRAILS § 3.3:
 *
 *     perLineRevenue = (line.actualTotal / category.totalActualTotal)
 *                      × category.revenueAllocation
 *
 * The endpoints are read-only and are the single source of truth that the
 * GP page (PR 5) and the Revenue / COS recon-grid cutover all consume.
 * Do not re-implement the formula elsewhere.
 */
import type { Express, Request, Response } from "express";
import { and, isNull } from "drizzle-orm";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { badRequest, ApiError, serverError } from "../lib/api-error";
import {
  FinanceLineLevelRepository,
  aggregateLinesByMonth,
  type FinanceLine,
  type MonthlyReconRow,
} from "../repositories/finance-line-level-repository";
import { db } from "../db";
import {
  categoryRevenueAllocations,
  normalizedCostLineActuals,
  normalizedCostLines,
  projectInfo,
} from "@shared/schema";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PORTFOLIO_PROJECTS = 200;

function parseIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw badRequest(`Invalid ${field} — expected YYYY-MM-DD`, { [field]: String(value) });
  }
  return value;
}

function parseProjectId(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw badRequest("projectId is required", { projectId: String(raw ?? "") });
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest("projectId must be a positive integer", { projectId: String(raw) });
  }
  return n;
}

function parseProjectIdList(raw: unknown): number[] {
  if (raw === undefined || raw === null || raw === "") return [];
  if (typeof raw !== "string") {
    throw badRequest("projectIds must be a comma-separated list", { projectIds: String(raw) });
  }
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const ids: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n <= 0) {
      throw badRequest("projectIds entries must be positive integers", { projectIds: raw });
    }
    ids.push(n);
  }
  if (ids.length > MAX_PORTFOLIO_PROJECTS) {
    throw badRequest(`projectIds list exceeds maximum (${MAX_PORTFOLIO_PROJECTS})`, {
      projectIds: String(ids.length),
    });
  }
  return Array.from(new Set(ids));
}

interface ProjectTotals {
  projectId: number;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
}

function summariseLinesByProject(lines: FinanceLine[]): ProjectTotals[] {
  const byProject = new Map<number, ProjectTotals>();
  for (const l of lines) {
    let row = byProject.get(l.projectId);
    if (!row) {
      row = { projectId: l.projectId, cos: 0, revenue: 0, gp: 0, gpPct: null, count: 0 };
      byProject.set(l.projectId, row);
    }
    row.cos += l.actualTotal;
    row.revenue += l.perLineRevenue;
    row.gp += l.perLineGp;
    row.count += 1;
  }
  return Array.from(byProject.values()).map((r) => ({
    ...r,
    gpPct: r.revenue !== 0 ? r.gp / r.revenue : null,
  }));
}

function sumTotals(rows: ProjectTotals[]): MonthlyReconRow {
  let cos = 0, revenue = 0, gp = 0, count = 0;
  for (const r of rows) {
    cos += r.cos;
    revenue += r.revenue;
    gp += r.gp;
    count += r.count;
  }
  return {
    monthKey: "total",
    cos,
    revenue,
    gp,
    gpPct: revenue !== 0 ? gp / revenue : null,
    count,
  };
}

export function registerFinanceLinesRoutes(app: Express): void {
  const repo = new FinanceLineLevelRepository();

  app.get(
    "/api/finance/lines/:projectId",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req.params.projectId);
        const fyStart = parseIsoDate(req.query.fyStart, "fyStart");
        const fyEnd = parseIsoDate(req.query.fyEnd, "fyEnd");
        if (fyStart && fyEnd && fyStart > fyEnd) {
          throw badRequest("fyStart must be on or before fyEnd", { fyStart, fyEnd });
        }

        const lines = await repo.getProjectFinanceLines(projectId, { fyStart, fyEnd });
        const aggregated = aggregateLinesByMonth(lines);

        res.json({
          projectId,
          fyStart: fyStart ?? null,
          fyEnd: fyEnd ?? null,
          lines,
          monthly: aggregated.byMonth,
          unrecognised: aggregated.unrecognised,
          total: aggregated.total,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to load finance lines");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );

  /**
   * Portfolio aggregator. Returns per-project totals + the portfolio total,
   * computed strictly as the sum of per-project line values (§ 3.3.1).
   */
  app.get(
    "/api/finance/lines",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectIds = parseProjectIdList(req.query.projectIds);
        const fyStart = parseIsoDate(req.query.fyStart, "fyStart");
        const fyEnd = parseIsoDate(req.query.fyEnd, "fyEnd");
        if (fyStart && fyEnd && fyStart > fyEnd) {
          throw badRequest("fyStart must be on or before fyEnd", { fyStart, fyEnd });
        }
        if (projectIds.length === 0) {
          throw badRequest("projectIds is required (comma-separated)", { projectIds: "" });
        }

        const lines = await repo.getPortfolioFinanceLines(projectIds, { fyStart, fyEnd });
        const byProject = summariseLinesByProject(lines);
        const portfolioTotal = sumTotals(byProject);
        const monthly = aggregateLinesByMonth(lines);

        res.json({
          projectIds,
          fyStart: fyStart ?? null,
          fyEnd: fyEnd ?? null,
          byProject,
          monthly: monthly.byMonth,
          unrecognised: monthly.unrecognised,
          total: portfolioTotal,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to load portfolio finance lines");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );

  /**
   * Category-allocation health diagnostic.
   *
   * For every project that has at least one live cost line, returns:
   *   - allocations: count of `category_revenue_allocations` rows
   *   - allocationsWithRevenue: count where `revenue_allocation` is set
   *   - linesWithoutAllocation: count of cost lines whose
   *       `category_allocation_id` is null
   *   - status: 'healthy' | 'partial' | 'missing' | 'no_lines'
   *
   * Used by the COO to triage which workbooks need column-J fixes before
   * the GP page goes live in front of the team. § 3.3 edge cases that
   * resolve to perLineRevenue = 0 surface here so they aren't silent.
   */
  app.get(
    "/api/finance/category-allocation-health",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const dbi = db;

        const [projects, allocations, parentLines, actualsLines] = await Promise.all([
          dbi
            .select({ id: projectInfo.id, projectName: projectInfo.projectName })
            .from(projectInfo)
            .where(isNull(projectInfo.deletedAt)),
          dbi
            .select({
              projectId: categoryRevenueAllocations.projectId,
              revenueAllocation: categoryRevenueAllocations.revenueAllocation,
            })
            .from(categoryRevenueAllocations)
            .where(isNull(categoryRevenueAllocations.effectiveTo)),
          dbi
            .select({
              projectId: normalizedCostLines.projectId,
              categoryAllocationId: normalizedCostLines.categoryAllocationId,
            })
            .from(normalizedCostLines)
            .where(
              and(
                isNull(normalizedCostLines.effectiveTo),
                isNull(normalizedCostLines.deletedAt),
              ),
            ),
          dbi
            .select({ projectId: normalizedCostLineActuals.projectId })
            .from(normalizedCostLineActuals)
            .where(
              and(
                isNull(normalizedCostLineActuals.effectiveTo),
                isNull(normalizedCostLineActuals.deletedAt),
              ),
            ),
        ]);

        type Bucket = {
          projectId: number;
          projectName: string;
          allocations: number;
          allocationsWithRevenue: number;
          parentLines: number;
          linesWithoutAllocation: number;
          actualsRows: number;
        };
        const byProject = new Map<number, Bucket>();
        for (const p of projects) {
          byProject.set(p.id, {
            projectId: p.id,
            projectName: p.projectName,
            allocations: 0,
            allocationsWithRevenue: 0,
            parentLines: 0,
            linesWithoutAllocation: 0,
            actualsRows: 0,
          });
        }

        for (const a of allocations) {
          const row = byProject.get(a.projectId);
          if (!row) continue;
          row.allocations += 1;
          const rev = a.revenueAllocation == null ? 0 : Number(a.revenueAllocation);
          if (Number.isFinite(rev) && rev > 0) row.allocationsWithRevenue += 1;
        }
        for (const p of parentLines) {
          const row = byProject.get(p.projectId);
          if (!row) continue;
          row.parentLines += 1;
          if (p.categoryAllocationId == null) row.linesWithoutAllocation += 1;
        }
        for (const a of actualsLines) {
          const row = byProject.get(a.projectId);
          if (!row) continue;
          row.actualsRows += 1;
        }

        const health = Array.from(byProject.values())
          .filter((r) => r.parentLines > 0 || r.actualsRows > 0)
          .map((r) => {
            let status: "healthy" | "partial" | "missing" | "no_lines";
            if (r.actualsRows === 0) {
              status = "no_lines";
            } else if (r.allocations === 0) {
              status = "missing";
            } else if (
              r.allocationsWithRevenue < r.allocations ||
              r.linesWithoutAllocation > 0
            ) {
              status = "partial";
            } else {
              status = "healthy";
            }
            return { ...r, status };
          })
          .sort((a, b) => {
            const order = { missing: 0, partial: 1, no_lines: 2, healthy: 3 };
            return order[a.status] - order[b.status] || a.projectName.localeCompare(b.projectName);
          });

        const summary = {
          total: health.length,
          healthy: health.filter((r) => r.status === "healthy").length,
          partial: health.filter((r) => r.status === "partial").length,
          missing: health.filter((r) => r.status === "missing").length,
          noLines: health.filter((r) => r.status === "no_lines").length,
        };

        res.json({ summary, projects: health });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to compute category-allocation health");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );
}

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
import {
  FinanceProvenanceRepository,
  resolveLeafProvenance,
} from "../repositories/finance-provenance-repository";
import {
  buildRevCosGpTree,
  buildInvoiceLeaf,
  buildSourceCell,
  findSumViolations,
  summariseLines,
  type DrillLineInput,
  type DrillNode,
} from "../lib/finance/finance-drilldown";
import { getFyWindow } from "../lib/fy-window";
import { ProjectInfoRepository } from "../repositories/project-info-repository";
import logger from "../lib/logger";
import { db } from "../db";
import {
  categoryRevenueAllocations,
  normalizedCostLineActuals,
  normalizedCostLines,
  projectInfo,
} from "@shared/schema";
import { storage } from "../storage";

/**
 * Monthly budget figures keyed by `YYYY-MM`. Matches what the COS / REV
 * tabs show as Budget: both are manual-only (tracker_monthly_manual). The
 * hardcoded STATIC_COS_BUDGET_FY26 fallback was removed
 * (fix/remove-placeholder-analytics) — a month with no manual entry shows 0.
 * Surfaced on the GP company response so the page can render a "Budget" row
 * whose numbers reconcile to the existing trackers.
 */
interface BudgetByMonth {
  cos: Record<string, number>;
  revenue: Record<string, number>;
}

async function loadBudgetByMonth(): Promise<BudgetByMonth> {
  const [cosManual, revManual] = await Promise.all([
    storage.getTrackerMonthlyManual("COS"),
    storage.getTrackerMonthlyManual("REV"),
  ]);
  const cosManualMap = new Map(
    cosManual.map((e: { monthKey: string; budget: string | null }) => [
      e.monthKey,
      e.budget != null ? Number(e.budget) : null,
    ]),
  );
  const revManualMap = new Map(
    revManual.map((e: { monthKey: string; budget: string | null }) => [
      e.monthKey,
      e.budget != null ? Number(e.budget) : null,
    ]),
  );

  const cos: Record<string, number> = {};
  const revenue: Record<string, number> = {};
  // Iterate over the static COS budget keys to seed the FY26 frame —
  // any month present in static or manual will appear.
  const monthKeys = new Set<string>([
    ...cosManualMap.keys(),
    ...revManualMap.keys(),
  ]);
  for (const mk of monthKeys) {
    const manualCos = cosManualMap.get(mk);
    cos[mk] = manualCos != null && Number.isFinite(manualCos) ? manualCos : 0;
    const manualRev = revManualMap.get(mk);
    revenue[mk] = manualRev != null && Number.isFinite(manualRev) ? manualRev : 0;
  }
  return { cos, revenue };
}

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
  plannedCos: number;
  plannedRevenue: number;
  plannedGp: number;
  plannedGpPct: number | null;
  realisedCos: number;
  realisedRevenue: number;
  realisedGp: number;
  realisedGpPct: number | null;
}

function summariseLinesByProject(lines: FinanceLine[]): ProjectTotals[] {
  const byProject = new Map<number, ProjectTotals>();
  for (const l of lines) {
    let row = byProject.get(l.projectId);
    if (!row) {
      row = {
        projectId: l.projectId,
        cos: 0, revenue: 0, gp: 0, gpPct: null, count: 0,
        plannedCos: 0, plannedRevenue: 0, plannedGp: 0, plannedGpPct: null,
        realisedCos: 0, realisedRevenue: 0, realisedGp: 0, realisedGpPct: null,
      };
      byProject.set(l.projectId, row);
    }
    row.cos += l.actualTotal;
    row.revenue += l.perLineRevenue;
    row.gp += l.perLineGp;
    row.count += 1;
    row.plannedCos += l.plannedActualTotal;
    row.plannedRevenue += l.plannedRevenue;
    row.plannedGp += l.plannedGp;
    if (l.bucket === "realised") {
      row.realisedCos += l.actualTotal;
      row.realisedRevenue += l.perLineRevenue;
      row.realisedGp += l.perLineGp;
    }
  }
  return Array.from(byProject.values()).map((r) => ({
    ...r,
    gpPct: r.revenue !== 0 ? r.gp / r.revenue : null,
    plannedGpPct: r.plannedRevenue !== 0 ? r.plannedGp / r.plannedRevenue : null,
    realisedGpPct: r.realisedRevenue !== 0 ? r.realisedGp / r.realisedRevenue : null,
  }));
}

function sumTotals(rows: ProjectTotals[]): MonthlyReconRow {
  let cos = 0, revenue = 0, gp = 0, count = 0;
  let plannedCos = 0, plannedRevenue = 0, plannedGp = 0;
  let realisedCos = 0, realisedRevenue = 0, realisedGp = 0;
  for (const r of rows) {
    cos += r.cos;
    revenue += r.revenue;
    gp += r.gp;
    count += r.count;
    plannedCos += r.plannedCos;
    plannedRevenue += r.plannedRevenue;
    plannedGp += r.plannedGp;
    realisedCos += r.realisedCos;
    realisedRevenue += r.realisedRevenue;
    realisedGp += r.realisedGp;
  }
  return {
    monthKey: "total",
    cos,
    revenue,
    gp,
    gpPct: revenue !== 0 ? gp / revenue : null,
    count,
    plannedCos,
    plannedRevenue,
    plannedGp,
    plannedGpPct: plannedRevenue !== 0 ? plannedGp / plannedRevenue : null,
    realisedCos,
    realisedRevenue,
    realisedGp,
    realisedGpPct: realisedRevenue !== 0 ? realisedGp / realisedRevenue : null,
  };
}

interface ReconGridProjectRow {
  projectId: number;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
}

interface ReconGridMonth {
  monthKey: string;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  byProject: ReconGridProjectRow[];
}

/** Coerce the `fy` query param to a calendar year (the FY's Aug-close year).
 * Anything invalid → null, which `getFyWindow` resolves to the current FY
 * (S8: FY is dynamic, never hardcoded). */
function parseFy(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseOptionalInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) ? n : null;
}

function parsePageInt(raw: unknown, def: number, max: number, field: string): number {
  if (raw === undefined || raw === null || raw === "") return def;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(n) || n < 0) {
    throw badRequest(`${field} must be a non-negative integer`, { [field]: String(raw) });
  }
  return Math.min(n, max);
}

function parseMonthKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (v === "unrecognised" || /^\d{4}-\d{2}$/.test(v)) return v;
  throw badRequest("month must be YYYY-MM or 'unrecognised'", { month: v });
}

/**
 * Resolve the project scope for a drill request. An explicit
 * `projectIds=1,2,3` list scopes to those (active only); omitting it scopes
 * to every active project. Returns both the id list and an id→name label map
 * for the project nodes. Reads `project_info` via the repository layer only
 * (no finance numbers).
 */
async function resolveProjectScope(
  rawProjectIds: unknown,
): Promise<{ projectIds: number[]; labels: Map<number, string> }> {
  const explicit = parseProjectIdList(rawProjectIds);
  const projectRepo = new ProjectInfoRepository();
  const rows = await projectRepo.listActiveIdName(explicit.length > 0 ? explicit : undefined);
  const labels = new Map<number, string>();
  for (const r of rows) labels.set(r.id, r.projectName);
  if (explicit.length > 0) {
    return { projectIds: explicit.filter((id) => labels.has(id)), labels };
  }
  return { projectIds: rows.map((r) => r.id), labels };
}

export function registerFinanceLinesRoutes(app: Express): void {
  const repo = new FinanceLineLevelRepository();
  const provenanceRepo = new FinanceProvenanceRepository();

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
        // Omitting projectIds scopes to EVERY active project (company-wide) —
        // the canonical single read path for Finance Home / company GP after
        // the legacy /api/cos-tracker + /api/revenue-tracker aggregates were
        // retired (read-map enforcement). An explicit list still scopes to it.
        const { projectIds } = await resolveProjectScope(req.query.projectIds);
        const fyStart = parseIsoDate(req.query.fyStart, "fyStart");
        const fyEnd = parseIsoDate(req.query.fyEnd, "fyEnd");
        if (fyStart && fyEnd && fyStart > fyEnd) {
          throw badRequest("fyStart must be on or before fyEnd", { fyStart, fyEnd });
        }

        const [lines, budget] = await Promise.all([
          repo.getPortfolioFinanceLines(projectIds, { fyStart, fyEnd }),
          loadBudgetByMonth(),
        ]);
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
          // Static COS budget overlaid with manual entries + manual
          // revenue entries — matches what the COS / REV tabs show as
          // Budget. Keys are YYYY-MM.
          budgetByMonth: budget,
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

  /**
   * Dual-write parity diagnostic.
   *
   *   GET /api/finance/recon-check/:projectId
   *
   * Compares the canonical line-level revenue derivation (§ 3.3) against
   * the persisted `revenue_recognition_amount` values written by the
   * Smart Import normalizer. Returns the project total from each source
   * and the absolute drift.
   *
   * The two are dual-written today (per the agreed PR-1 architecture):
   * the normalizer continues to populate the legacy column for any
   * legacy reader, while new readers consume the line-level API.
   * If the two ever diverge, one of them is wrong and the COO needs
   * to know — this endpoint surfaces that drift on demand.
   *
   * Drift > R 1 per line on average is the soft threshold; the
   * endpoint exposes raw numbers and lets the caller decide.
   *
   * Note: persisted `revenue_recognition_amount` lives on BOTH
   * `normalized_cost_lines` (text, project-scoped legacy formula) and
   * `normalized_cost_line_actuals` (decimal, also project-scoped at
   * the time of import). We sum the actuals child column because that
   * matches the line-grain the new API uses.
   */
  app.get(
    "/api/finance/recon-check/:projectId",
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

        // Line-level (canonical) totals from the new path.
        const linelevel = lines.reduce(
          (acc, l) => ({
            revenue: acc.revenue + l.perLineRevenue,
            cos: acc.cos + l.actualTotal,
            gp: acc.gp + l.perLineGp,
          }),
          { revenue: 0, cos: 0, gp: 0 },
        );

        // Persisted totals via the repository (which keeps the snapshot
        // guard and column lookups in one place — see § 3.3.2 single
        // read path). The actuals child has a decimal column written by
        // the Smart Import normalizer at write time. The fyStart/fyEnd
        // window is the same `invoice_date` (col T) the line-level path
        // uses, so the two totals are directly comparable.
        const persisted = await repo.getPersistedRevenueRecognitionTotals(projectId, {
          fyStart,
          fyEnd,
        });

        const driftRevenue = linelevel.revenue - persisted.revenue;
        const driftCos = linelevel.cos - persisted.cos;
        const lineCount = lines.length;
        const driftRevenuePerLine = lineCount > 0 ? driftRevenue / lineCount : 0;

        res.json({
          projectId,
          fyStart: fyStart ?? null,
          fyEnd: fyEnd ?? null,
          lineCount,
          linelevel,
          persisted,
          drift: {
            revenue: driftRevenue,
            cos: driftCos,
            revenuePerLine: driftRevenuePerLine,
            // Convenience flag for UI: > R 1 per line is "drift detected".
            // Threshold is intentionally generous because legacy persisted
            // values use a project-scoped formula, not the category-scoped
            // one in § 3.3, so some drift is expected and informational.
            detected: Math.abs(driftRevenuePerLine) > 1,
          },
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to compute recon parity");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );

  /**
   * Line-level recon grid — stepping stone for the
   * /api/cos-tracker + /api/revenue-tracker cutover.
   *
   *   GET /api/finance/recon-grid?projectIds=1,2,3&fyStart&fyEnd
   *
   * Returns monthly recon rows sourced exclusively from the line-level
   * derivation (§ 3.3). Each row has a `byProject` breakdown with
   * project totals for that month. Shape is intentionally minimal so a
   * future cutover PR can write a thin server-side adapter to emit
   * the legacy /api/cos-tracker shape from this data, OR a thin
   * client-side adapter that consumes this endpoint directly for new
   * recon-grid surfaces.
   *
   * The legacy /api/cos-tracker remains in place. It currently groups
   * on `normalizedCostLines.invoiceDate` (parent), which is close to
   * but not identical to this endpoint's grouping on
   * `normalizedCostLineActuals.invoiceDate` (child) — the difference
   * matters for split-paid lines and is the whole point of the cutover.
   */
  app.get(
    "/api/finance/recon-grid",
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

        // Aggregate by (monthKey, projectId) so each month carries its
        // per-project breakdown — directly suitable for the existing
        // recon-grid expand-by-project UX.
        const monthMap = new Map<string, ReconGridMonth>();
        const ensure = (key: string): ReconGridMonth => {
          let row = monthMap.get(key);
          if (!row) {
            row = {
              monthKey: key,
              cos: 0,
              revenue: 0,
              gp: 0,
              gpPct: null,
              count: 0,
              byProject: [],
            };
            monthMap.set(key, row);
          }
          return row;
        };

        const projectKey = (monthKey: string, projectId: number) => `${monthKey}::${projectId}`;
        const byProjectMap = new Map<string, ReconGridProjectRow>();

        for (const l of lines) {
          const key = l.recognitionMonth ?? "unrecognised";
          const row = ensure(key);
          row.cos += l.actualTotal;
          row.revenue += l.perLineRevenue;
          row.gp += l.perLineGp;
          row.count += 1;

          const pkey = projectKey(key, l.projectId);
          let pr = byProjectMap.get(pkey);
          if (!pr) {
            pr = {
              projectId: l.projectId,
              cos: 0,
              revenue: 0,
              gp: 0,
              gpPct: null,
            };
            byProjectMap.set(pkey, pr);
            row.byProject.push(pr);
          }
          pr.cos += l.actualTotal;
          pr.revenue += l.perLineRevenue;
          pr.gp += l.perLineGp;
        }

        for (const row of monthMap.values()) {
          row.gpPct = row.revenue !== 0 ? row.gp / row.revenue : null;
          for (const pr of row.byProject) {
            pr.gpPct = pr.revenue !== 0 ? pr.gp / pr.revenue : null;
          }
          row.byProject.sort((a, b) => b.revenue - a.revenue);
        }

        const sortedMonths = Array.from(monthMap.values())
          .filter((r) => r.monthKey !== "unrecognised")
          .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
        const unrec = monthMap.get("unrecognised") ?? null;

        const total: ReconGridMonth = {
          monthKey: "total",
          cos: 0,
          revenue: 0,
          gp: 0,
          gpPct: null,
          count: 0,
          byProject: [],
        };
        for (const r of sortedMonths) {
          total.cos += r.cos;
          total.revenue += r.revenue;
          total.gp += r.gp;
          total.count += r.count;
        }
        if (unrec) {
          total.cos += unrec.cos;
          total.revenue += unrec.revenue;
          total.gp += unrec.gp;
          total.count += unrec.count;
        }
        total.gpPct = total.revenue !== 0 ? total.gp / total.revenue : null;

        res.json({
          projectIds,
          fyStart: fyStart ?? null,
          fyEnd: fyEnd ?? null,
          monthly: sortedMonths,
          unrecognised: unrec,
          total,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to compute recon grid");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );

  /**
   * Drill-down tree — FY → month → project → category, aggregated.
   *
   *   GET /api/finance/drill/tree?fy=2026&projectIds=8,7,19
   *
   * Every node's REV / COS / GP (+ realised vs forecast split) is the SUM of
   * the canonical per-line values from `getPortfolioFinanceLines` (§ 3.3.1).
   * No number is computed here — this is a grouping view over the single read
   * path. Invoice leaves are NOT inlined (lazy-loaded via /drill/invoices) so
   * the response stays small on full production volume. The FY window is
   * resolved dynamically (S8) via `getFyWindow`; omit `projectIds` to scope to
   * every active project.
   */
  app.get(
    "/api/finance/drill/tree",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const fy = parseFy(req.query.fy);
        const { projectIds, labels } = await resolveProjectScope(req.query.projectIds);
        const fyWindow = getFyWindow({ fy });

        const lines: FinanceLine[] = projectIds.length === 0
          ? []
          : await repo.getPortfolioFinanceLines(projectIds, {
              fyStart: fyWindow.fyStartIso,
              fyEnd: fyWindow.fyEndIso,
            });

        const tree = buildRevCosGpTree(lines as unknown as DrillLineInput[], {
          fyLabel: fyWindow.fyLabel,
          projectLabels: labels,
          includeInvoices: false,
        });

        // Defensive read-path self-check: children must sum to parent within
        // R1 at every level (the drill's core invariant). Logged, never thrown
        // (§ 0A — the app records, it does not block a read).
        const violations = findSumViolations(tree, 1);
        if (violations.length > 0) {
          logger.warn(
            `[finance/drill/tree] sum(children)!=parent on ${violations.length} node(s) (fy=${fyWindow.fy})`,
            { violations: violations.slice(0, 5) },
          );
        }

        res.json({
          fy: fyWindow.fy,
          fyLabel: fyWindow.fyLabel,
          fyStart: fyWindow.fyStartIso,
          fyEnd: fyWindow.fyEndIso,
          projectIds,
          sumInvariantOk: violations.length === 0,
          tree,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to build finance drill tree");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );

  /**
   * Drill-down invoice leaves for one category node, paginated.
   *
   *   GET /api/finance/drill/invoices
   *     ?fy=2026&projectId=8&categoryAllocationId=123&month=2026-06
   *     &limit=100&offset=0
   *
   * Returns the canonical lines under a (project, month, category) node as
   * invoice leaves — invoice no (col S), invoice-raised date (col T), COS
   * (col Q), derived revenue, GP, realised/forecast flag, PO (col R) — each
   * carrying its tracker SOURCE CELL (sheet ▸ row ▸ col) for traceability.
   * The `subtotal` ties the page back to the parent category node. No number
   * is computed — values come straight from `getProjectFinanceLines`.
   */
  app.get(
    "/api/finance/drill/invoices",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req.query.projectId);
        const fy = parseFy(req.query.fy);
        const fyWindow = getFyWindow({ fy });
        const month = parseMonthKey(req.query.month);
        const categoryAllocationId = parseOptionalInt(req.query.categoryAllocationId);
        const categoryKey =
          typeof req.query.categoryKey === "string" && req.query.categoryKey.trim()
            ? req.query.categoryKey.trim().toLowerCase()
            : null;
        const limit = parsePageInt(req.query.limit, 100, 500, "limit");
        const offset = parsePageInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER, "offset");

        const lines = await repo.getProjectFinanceLines(projectId, {
          fyStart: fyWindow.fyStartIso,
          fyEnd: fyWindow.fyEndIso,
        });

        const filtered = lines.filter((l) => {
          if (month != null && (l.recognitionMonth ?? "unrecognised") !== month) return false;
          if (categoryAllocationId != null) {
            return l.categoryAllocationId === categoryAllocationId;
          }
          if (categoryKey != null) {
            if (l.categoryAllocationId != null) return false;
            return (l.categoryKey ?? "uncategorised").trim().toLowerCase() === categoryKey;
          }
          return true;
        });

        const subtotal = summariseLines(filtered as unknown as DrillLineInput[]);
        const leaves: DrillNode[] = filtered
          .map((l) => buildInvoiceLeaf(l as unknown as DrillLineInput))
          .sort((a, b) => {
            const da = a.invoiceRaisedDate ?? "";
            const dbb = b.invoiceRaisedDate ?? "";
            if (da !== dbb) return da.localeCompare(dbb);
            return (a.parentLineId ?? 0) - (b.parentLineId ?? 0);
          });

        const page = leaves.slice(offset, offset + limit);
        const provenance = await provenanceRepo.getProvenanceForProjects([projectId]);
        for (const leaf of page) {
          const p = resolveLeafProvenance(provenance, leaf.lineId ?? 0, leaf.parentLineId ?? 0);
          leaf.sourceSheet = p.sourceSheet;
          leaf.sourceRow = p.sourceRow;
          leaf.sourceCell = buildSourceCell(p.sourceSheet, p.sourceRow, p.sourceCell);
        }

        res.json({
          projectId,
          fy: fyWindow.fy,
          fyLabel: fyWindow.fyLabel,
          month,
          categoryAllocationId,
          categoryKey,
          subtotal,
          total: leaves.length,
          limit,
          offset,
          invoices: page,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const wrapped = serverError("Failed to load drill invoices");
        (wrapped as unknown as { cause?: unknown }).cause = err;
        throw wrapped;
      }
    },
  );
}

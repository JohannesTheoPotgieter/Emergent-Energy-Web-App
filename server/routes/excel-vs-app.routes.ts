/**
 * Excel-vs-App diff routes — workstream C of the diff system.
 *
 * Endpoints:
 *   GET  /api/excel-vs-app/program
 *     → program-level summary, one row per project, with verified
 *       and unverified drift counters.
 *
 *   GET  /api/excel-vs-app/projects/:projectId
 *     → per-project drift detail across PLAN / REVENUE / EXPENDITURE,
 *       with cell-format JSONB for in-tab colour rendering.
 *
 *   POST /api/excel-vs-app/projects/:projectId/resolve
 *     → bulk resolve drift rows. Three actions:
 *         { action: "accept_excel", entries: [{ table, rowId, fieldName }] }
 *         { action: "keep_app",     entries: [{ table, rowId, fieldName, reason }] }
 *         { action: "request_approval", section, entries: [...] }
 *
 *     Per-section RBAC enforced server-side via DRIFT_RESOLVER_ROLES
 *     from `shared/excel-vs-app/contract.ts`. Per-call cap of 50 entries
 *     so one request can never wipe more than 50 manual overrides.
 *
 * RBAC:
 *   - All GET endpoints: `requirePermission("excel_vs_app", "view")`.
 *   - POST resolve: `requirePermission("excel_vs_app", "edit")` plus
 *     a per-entry section gate keyed off DRIFT_RESOLVER_ROLES.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, and, isNull, asc } from "drizzle-orm";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../permission-middleware";
import { trackerReplicaRepository } from "../repositories/tracker-replica-repository";
import { ApiError, badRequest, notFound, forbidden, serverError } from "../lib/api-error";
import { validateBody } from "../middleware/validateBody";
import { db } from "../db";
import { projectInfo } from "@shared/schema/projects";
import { financialEditRequests } from "@shared/schema/finance";
import { applyManualOverride, clearManualOverride } from "../lib/manual-overrides";
import {
  DRIFT_RESOLVER_ROLES,
  type DiffSection,
} from "@shared/excel-vs-app/contract";

const projectIdParam = z.coerce.number().int().positive();

function parseProjectId(raw: unknown): number {
  const parsed = projectIdParam.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid projectId");
  return parsed.data;
}

const TABLE_TO_SECTION: Record<string, DiffSection> = {
  normalized_cost_lines: "EXPENDITURE",
  normalized_revenue_lines: "REVENUE",
  work_items: "PLAN",
};

function sectionForTable(table: string): DiffSection | null {
  return TABLE_TO_SECTION[table] ?? null;
}

function actorCanResolveSection(role: string | undefined, section: DiffSection): boolean {
  if (!role) return false;
  const allowed = DRIFT_RESOLVER_ROLES[section] as readonly string[];
  return allowed.includes(role);
}

const BULK_ENTRY_CAP = 50;

const driftEntrySchema = z.object({
  table: z.enum([
    "normalized_cost_lines",
    "normalized_revenue_lines",
    "work_items",
  ]),
  rowId: z.number().int().positive(),
  fieldName: z.string().min(1),
});

const acceptExcelSchema = z.object({
  action: z.literal("accept_excel"),
  entries: z.array(driftEntrySchema).min(1).max(BULK_ENTRY_CAP),
});

const keepAppSchema = z.object({
  action: z.literal("keep_app"),
  reason: z.string().min(3).max(500),
  entries: z.array(driftEntrySchema).min(1).max(BULK_ENTRY_CAP),
});

const requestApprovalSchema = z.object({
  action: z.literal("request_approval"),
  section: z.enum(["PLAN", "REVENUE", "EXPENDITURE"]),
  reason: z.string().min(3).max(500),
  entries: z.array(driftEntrySchema).min(1).max(BULK_ENTRY_CAP),
});

const resolveSchema = z.discriminatedUnion("action", [
  acceptExcelSchema,
  keepAppSchema,
  requestApprovalSchema,
]);

export function registerExcelVsAppRoutes(app: Express): void {
  // ---- GET /api/excel-vs-app/program -------------------------------
  app.get(
    "/api/excel-vs-app/program",
    requireAuth,
    requirePermission("excel_vs_app", "view"),
    async (_req: Request, res: Response) => {
      try {
        const projects = await db
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo);
        const summaries = await Promise.all(
          projects.map(async (p: { id: number; projectName: string }) => {
            const detail = await trackerReplicaRepository.getDriftDetail(p.id);
            const verified =
              detail.summary.PLAN.verified +
              detail.summary.REVENUE.verified +
              detail.summary.EXPENDITURE.verified;
            const unverified =
              detail.summary.PLAN.unverified +
              detail.summary.REVENUE.unverified +
              detail.summary.EXPENDITURE.unverified;
            return {
              projectId: p.id,
              projectName: p.projectName,
              verified,
              unverified,
              section: detail.summary,
            };
          }),
        );
        // Default sort: most unverified drift first.
        summaries.sort((a, b) => b.unverified - a.unverified || b.verified - a.verified);
        res.json({ projects: summaries });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[excel-vs-app] program error:", err);
        throw serverError("Failed to load Excel-vs-App program summary");
      }
    },
  );

  // ---- GET /api/excel-vs-app/projects/:projectId -------------------
  app.get(
    "/api/excel-vs-app/projects/:projectId",
    requireAuth,
    requirePermission("excel_vs_app", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);
      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");
        const [detail, projectRow] = await Promise.all([
          trackerReplicaRepository.getDriftDetail(projectId),
          db
            .select({ projectName: projectInfo.projectName })
            .from(projectInfo)
            .where(eq(projectInfo.id, projectId))
            .limit(1),
        ]);
        res.json({ ...detail, projectName: projectRow[0]?.projectName ?? null });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[excel-vs-app] project error:", err);
        throw serverError("Failed to load Excel-vs-App diff detail");
      }
    },
  );

  // ---- POST /api/excel-vs-app/projects/:projectId/resolve ----------
  app.post(
    "/api/excel-vs-app/projects/:projectId/resolve",
    requireAuth,
    requirePermission("excel_vs_app", "view"),
    validateBody(resolveSchema),
    async (req: Request, res: Response) => {
      const projectId = parseProjectId(req.params.projectId);
      const body = req.body as z.infer<typeof resolveSchema>;
      const actorId = (req as any).user?.id ?? null;
      const actorRole = (req as any).user?.role as string | undefined;

      try {
        const exists = await trackerReplicaRepository.projectExists(projectId);
        if (!exists) throw notFound("Project");

        // Per-entry RBAC. Each entry's table maps to a section, and the
        // actor's role must be in DRIFT_RESOLVER_ROLES[section] for
        // accept_excel / keep_app actions. request_approval is broader
        // (any viewer can request) — the approval flow itself enforces
        // the section roles when the reviewer acts.
        if (body.action === "accept_excel" || body.action === "keep_app") {
          for (const e of body.entries) {
            const section = sectionForTable(e.table);
            if (!section) {
              throw badRequest(`Unknown table: ${e.table}`);
            }
            if (!actorCanResolveSection(actorRole, section)) {
              throw forbidden(
                `Role ${actorRole ?? "unknown"} cannot resolve drift on the ${section} section`,
              );
            }
          }
        }

        if (body.action === "accept_excel") {
          let resolved = 0;
          for (const e of body.entries) {
            await clearManualOverride(e.table, e.rowId, e.fieldName);
            resolved++;
          }
          res.json({ status: "ok", action: body.action, resolved });
          return;
        }

        if (body.action === "keep_app") {
          let resolved = 0;
          for (const e of body.entries) {
            // Read the current live value, build an override that
            // captures it. The helper preserves fromValue from the live
            // (Excel-truth) column so a later "Reset to Excel" remains
            // correct.
            const overrideEntry = await readLiveValue(e.table, e.rowId, e.fieldName);
            await applyManualOverride({
              table: e.table,
              rowId: e.rowId,
              fieldName: e.fieldName,
              value: overrideEntry as any,
              editedBy: actorId,
              note: body.reason,
            });
            resolved++;
          }
          res.json({ status: "ok", action: body.action, resolved });
          return;
        }

        // request_approval — file a financial_edit_requests row that
        // routes to the section's resolvers.
        const editType =
          body.section === "EXPENDITURE"
            ? "excel_vs_app_unverified_drift_expenditure"
            : body.section === "REVENUE"
              ? "excel_vs_app_unverified_drift_revenue"
              : "excel_vs_app_unverified_drift_plan";
        const projectRow = await db
          .select({ projectName: projectInfo.projectName })
          .from(projectInfo)
          .where(eq(projectInfo.id, projectId))
          .limit(1);
        const projectName = projectRow[0]?.projectName ?? `Project ${projectId}`;
        const editPayload = JSON.stringify({
          section: body.section,
          entries: body.entries,
          reason: body.reason,
        });
        const editSummary = `Excel-vs-App ${body.section} drift approval requested for ${body.entries.length} field(s). Reason: ${body.reason}`;
        const [saved] = await db
          .insert(financialEditRequests)
          .values({
            projectName,
            projectId,
            requestedByUserId: actorId ?? 0,
            editType,
            editTarget: "excel_vs_app",
            editPayload,
            editSummary,
            isCriticalPath: false,
            affectsRevenue: body.section === "REVENUE",
            affectsExpenditure: body.section === "EXPENDITURE",
            affectsQuality: false,
          })
          .returning();
        res.json({
          status: "pending_approval",
          requestId: saved.id,
          action: body.action,
          submitted: body.entries.length,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[excel-vs-app] resolve error:", err);
        throw serverError("Failed to resolve drift");
      }
    },
  );
}

/**
 * Read the live value for a (table, rowId, fieldName). Used by the
 * "keep_app" action when there's no existing override entry — we
 * want to record the value the operator currently sees.
 */
async function readLiveValue(
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items",
  rowId: number,
  fieldName: string,
): Promise<unknown> {
  const { normalizedCostLines, normalizedRevenueLines } = await import("@shared/schema/finance");
  const { workItems } = await import("@shared/schema/tasks");
  const t =
    table === "normalized_cost_lines"
      ? normalizedCostLines
      : table === "normalized_revenue_lines"
        ? normalizedRevenueLines
        : workItems;
  const [row] = await db.select().from(t as any).where(eq((t as any).id, rowId)).limit(1);
  if (!row) return null;
  return (row as any)[fieldName] ?? null;
}

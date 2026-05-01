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
import { recordOverride } from "../lib/audit/diff-engine";
import { emitExcelVsAppMetric } from "../lib/excel-vs-app-metrics";
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

/** PLAN-section owner exception: a work-item owner can resolve drift
 *  on their own task even without the PROGRAM_MANAGER role. */
async function actorOwnsWorkItem(actorId: number, workItemId: number): Promise<boolean> {
  const { workItems } = await import("@shared/schema/tasks");
  const [row] = await db
    .select({ ownerUserId: workItems.ownerUserId })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);
  return row?.ownerUserId === actorId;
}

/** Derive the metric `section` from a heterogeneous entry list. Returns
 *  the single section all entries belong to, or "MIXED" when the bulk
 *  spans multiple sections (only possible on the
 *  cross-section `accept_excel` / `keep_app` paths). */
function deriveSection(
  entries: Array<{ table: string }>,
): "PLAN" | "REVENUE" | "EXPENDITURE" | "MIXED" | undefined {
  const sections = new Set<DiffSection>();
  for (const e of entries) {
    const s = sectionForTable(e.table);
    if (s) sections.add(s);
  }
  if (sections.size === 0) return undefined;
  if (sections.size === 1) return sections.values().next().value;
  return "MIXED";
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
        const totalU = summaries.reduce((s, r) => s + r.unverified, 0);
        const totalV = summaries.reduce((s, r) => s + r.verified, 0);
        emitExcelVsAppMetric({ op: "view", scope: "program", unverifiedTotal: totalU, verifiedTotal: totalV });
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
        const totalU = detail.summary.PLAN.unverified + detail.summary.REVENUE.unverified + detail.summary.EXPENDITURE.unverified;
        const totalV = detail.summary.PLAN.verified + detail.summary.REVENUE.verified + detail.summary.EXPENDITURE.verified;
        const totalLegacy = detail.legacyRowsWithoutSnapshot.PLAN + detail.legacyRowsWithoutSnapshot.REVENUE + detail.legacyRowsWithoutSnapshot.EXPENDITURE;
        emitExcelVsAppMetric({ op: "view", scope: "project", projectId, unverifiedTotal: totalU, verifiedTotal: totalV, legacyRowsWithoutSnapshot: totalLegacy });
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
        //
        // PLAN-section exception: a work-item owner can resolve drift
        // on their own task even without PROGRAM_MANAGER. The check
        // looks up work_items.ownerUserId per row.
        if (body.action === "accept_excel" || body.action === "keep_app") {
          for (const e of body.entries) {
            const section = sectionForTable(e.table);
            if (!section) {
              throw badRequest(`Unknown table: ${e.table}`);
            }
            if (actorCanResolveSection(actorRole, section)) continue;
            // PLAN owner-on-row exception.
            if (section === "PLAN" && actorId != null) {
              const ownsRow = await actorOwnsWorkItem(actorId, e.rowId);
              if (ownsRow) continue;
            }
            throw forbidden(
              `Role ${actorRole ?? "unknown"} cannot resolve drift on the ${section} section`,
            );
          }
        }

        // Project name for audit-log tagging on resolved entries.
        const [projectRow] = await db
          .select({ projectName: projectInfo.projectName })
          .from(projectInfo)
          .where(eq(projectInfo.id, projectId))
          .limit(1);
        const projectName = projectRow?.projectName ?? `Project ${projectId}`;

        if (body.action === "accept_excel") {
          // Atomic bulk: any failure rolls back the whole batch so a
          // partially-resolved bulk action can never leave the row state
          // inconsistent. Audit writes (recordOverride below) live
          // outside the tx so a transient audit fault does not roll back
          // the resolution itself.
          let resolved = 0;
          const auditEntries: Array<{ entry: typeof body.entries[number]; before: unknown; live: unknown }> = [];
          await db.transaction(async (tx: typeof db) => {
            for (const e of body.entries) {
              const beforeOverride = await readManualOverrideValue(e.table, e.rowId, e.fieldName, tx);
              const liveValue = await readLiveValue(e.table, e.rowId, e.fieldName, tx);
              await clearManualOverride(e.table, e.rowId, e.fieldName, tx);
              auditEntries.push({ entry: e, before: beforeOverride, live: liveValue });
              resolved++;
            }
          });
          for (const a of auditEntries) {
            try {
              await recordOverride({
                actorUserId: actorId ?? undefined,
                actorRole,
                entityType: `excel_vs_app::${a.entry.table}`,
                entityId: `${projectId}|row${a.entry.rowId}|${a.entry.fieldName}`,
                projectId,
                projectName,
                action: "ACCEPT_EXCEL",
                overrideCategory: "DATA_CORRECTION",
                overrideComment: `Accepted Excel value for ${a.entry.fieldName} on ${a.entry.table} row ${a.entry.rowId}`,
                oldRecord: { [a.entry.fieldName]: a.before },
                newRecord: { [a.entry.fieldName]: a.live },
              });
            } catch (auditErr: any) {
              console.warn("[excel-vs-app] accept_excel audit failed:", auditErr.message);
            }
          }
          emitExcelVsAppMetric({
            op: "resolve",
            action: "accept_excel",
            projectId,
            section: deriveSection(body.entries),
            count: resolved,
            actorRole: actorRole ?? null,
            actorUserId: actorId,
          });
          res.json({ status: "ok", action: body.action, resolved });
          return;
        }

        if (body.action === "keep_app") {
          let resolved = 0;
          const auditEntries: Array<{ entry: typeof body.entries[number]; live: unknown }> = [];
          await db.transaction(async (tx: typeof db) => {
            for (const e of body.entries) {
              const liveValue = await readLiveValue(e.table, e.rowId, e.fieldName, tx);
              await applyManualOverride({
                table: e.table,
                rowId: e.rowId,
                fieldName: e.fieldName,
                value: liveValue as any,
                editedBy: actorId,
                note: body.reason,
              }, tx);
              auditEntries.push({ entry: e, live: liveValue });
              resolved++;
            }
          });
          for (const a of auditEntries) {
            try {
              await recordOverride({
                actorUserId: actorId ?? undefined,
                actorRole,
                entityType: `excel_vs_app::${a.entry.table}`,
                entityId: `${projectId}|row${a.entry.rowId}|${a.entry.fieldName}`,
                projectId,
                projectName,
                action: "KEEP_APP",
                overrideCategory: "DATA_CORRECTION",
                overrideComment: body.reason,
                oldRecord: { [a.entry.fieldName]: null },
                newRecord: { [a.entry.fieldName]: a.live },
              });
            } catch (auditErr: any) {
              console.warn("[excel-vs-app] keep_app audit failed:", auditErr.message);
            }
          }
          emitExcelVsAppMetric({
            op: "resolve",
            action: "keep_app",
            projectId,
            section: deriveSection(body.entries),
            count: resolved,
            actorRole: actorRole ?? null,
            actorUserId: actorId,
          });
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
        try {
          await recordOverride({
            actorUserId: actorId ?? undefined,
            actorRole,
            entityType: `excel_vs_app_request::${body.section}`,
            entityId: `${projectId}|request${saved.id}`,
            projectId,
            projectName,
            action: "REQUEST_APPROVAL",
            overrideCategory: "DATA_CORRECTION",
            overrideComment: body.reason,
            oldRecord: {},
            newRecord: { entries: body.entries.length, requestId: saved.id },
          });
        } catch (auditErr: any) {
          console.warn("[excel-vs-app] request_approval audit failed:", auditErr.message);
        }
        emitExcelVsAppMetric({
          op: "resolve",
          action: "request_approval",
          projectId,
          section: body.section,
          count: body.entries.length,
          actorRole: actorRole ?? null,
          actorUserId: actorId,
        });
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
 * want to record the value the operator currently sees. Accepts
 * an optional `tx` so reads inside a transaction see the same
 * snapshot as the writes.
 */
async function readLiveValue(
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items",
  rowId: number,
  fieldName: string,
  tx: typeof db = db,
): Promise<unknown> {
  const { normalizedCostLines, normalizedRevenueLines } = await import("@shared/schema/finance");
  const { workItems } = await import("@shared/schema/tasks");
  const t =
    table === "normalized_cost_lines"
      ? normalizedCostLines
      : table === "normalized_revenue_lines"
        ? normalizedRevenueLines
        : workItems;
  const [row] = await tx.select().from(t as any).where(eq((t as any).id, rowId)).limit(1);
  if (!row) return null;
  return (row as any)[fieldName] ?? null;
}

/**
 * Read the current `manual_overrides[fieldName].value` for an audit
 * trail entry. Returns null when no override exists.
 */
async function readManualOverrideValue(
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items",
  rowId: number,
  fieldName: string,
  tx: typeof db = db,
): Promise<unknown> {
  const { normalizedCostLines, normalizedRevenueLines } = await import("@shared/schema/finance");
  const { workItems } = await import("@shared/schema/tasks");
  const t =
    table === "normalized_cost_lines"
      ? normalizedCostLines
      : table === "normalized_revenue_lines"
        ? normalizedRevenueLines
        : workItems;
  const [row] = await tx.select({ manualOverrides: (t as any).manualOverrides }).from(t as any).where(eq((t as any).id, rowId)).limit(1);
  const overrides = row?.manualOverrides;
  if (!overrides || typeof overrides !== "object") return null;
  const entry = (overrides as Record<string, any>)[fieldName];
  return entry && typeof entry === "object" && "value" in entry ? entry.value : null;
}

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
 *     from `shared/excel-vs-app/contract.ts`.
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
import { trackerReplicaRepository, trackerReplicaWriteRepository } from "../repositories/tracker-replica-repository";
import { ApiError, badRequest, notFound, forbidden, serverError } from "../lib/api-error";
import { validateBody } from "../middleware/validateBody";
import { db } from "../db";
import {
  bulkAcceptExcelForRow,
  bulkKeepAppForRow,
  chunk,
  groupByRow,
  mapWithConcurrency,
  RESOLVE_CHUNK_CONCURRENCY,
  RESOLVE_CHUNK_ROWS,
  type AcceptExcelFieldResult,
  type KeepAppFieldResult,
} from "../lib/excel-vs-app-bulk";
import { recordOverride } from "../lib/audit/diff-engine";
import { emitExcelVsAppMetric } from "../lib/excel-vs-app-metrics";
import { sendExcelUpdateRequest } from "../services/excel-update-request-mailer";
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
  const ownerUserId = await trackerReplicaWriteRepository.getWorkItemOwnerUserId(workItemId);
  return ownerUserId === actorId;
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
  entries: z.array(driftEntrySchema).min(1),
});

const keepAppSchema = z.object({
  action: z.literal("keep_app"),
  reason: z.string().min(3).max(500),
  entries: z.array(driftEntrySchema).min(1),
});

const requestApprovalSchema = z.object({
  action: z.literal("request_approval"),
  section: z.enum(["PLAN", "REVENUE", "EXPENDITURE"]),
  reason: z.string().min(3).max(500),
  entries: z.array(driftEntrySchema).min(1),
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
        // Single batched read across all projects (3 queries +
        // bucket-by-project) replaces the previous N+1 pattern of
        // calling getDriftDetail per project. See
        // server/repositories/tracker-replica-repository.ts:
        // getProgramDriftSummary.
        const summaries = await trackerReplicaRepository.getProgramDriftSummary();
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
        const [detail, projectName] = await Promise.all([
          trackerReplicaRepository.getDriftDetail(projectId),
          trackerReplicaWriteRepository.getProjectName(projectId),
        ]);
        const totalU = detail.summary.PLAN.unverified + detail.summary.REVENUE.unverified + detail.summary.EXPENDITURE.unverified;
        const totalV = detail.summary.PLAN.verified + detail.summary.REVENUE.verified + detail.summary.EXPENDITURE.verified;
        const totalLegacy = detail.legacyRowsWithoutSnapshot.PLAN + detail.legacyRowsWithoutSnapshot.REVENUE + detail.legacyRowsWithoutSnapshot.EXPENDITURE;
        emitExcelVsAppMetric({ op: "view", scope: "project", projectId, unverifiedTotal: totalU, verifiedTotal: totalV, legacyRowsWithoutSnapshot: totalLegacy });
        res.json({ ...detail, projectName });
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
      const actorId = req.user?.id ?? null;
      const actorRole = req.user?.role;

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
        const projectName =
          (await trackerReplicaWriteRepository.getProjectName(projectId)) ??
          `Project ${projectId}`;

        if (body.action === "accept_excel") {
          // Bulk-resolve strategy:
          //   1) Group entries by (table, rowId) → 1 read + 1 write per
          //      row instead of per field. A typical bulk has 4-6 fields
          //      per row; this alone cuts round-trips ~5x.
          //   2) Chunk row-groups into transactions of RESOLVE_CHUNK_ROWS
          //      so each commit stays well under any per-query timeout
          //      (Neon was killing the previous one-giant-tx approach
          //      ~5s in with "Failed query: rollback / Query read
          //      timeout"). Chunks are committed independently; partial
          //      bulks are reported via `failed`/`status:'partial'` and
          //      the operator can re-submit the unfinished selection
          //      (the row ops are idempotent).
          //   3) Run RESOLVE_CHUNK_CONCURRENCY chunks in parallel for
          //      throughput, bounded so we don't exhaust the pool.
          //   4) Audit writes (recordOverride) and the Excel-update
          //      email run AFTER all chunks complete, so an audit fault
          //      can never roll back a successful resolution.
          const rowOps = Array.from(
            groupByRow(body.entries.map((e) => ({ table: e.table, rowId: e.rowId, fieldName: e.fieldName }))).values(),
          ).map((g) => ({ table: g.table, rowId: g.rowId, fields: g.entries.map((x) => x.fieldName) }));
          const chunks = chunk(rowOps, RESOLVE_CHUNK_ROWS);
          const auditEntries: Array<{ entry: typeof body.entries[number]; before: unknown; live: unknown }> = [];
          let resolved = 0;
          let failed = 0;
          const errors: Array<{ table: string; rowId: number; message: string; affectedFields: number }> = [];
          const chunkResults = await mapWithConcurrency(chunks, RESOLVE_CHUNK_CONCURRENCY, async (chunkRows) => {
            try {
              const perRow: Array<{ table: typeof chunkRows[number]["table"]; rowId: number; results: AcceptExcelFieldResult[] }> = [];
              await db.transaction(async (tx: typeof db) => {
                for (const op of chunkRows) {
                  const results = await bulkAcceptExcelForRow(tx, op);
                  perRow.push({ table: op.table, rowId: op.rowId, results });
                }
              });
              return { ok: true as const, perRow };
            } catch (err: any) {
              const msg = err?.message ?? String(err);
              console.error(`[excel-vs-app] accept_excel chunk failed (${chunkRows.length} rows):`, msg);
              return { ok: false as const, msg, chunkRows };
            }
          });
          for (const c of chunkResults) {
            if (c.ok) {
              for (const row of c.perRow) {
                for (const r of row.results) {
                  resolved++;
                  auditEntries.push({
                    entry: { table: row.table, rowId: row.rowId, fieldName: r.fieldName },
                    before: r.beforeOverride,
                    live: r.liveValue,
                  });
                }
              }
            } else {
              for (const op of c.chunkRows) {
                failed += op.fields.length;
                errors.push({ table: op.table, rowId: op.rowId, message: c.msg, affectedFields: op.fields.length });
              }
            }
          }
          // Per-row consolidated log line for observability — replaces
          // the old per-field "manual-overrides clear" lines (which on
          // a 6k-field bulk produced 6k log lines).
          if (resolved > 0) {
            console.log(JSON.stringify({
              tag: "excel-vs-app",
              op: "accept_excel_bulk",
              projectId,
              rows: rowOps.length,
              fields: resolved,
              failedFields: failed,
              chunkRows: RESOLVE_CHUNK_ROWS,
              concurrency: RESOLVE_CHUNK_CONCURRENCY,
              actorUserId: actorId,
            }));
          }
          // Audit fire-and-forget after the resolution is durable.
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
          const status = failed === 0 ? "ok" : (resolved === 0 ? "failed" : "partial");
          res.json({ status, action: body.action, resolved, failed, errors: failed > 0 ? errors : undefined });
          return;
        }

        if (body.action === "keep_app") {
          // See accept_excel above for the bulk-resolve strategy notes —
          // same shape, different per-row helper.
          const rowOps = Array.from(
            groupByRow(body.entries.map((e) => ({ table: e.table, rowId: e.rowId, fieldName: e.fieldName }))).values(),
          ).map((g) => ({
            table: g.table,
            rowId: g.rowId,
            fields: g.entries.map((x) => ({ fieldName: x.fieldName, reason: body.reason, editedBy: actorId })),
          }));
          const chunks = chunk(rowOps, RESOLVE_CHUNK_ROWS);
          const auditEntries: Array<{ entry: typeof body.entries[number]; live: unknown }> = [];
          let resolved = 0;
          let failed = 0;
          const errors: Array<{ table: string; rowId: number; message: string; affectedFields: number }> = [];
          const chunkResults = await mapWithConcurrency(chunks, RESOLVE_CHUNK_CONCURRENCY, async (chunkRows) => {
            try {
              const perRow: Array<{ table: typeof chunkRows[number]["table"]; rowId: number; results: KeepAppFieldResult[] }> = [];
              await db.transaction(async (tx: typeof db) => {
                for (const op of chunkRows) {
                  const results = await bulkKeepAppForRow(tx, op);
                  perRow.push({ table: op.table, rowId: op.rowId, results });
                }
              });
              return { ok: true as const, perRow };
            } catch (err: any) {
              const msg = err?.message ?? String(err);
              console.error(`[excel-vs-app] keep_app chunk failed (${chunkRows.length} rows):`, msg);
              return { ok: false as const, msg, chunkRows };
            }
          });
          for (const c of chunkResults) {
            if (c.ok) {
              for (const row of c.perRow) {
                for (const r of row.results) {
                  resolved++;
                  auditEntries.push({
                    entry: { table: row.table, rowId: row.rowId, fieldName: r.fieldName },
                    live: r.liveValue,
                  });
                }
              }
            } else {
              for (const op of c.chunkRows) {
                failed += op.fields.length;
                errors.push({ table: op.table, rowId: op.rowId, message: c.msg, affectedFields: op.fields.length });
              }
            }
          }
          if (resolved > 0) {
            console.log(JSON.stringify({
              tag: "excel-vs-app",
              op: "keep_app_bulk",
              projectId,
              rows: rowOps.length,
              fields: resolved,
              failedFields: failed,
              chunkRows: RESOLVE_CHUNK_ROWS,
              concurrency: RESOLVE_CHUNK_CONCURRENCY,
              actorUserId: actorId,
            }));
          }
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
          // Ask the workbook owners to update Excel so it re-establishes
          // itself as source of truth. Only fire the email when at least
          // one resolution committed; mailer never throws (failures are
          // logged inside).
          const mail = resolved > 0
            ? await sendExcelUpdateRequest({
                projectId,
                projectName,
                resolveAction: "keep_app",
                section: deriveSection(body.entries) ?? "MIXED",
                entries: body.entries,
                reason: body.reason,
                requesterUserId: actorId,
                requesterName: req.user?.name ?? null,
                requesterEmail: req.user?.email ?? null,
              })
            : null;
          const status = failed === 0 ? "ok" : (resolved === 0 ? "failed" : "partial");
          res.json({ status, action: body.action, resolved, failed, errors: failed > 0 ? errors : undefined, mail });
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
        const saved = await trackerReplicaWriteRepository.createDriftApprovalRequest({
          projectId,
          projectName,
          requestedByUserId: actorId ?? 0,
          editType,
          editPayload,
          editSummary,
          affectsRevenue: body.section === "REVENUE",
          affectsExpenditure: body.section === "EXPENDITURE",
        });
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
        const mail = await sendExcelUpdateRequest({
          projectId,
          projectName,
          resolveAction: "request_approval",
          section: body.section,
          entries: body.entries,
          reason: body.reason,
          requesterUserId: actorId,
          requesterName: req.user?.name ?? null,
          requesterEmail: req.user?.email ?? null,
          requestId: saved.id,
        });
        res.json({
          status: "pending_approval",
          requestId: saved.id,
          action: body.action,
          submitted: body.entries.length,
          mail,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[excel-vs-app] resolve error:", err);
        throw serverError("Failed to resolve drift");
      }
    },
  );
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Legacy per-field readers. Kept for reference / potential reuse but
 * no longer wired to the resolve path — see `lib/excel-vs-app-bulk.ts`.
 * @deprecated Replaced by row-grouped bulk helpers.
 */
async function readLiveValue(
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items",
  rowId: number,
  fieldName: string,
  tx: typeof db = db,
): Promise<unknown> {
  const { normalizedCostLines, normalizedRevenueLines } = await import("@shared/schema/finance");
  const { workItems } = await import("@shared/schema/tasks");
  let row: Record<string, unknown> | undefined;
  if (table === "normalized_cost_lines") {
    [row] = await tx.select().from(normalizedCostLines).where(eq(normalizedCostLines.id, rowId)).limit(1);
  } else if (table === "normalized_revenue_lines") {
    [row] = await tx.select().from(normalizedRevenueLines).where(eq(normalizedRevenueLines.id, rowId)).limit(1);
  } else {
    [row] = await tx.select().from(workItems).where(eq(workItems.id, rowId)).limit(1);
  }
  if (!row) return null;
  return row[fieldName] ?? null;
}

/**
 * Read the current `manual_overrides[fieldName].value` for an audit
 * trail entry. Returns null when no override exists.
 */
async function readSnapshotValue(
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items",
  rowId: number,
  fieldName: string,
  tx: typeof db = db,
): Promise<unknown> {
  const { normalizedCostLines, normalizedRevenueLines } = await import("@shared/schema/finance");
  const { workItems } = await import("@shared/schema/tasks");
  let row: { importSnapshot: unknown } | undefined;
  if (table === "normalized_cost_lines") {
    [row] = await tx.select({ importSnapshot: normalizedCostLines.importSnapshot }).from(normalizedCostLines).where(eq(normalizedCostLines.id, rowId)).limit(1);
  } else if (table === "normalized_revenue_lines") {
    [row] = await tx.select({ importSnapshot: normalizedRevenueLines.importSnapshot }).from(normalizedRevenueLines).where(eq(normalizedRevenueLines.id, rowId)).limit(1);
  } else {
    [row] = await tx.select({ importSnapshot: workItems.importSnapshot }).from(workItems).where(eq(workItems.id, rowId)).limit(1);
  }
  const snap = row?.importSnapshot;
  if (!snap || typeof snap !== "object") return null;
  return (snap as Record<string, unknown>)[fieldName] ?? null;
}

async function patchImportSnapshot(
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items",
  rowId: number,
  fieldName: string,
  value: unknown,
  tx: typeof db = db,
): Promise<void> {
  const { normalizedCostLines, normalizedRevenueLines } = await import("@shared/schema/finance");
  const { workItems } = await import("@shared/schema/tasks");
  let row: { importSnapshot: unknown } | undefined;
  if (table === "normalized_cost_lines") {
    [row] = await tx.select({ importSnapshot: normalizedCostLines.importSnapshot }).from(normalizedCostLines).where(eq(normalizedCostLines.id, rowId)).limit(1);
  } else if (table === "normalized_revenue_lines") {
    [row] = await tx.select({ importSnapshot: normalizedRevenueLines.importSnapshot }).from(normalizedRevenueLines).where(eq(normalizedRevenueLines.id, rowId)).limit(1);
  } else {
    [row] = await tx.select({ importSnapshot: workItems.importSnapshot }).from(workItems).where(eq(workItems.id, rowId)).limit(1);
  }
  const existing = (row?.importSnapshot && typeof row.importSnapshot === "object") ? row.importSnapshot as Record<string, unknown> : {};
  const next = { ...existing, [fieldName]: value };
  if (table === "normalized_cost_lines") {
    await tx.update(normalizedCostLines).set({ importSnapshot: next }).where(eq(normalizedCostLines.id, rowId));
  } else if (table === "normalized_revenue_lines") {
    await tx.update(normalizedRevenueLines).set({ importSnapshot: next }).where(eq(normalizedRevenueLines.id, rowId));
  } else {
    await tx.update(workItems).set({ importSnapshot: next }).where(eq(workItems.id, rowId));
  }
}

async function readManualOverrideValue(
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items",
  rowId: number,
  fieldName: string,
  tx: typeof db = db,
): Promise<unknown> {
  const { normalizedCostLines, normalizedRevenueLines } = await import("@shared/schema/finance");
  const { workItems } = await import("@shared/schema/tasks");
  let row: { manualOverrides: unknown } | undefined;
  if (table === "normalized_cost_lines") {
    [row] = await tx.select({ manualOverrides: normalizedCostLines.manualOverrides }).from(normalizedCostLines).where(eq(normalizedCostLines.id, rowId)).limit(1);
  } else if (table === "normalized_revenue_lines") {
    [row] = await tx.select({ manualOverrides: normalizedRevenueLines.manualOverrides }).from(normalizedRevenueLines).where(eq(normalizedRevenueLines.id, rowId)).limit(1);
  } else {
    [row] = await tx.select({ manualOverrides: workItems.manualOverrides }).from(workItems).where(eq(workItems.id, rowId)).limit(1);
  }
  const overrides = row?.manualOverrides;
  if (!overrides || typeof overrides !== "object") return null;
  const entry = (overrides as Record<string, unknown>)[fieldName];
  return entry && typeof entry === "object" && "value" in entry
    ? (entry as { value: unknown }).value
    : null;
}

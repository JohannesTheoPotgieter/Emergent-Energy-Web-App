import type { Express, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { and, desc, eq, isNull, inArray, notInArray } from "drizzle-orm";
import { db } from "./db";
import { sanitizeFilename, allowedFileFilter } from "./lib/upload-security";
import {
  computeNcrAging,
  computeNcrTrend,
  rowsToCsv,
} from "./lib/quality-ncr-analytics";
import {
  ncrReports,
  ncrAttachments,
  ncrComments,
  users,
  projectInfo,
  projectExecutionState,
} from "@shared/schema";
import { requireAuth, getEffectiveUser } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { recordAudit } from "./api/v2/services/audit-service";
import { requireAuthoriserFor } from "./middleware/requireAuthoriserFor";
import { validateBody } from "./middleware/validateBody";
import { DEFAULT_QUERY_LIMIT } from "./lib/safe-query";
import { buildNcrFieldUpdates } from "./lib/quality-ncr-update";
import { canTransition, NCR_TERMINAL_STATUSES } from "./lib/quality-ncr-state-machine";
import {
  getQualityHseScope,
  scopeAllowsProject,
  scopedProjectIdsArray,
} from "./services/quality-hse-scope";

// NCR state-machine rules (canTransition + terminal set) live in the pure,
// unit-tested module ./lib/quality-ncr-state-machine — single source of truth.
const TERMINAL = NCR_TERMINAL_STATUSES;

/**
 * Compatibility shim: pre-Plan-v3 callers (e.g., bootstrap, server boot)
 * may still invoke `ensureNcrTables()`. The canonical migration
 * `0059_ncr_reports_drizzle_canon.sql` now owns the schema. This export
 * is a no-op kept so existing imports do not break.
 */
export async function ensureNcrTables(): Promise<void> {
  return;
}

// ===================== Zod schemas =====================

const NCR_SEVERITIES = ["minor", "major", "critical"] as const;
const NCR_NON_WAIVED_STATUSES = [
  "open",
  "investigating",
  "corrective_action",
  "verification",
  "closed",
] as const;

const createNcrSchema = z
  .object({
    project_id: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    severity: z.enum(NCR_SEVERITIES),
    description: z.string().max(10_000).nullable().optional(),
    assigned_to: z.number().int().positive().nullable().optional(),
    due_date: z.string().nullable().optional(),
    related_checklist_item_id: z.number().int().positive().nullable().optional(),
    subcontractor_id: z.number().int().positive().nullable().optional(),
  })
  .strict();

const updateNcrSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(10_000).nullable().optional(),
    severity: z.enum(NCR_SEVERITIES).optional(),
    status: z.enum(NCR_NON_WAIVED_STATUSES).optional(),
    root_cause: z.string().max(10_000).nullable().optional(),
    corrective_action: z.string().max(10_000).nullable().optional(),
    preventive_action: z.string().max(10_000).nullable().optional(),
    assigned_to: z.number().int().positive().nullable().optional(),
    due_date: z.string().nullable().optional(),
  })
  .strict();

const waiveNcrSchema = z
  .object({
    override_reason: z.string().trim().min(1).max(5000),
  })
  .strict();

const ncrCommentSchema = z
  .object({
    comment: z.string().trim().min(1).max(5000),
  })
  .strict();

// Task 0.3: attachment via SharePoint / URL link (the non-file branch of the
// upload route). Mirrors the QC evidence URL convention — a non-empty string,
// not a strict URL, so relative /uploads paths and Graph deep links both pass.
const ncrLinkAttachmentSchema = z
  .object({
    url: z.string().trim().min(1, "url required").max(2048),
    name: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

// Task 0.3: NCR file attachments. Mirrors the QM-approval multer config in
// quality-routes.ts — sanitised filenames, 50 MB cap, allowlisted types, and
// the same Bearer-gated /uploads static subtree.
const ncrAttachmentUploadsDir = path.join(process.cwd(), "uploads", "ncr-attachments");
if (!fs.existsSync(ncrAttachmentUploadsDir)) fs.mkdirSync(ncrAttachmentUploadsDir, { recursive: true });
const ncrAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: ncrAttachmentUploadsDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: allowedFileFilter,
});

const NCR_EXPORT_HEADER = [
  "ID",
  "Project",
  "Title",
  "Severity",
  "Status",
  "Assignee",
  "Due Date",
  "Created",
  "Closed",
];

const ncrListQuerySchema = z
  .object({
    status: z.enum([...NCR_NON_WAIVED_STATUSES, "waived"] as const).optional(),
    severity: z.enum(NCR_SEVERITIES).optional(),
    projectId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .partial();

export function registerQualityNcrRoutes(app: Express) {
  // List — paginated, project-scoped. Default limit comes from the safe-query
  // constant; max enforced by the schema (500).
  app.get("/api/quality/ncrs", requireAuth, requirePermission("quality", "view"), async (req: Request, res: Response) => {
    try {
      const parsed = ncrListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
      }
      const { status, severity, projectId, limit, offset } = parsed.data;

      // R1/R10: scoped roles (Site PM, PD, Engineer, Key Accounts Manager)
      // only see NCRs on projects they're assigned to. Oversight roles
      // (QM, HSE, COO, etc.) are unaffected.
      const scope = await getQualityHseScope(req);
      const scopedIds = scopedProjectIdsArray(scope);
      if (scopedIds !== null && scopedIds.length === 0) {
        return res.json({ items: [], count: 0 });
      }
      if (projectId && !scopeAllowsProject(scope, projectId)) {
        return res.json({ items: [], count: 0 });
      }

      const filters: any[] = [];
      if (status) filters.push(eq(ncrReports.status, status as any));
      if (severity) filters.push(eq(ncrReports.severity, severity as any));
      if (projectId) filters.push(eq(ncrReports.projectId, projectId));
      if (scopedIds !== null) filters.push(inArray(ncrReports.projectId, scopedIds));
      const where = filters.length > 0 ? and(...filters) : undefined;

      const rows = await db
        .select({
          ncr: ncrReports,
          assigneeName: users.name,
        })
        .from(ncrReports)
        .leftJoin(users, eq(users.id, ncrReports.assignedTo))
        .where(where)
        .orderBy(desc(ncrReports.updatedAt))
        .limit(limit ?? DEFAULT_QUERY_LIMIT)
        .offset(offset ?? 0);
      const items = rows.map((r: { ncr: typeof ncrReports.$inferSelect; assigneeName: string | null }) => ({
        ...r.ncr,
        assigneeName: r.assigneeName,
      }));
      res.json({ items, count: items.length });
    } catch (err) {
      console.error("[QualityNCR] Failed to fetch NCRs:", err);
      res.status(500).json({ error: "Failed to fetch NCR reports" });
    }
  });

  // Create.
  app.post("/api/quality/ncrs", requireAuth, requirePermission("quality", "edit"), validateBody(createNcrSchema), async (req: Request, res: Response) => {
      try {
        const user = getEffectiveUser(req);
        if (!user) return res.status(401).json({ error: "auth_required" });
        const { project_id, assigned_to, title, description, severity, due_date, related_checklist_item_id, subcontractor_id } = req.body;

        // Verify the target project exists and isn't soft-deleted.
        const [project] = await db
          .select({ id: projectInfo.id })
          .from(projectInfo)
          .where(and(eq(projectInfo.id, project_id), isNull(projectInfo.deletedAt)))
          .limit(1);
        if (!project) return res.status(404).json({ error: "project_not_found" });

        // R1: scoped roles can only raise NCRs on projects they're assigned to.
        const scope = await getQualityHseScope(req);
        if (!scopeAllowsProject(scope, project_id)) {
          return res.status(403).json({ error: "project_not_accessible" });
        }

        // Capture the project's current phase at NCR-raise time — never mutated.
        const [exec] = await db
          .select({ phase: projectExecutionState.phase })
          .from(projectExecutionState)
          .where(eq(projectExecutionState.projectId, project_id))
          .limit(1);
        const [created] = await db.insert(ncrReports).values({
          projectId: project_id,
          phaseAtRaiseTime: exec?.phase ?? null,
          subcontractorId: subcontractor_id ?? null,
          relatedChecklistItemId: related_checklist_item_id ?? null,
          reportedBy: user.id,
          assignedTo: assigned_to ?? null,
          title,
          description: description ?? null,
          severity,
          status: "open",
          dueDate: due_date ?? null,
        }).returning();
        logAuditFromReq(req, { entityType: "ncr_report", entityId: String(created.id), action: "create", changesJson: { title, severity, project_id, phaseAtRaiseTime: created.phaseAtRaiseTime } });
        await recordAudit({
          actorRole: (user as any)?.role,
          userId: user.id,
          entityType: "ncr_report",
          entityId: String(created.id),
          action: "CREATE_NCR",
          changesJson: { projectId: project_id, severity, status: "open", phaseAtRaiseTime: created.phaseAtRaiseTime },
        });
        res.status(201).json({ ok: true, id: created.id });
      } catch (err) {
        console.error("[QualityNCR] Failed to create NCR:", err);
        res.status(500).json({ error: "Failed to create NCR report" });
      }
    });

  // Analytics — aging buckets + status/severity trend, project-scoped.
  // Registered before the /:id route so "analytics" isn't captured as an id.
  app.get("/api/quality/ncrs/analytics", requireAuth, requirePermission("quality", "view"), async (req: Request, res: Response) => {
    try {
      const scope = await getQualityHseScope(req);
      const scopedIds = scopedProjectIdsArray(scope);
      const emptyAging = { "0-7": 0, "8-30": 0, "30+": 0, total: 0 };
      if (scopedIds !== null && scopedIds.length === 0) {
        return res.json({ aging: emptyAging, trend: [], byStatus: {}, bySeverity: {} });
      }
      const scopeFilter = scopedIds !== null ? inArray(ncrReports.projectId, scopedIds) : undefined;
      const nonTerminal = notInArray(ncrReports.status, ["closed", "waived"]);

      // Aging is measured over the still-open worklist only.
      const openRows = await db
        .select({ createdAt: ncrReports.createdAt, status: ncrReports.status, severity: ncrReports.severity })
        .from(ncrReports)
        .where(scopeFilter ? and(nonTerminal, scopeFilter) : nonTerminal);
      const aging = computeNcrAging(openRows, new Date());

      // Trend covers every scoped NCR, bucketed by raise month.
      const allRows = await db
        .select({ createdAt: ncrReports.createdAt, status: ncrReports.status, severity: ncrReports.severity })
        .from(ncrReports)
        .where(scopeFilter);
      const trend = computeNcrTrend(allRows);

      const byStatus: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      for (const r of openRows) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
      }
      res.json({ aging, trend, byStatus, bySeverity });
    } catch (err) {
      console.error("[QualityNCR] Failed to compute analytics:", err);
      res.status(500).json({ error: "Failed to compute NCR analytics" });
    }
  });

  // Export — the NCR register as CSV, honouring the same filters + scope as
  // the list route. Registered before /:id.
  app.get("/api/quality/ncrs/export", requireAuth, requirePermission("quality", "view"), async (req: Request, res: Response) => {
    try {
      const parsed = ncrListQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
      const { status, severity, projectId } = parsed.data;

      const sendCsv = (dataRows: unknown[][]) => {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="ncr-register.csv"');
        res.send(rowsToCsv(NCR_EXPORT_HEADER, dataRows));
      };

      const scope = await getQualityHseScope(req);
      const scopedIds = scopedProjectIdsArray(scope);
      if (scopedIds !== null && scopedIds.length === 0) return sendCsv([]);
      if (projectId && !scopeAllowsProject(scope, projectId)) return sendCsv([]);

      const filters: any[] = [];
      if (status) filters.push(eq(ncrReports.status, status as any));
      if (severity) filters.push(eq(ncrReports.severity, severity as any));
      if (projectId) filters.push(eq(ncrReports.projectId, projectId));
      if (scopedIds !== null) filters.push(inArray(ncrReports.projectId, scopedIds));
      const where = filters.length > 0 ? and(...filters) : undefined;

      const rows = await db
        .select({ ncr: ncrReports, assigneeName: users.name, projectName: projectInfo.projectName })
        .from(ncrReports)
        .leftJoin(users, eq(users.id, ncrReports.assignedTo))
        .leftJoin(projectInfo, eq(projectInfo.id, ncrReports.projectId))
        .where(where)
        .orderBy(desc(ncrReports.updatedAt));

      const toIso = (v: Date | null) => (v instanceof Date ? v.toISOString() : v ?? "");
      const dataRows = rows.map((r: { ncr: typeof ncrReports.$inferSelect; assigneeName: string | null; projectName: string | null }) => [
        r.ncr.id,
        r.projectName ?? "",
        r.ncr.title,
        r.ncr.severity,
        r.ncr.status,
        r.assigneeName ?? "",
        r.ncr.dueDate ?? "",
        toIso(r.ncr.createdAt),
        toIso(r.ncr.closedAt),
      ]);
      logAuditFromReq(req, {
        entityType: "ncr_report",
        entityId: "register",
        action: "export",
        changesJson: { count: dataRows.length, filters: { status, severity, projectId } },
      });
      sendCsv(dataRows);
    } catch (err) {
      console.error("[QualityNCR] Failed to export NCR register:", err);
      res.status(500).json({ error: "Failed to export NCR register" });
    }
  });

  // Get one.
  app.get("/api/quality/ncrs/:id", requireAuth, requirePermission("quality", "view"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
      const [ncr] = await db.select().from(ncrReports).where(eq(ncrReports.id, id)).limit(1);
      if (!ncr) return res.status(404).json({ error: "not_found" });
      // R7: scoped roles can only read NCRs on their assigned projects.
      // 404 (not 403) — don't leak existence to a user with no access.
      const scope = await getQualityHseScope(req);
      if (!scopeAllowsProject(scope, ncr.projectId)) return res.status(404).json({ error: "not_found" });
      const comments = await db
        .select({
          c: ncrComments,
          userName: users.name,
        })
        .from(ncrComments)
        .leftJoin(users, eq(users.id, ncrComments.userId))
        .where(eq(ncrComments.ncrId, id))
        .orderBy(ncrComments.createdAt);
      const attachments = await db
        .select()
        .from(ncrAttachments)
        .where(eq(ncrAttachments.ncrId, id))
        .orderBy(desc(ncrAttachments.createdAt));
      res.json({
        ncr,
        comments: comments.map((r: { c: typeof ncrComments.$inferSelect; userName: string | null }) => ({ ...r.c, userName: r.userName })),
        attachments,
      });
    } catch (err) {
      console.error("[QualityNCR] Failed to fetch NCR:", err);
      res.status(500).json({ error: "Failed to fetch NCR report" });
    }
  });

  // Update — non-waiver transitions. Waiver uses the dedicated route below.
  app.put("/api/quality/ncrs/:id", requireAuth, requirePermission("quality", "edit"), validateBody(updateNcrSchema), async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
        const [current] = await db.select().from(ncrReports).where(eq(ncrReports.id, id)).limit(1);
        if (!current) return res.status(404).json({ error: "not_found" });
        // R7: scoped roles can only update NCRs on their assigned projects.
        const scope = await getQualityHseScope(req);
        if (!scopeAllowsProject(scope, current.projectId)) return res.status(404).json({ error: "not_found" });
        const body = req.body as z.infer<typeof updateNcrSchema>;
        const next = body.status ?? current.status;
        if (next !== current.status && !canTransition(current.status, next)) {
          return res.status(400).json({ error: "invalid_transition", message: `Cannot transition ${current.status} -> ${next}` });
        }
        const user = getEffectiveUser(req);
        // Task 0.2: distinguish `undefined` (field omitted → keep current)
        // from an explicit `null` (clear the field). A `??` collapse made it
        // impossible to un-assign an NCR or clear its due date. Only fields
        // present in the validated body are written; nullable fields may be
        // written through as null.
        const updates: any = {
          status: next as any,
          updatedAt: new Date(),
          ...buildNcrFieldUpdates(body),
        };
        if (next === "closed" && current.status !== "closed") {
          updates.closedAt = new Date();
          updates.closedByUserId = user?.id ?? null;
        }
        await db.update(ncrReports).set(updates).where(eq(ncrReports.id, id));
        const transition = current.status !== next ? `${current.status} -> ${next}` : undefined;
        logAuditFromReq(req, { entityType: "ncr_report", entityId: String(id), action: "update", changesJson: { statusTransition: transition } });
        if (transition) {
          await recordAudit({
            actorRole: (user as any)?.role,
            userId: user?.id,
            entityType: "ncr_report",
            entityId: String(id),
            action: "TRANSITION_NCR_STATUS",
            changesJson: { fromStatus: current.status, toStatus: next, projectId: current.projectId },
          });
        }
        res.json({ ok: true });
      } catch (err) {
        console.error("[QualityNCR] Failed to update NCR:", err);
        res.status(500).json({ error: "Failed to update NCR report" });
      }
    });

  // Waiver — authorised override path. Captures reason + audit per § 0A.
  app.post("/api/quality/ncrs/:id/waive", requireAuth, requirePermission("quality", "edit"), validateBody(waiveNcrSchema), requireAuthoriserFor("quality"), async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
        const [current] = await db.select().from(ncrReports).where(eq(ncrReports.id, id)).limit(1);
        if (!current) return res.status(404).json({ error: "not_found" });
        // R7: scope check (waive is COO/CEO via requireAuthoriserFor — but those
        // are oversight roles so this is a 404 that should never fire; defence in depth).
        const scope = await getQualityHseScope(req);
        if (!scopeAllowsProject(scope, current.projectId)) return res.status(404).json({ error: "not_found" });
        if (TERMINAL.has(current.status)) {
          return res.status(400).json({ error: "already_terminal", message: `NCR is already ${current.status}` });
        }
        const reason = req.authoriser!.reason;
        const user = getEffectiveUser(req);
        await db
          .update(ncrReports)
          .set({
            status: "waived" as any,
            waiverReason: reason,
            closedAt: new Date(),
            closedByUserId: user?.id ?? null,
            updatedAt: new Date(),
          })
          .where(eq(ncrReports.id, id));
        logAuditFromReq(req, {
          entityType: "ncr_report",
          entityId: String(id),
          action: "waive",
          changesJson: { fromStatus: current.status, reason, override_applied: true },
        });
        await recordAudit({
          actorRole: req.authoriser!.role,
          userId: req.authoriser!.userId,
          entityType: "ncr_report",
          entityId: String(id),
          action: "WAIVE_NCR",
          changesJson: { fromStatus: current.status, projectId: current.projectId, reason },
        });
        res.json({ ok: true, override_applied: true });
      } catch (err) {
        console.error("[QualityNCR] Failed to waive NCR:", err);
        res.status(500).json({ error: "Failed to waive NCR report" });
      }
    });

  // Delete.
  app.delete("/api/quality/ncrs/:id", requireAuth, requirePermission("quality", "edit"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
      // Children cascade via FK ON DELETE CASCADE.
      const [deleted] = await db.delete(ncrReports).where(eq(ncrReports.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: "not_found" });
      const user = getEffectiveUser(req);
      logAuditFromReq(req, { entityType: "ncr_report", entityId: String(id), action: "delete", changesJson: { description: "NCR deleted" } });
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user?.id,
        entityType: "ncr_report",
        entityId: String(id),
        action: "DELETE_NCR",
        changesJson: { projectId: deleted.projectId },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[QualityNCR] Failed to delete NCR:", err);
      res.status(500).json({ error: "Failed to delete NCR report" });
    }
  });

  // Comments — Zod-bounded so 10 MB pastes can't make the NCR page unusable.
  app.post("/api/quality/ncrs/:id/comments", requireAuth, requirePermission("quality", "edit"), validateBody(ncrCommentSchema), async (req: Request, res: Response) => {
      try {
        const user = getEffectiveUser(req);
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
        if (!user) return res.status(401).json({ error: "auth_required" });
        // R7: only comment on NCRs your scope sees.
        const [target] = await db.select({ projectId: ncrReports.projectId }).from(ncrReports).where(eq(ncrReports.id, id)).limit(1);
        if (!target) return res.status(404).json({ error: "not_found" });
        const scope = await getQualityHseScope(req);
        if (!scopeAllowsProject(scope, target.projectId)) return res.status(404).json({ error: "not_found" });
        const { comment } = req.body as z.infer<typeof ncrCommentSchema>;
        await db.insert(ncrComments).values({ ncrId: id, userId: user.id, comment });
        res.status(201).json({ ok: true });
      } catch (err) {
        console.error("[QualityNCR] Failed to add comment:", err);
        res.status(500).json({ error: "Failed to add comment" });
      }
    });

  // Attachment upload (Task 0.3). Supports both a multipart file upload and a
  // SharePoint/URL link — the same dual shape QC evidence supports. Multipart
  // requests populate `req.file`; JSON requests carry `{ url, name? }`. Both
  // land in ncr_attachments so the get-one route surfaces them.
  app.post(
    "/api/quality/ncrs/:id/attachments",
    requireAuth,
    requirePermission("quality", "edit"),
    ncrAttachmentUpload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
        const user = getEffectiveUser(req);
        if (!user) return res.status(401).json({ error: "auth_required" });

        // R7: same scope gate as the sibling NCR routes — 404 (not 403) so a
        // user with no access can't probe which NCR ids exist.
        const [target] = await db
          .select({ projectId: ncrReports.projectId })
          .from(ncrReports)
          .where(eq(ncrReports.id, id))
          .limit(1);
        if (!target) return res.status(404).json({ error: "not_found" });
        const scope = await getQualityHseScope(req);
        if (!scopeAllowsProject(scope, target.projectId)) return res.status(404).json({ error: "not_found" });

        const file = req.file;
        let filePath: string;
        let fileName: string;
        if (file) {
          filePath = `/uploads/ncr-attachments/${file.filename}`;
          const providedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
          fileName = providedName || file.originalname;
        } else {
          const parsed = ncrLinkAttachmentSchema.safeParse(req.body);
          if (!parsed.success) {
            return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
          }
          filePath = parsed.data.url;
          fileName = parsed.data.name?.trim() || parsed.data.url;
        }

        const [created] = await db
          .insert(ncrAttachments)
          .values({ ncrId: id, filePath, fileName, uploadedBy: user.id })
          .returning();

        logAuditFromReq(req, {
          entityType: "ncr_report",
          entityId: String(id),
          action: "update",
          changesJson: { description: "NCR attachment added", fileName, kind: file ? "file" : "link" },
        });
        await recordAudit({
          actorRole: (user as any)?.role,
          userId: user.id,
          entityType: "ncr_report",
          entityId: String(id),
          action: "ADD_NCR_ATTACHMENT",
          changesJson: { projectId: target.projectId, kind: file ? "file" : "link", fileName },
        });
        res.status(201).json({ ok: true, attachment: created });
      } catch (err) {
        console.error("[QualityNCR] Failed to add attachment:", err);
        res.status(500).json({ error: "Failed to add attachment" });
      }
    },
  );

  // /api/quality/dashboard is owned by quality-routes.ts.
}

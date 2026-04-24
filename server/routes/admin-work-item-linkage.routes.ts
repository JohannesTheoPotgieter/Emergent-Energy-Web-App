import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../departments/shared-middleware";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { db } from "../db";
import { engineeringTickets, projectInfo, workItems } from "@shared/schema";

type OrphanRow = {
  workItemId: number;
  workItemTitle: string;
  workItemStatus: string | null;
  workItemPhase: string | null;
  ownerName: string | null;
  projectId: number | null;
  projectName: string | null;
  // Task #61: canonical names. Legacy `pdTicket*` keys are mirrored below
  // and kept for one release.
  engineeringTicketId: number | null;
  engineeringTicketDeleted: boolean;
  engineeringTicketRequestType: string | null;
  /** @deprecated Use `engineeringTicketId` (task #61). */
  pdTicketId: number | null;
  /** @deprecated Use `engineeringTicketDeleted` (task #61). */
  pdTicketDeleted: boolean;
  /** @deprecated Use `engineeringTicketRequestType` (task #61). */
  pdTicketRequestType: string | null;
  reason: "missing" | "soft_deleted" | "unlinked";
};

type LiveTicketChoice = {
  id: number;
  requestType: string;
  status: string;
  dueDate: string | null;
};

export function registerAdminWorkItemLinkageRoutes(app: Express) {
  app.get(
    "/api/admin/work-item-linkage/orphans",
    requireAuth,
    requirePermission("admin", "view"),
    async (req: Request, res: Response) => {
      try {
        // (a) work_items pointing to a deleted/missing PD ticket
        const brokenLinkRows = await db
          .select({
            workItemId: workItems.id,
            workItemTitle: workItems.title,
            workItemStatus: workItems.status,
            workItemPhase: workItems.phase,
            ownerName: workItems.ownerName,
            projectId: workItems.projectId,
            projectName: projectInfo.projectName,
            pdTicketId: workItems.engineeringTicketId,
            pdTicketDeletedAt: engineeringTickets.deletedAt,
            pdTicketIdResolved: engineeringTickets.id,
            pdTicketRequestType: engineeringTickets.requestType,
          })
          .from(workItems)
          .leftJoin(engineeringTickets, eq(engineeringTickets.id, workItems.engineeringTicketId))
          .leftJoin(projectInfo, eq(projectInfo.id, workItems.projectId))
          .where(
            and(
              isNull(workItems.deletedAt),
              isNotNull(workItems.engineeringTicketId),
              sql`(${engineeringTickets.id} IS NULL OR ${engineeringTickets.deletedAt} IS NOT NULL)`,
            ),
          )
          .orderBy(asc(workItems.id))
          .limit(500);

        // (b) work_items with NULL pd_ticket_id but whose project has live tickets
        const unlinkedRows = await db
          .select({
            workItemId: workItems.id,
            workItemTitle: workItems.title,
            workItemStatus: workItems.status,
            workItemPhase: workItems.phase,
            ownerName: workItems.ownerName,
            projectId: workItems.projectId,
            projectName: projectInfo.projectName,
          })
          .from(workItems)
          .innerJoin(projectInfo, and(eq(projectInfo.id, workItems.projectId), isNull(projectInfo.deletedAt)))
          .where(
            and(
              isNull(workItems.deletedAt),
              isNull(workItems.engineeringTicketId),
              sql`EXISTS (SELECT 1 FROM ${engineeringTickets} pt WHERE pt.project_id = ${workItems.projectId} AND pt.deleted_at IS NULL)`,
            ),
          )
          .orderBy(asc(workItems.id))
          .limit(500);

        const broken: OrphanRow[] = brokenLinkRows.map((r: typeof brokenLinkRows[number]) => ({
          workItemId: r.workItemId,
          workItemTitle: r.workItemTitle,
          workItemStatus: r.workItemStatus ?? null,
          workItemPhase: r.workItemPhase ?? null,
          ownerName: r.ownerName ?? null,
          projectId: r.projectId ?? null,
          projectName: r.projectName ?? null,
          engineeringTicketId: r.pdTicketId ?? null,
          engineeringTicketDeleted: !!r.pdTicketDeletedAt,
          engineeringTicketRequestType: r.pdTicketRequestType ?? null,
          pdTicketId: r.pdTicketId ?? null,
          pdTicketDeleted: !!r.pdTicketDeletedAt,
          pdTicketRequestType: r.pdTicketRequestType ?? null,
          reason: r.pdTicketIdResolved == null ? "missing" : "soft_deleted",
        }));

        const unlinked: OrphanRow[] = unlinkedRows.map((r: typeof unlinkedRows[number]) => ({
          workItemId: r.workItemId,
          workItemTitle: r.workItemTitle,
          workItemStatus: r.workItemStatus ?? null,
          workItemPhase: r.workItemPhase ?? null,
          ownerName: r.ownerName ?? null,
          projectId: r.projectId ?? null,
          projectName: r.projectName ?? null,
          engineeringTicketId: null,
          engineeringTicketDeleted: false,
          engineeringTicketRequestType: null,
          pdTicketId: null,
          pdTicketDeleted: false,
          pdTicketRequestType: null,
          reason: "unlinked",
        }));

        const allRows = [...broken, ...unlinked];

        // Resolve picker options: live PD tickets per affected project.
        const projectIds = Array.from(
          new Set(allRows.map((r) => r.projectId).filter((id): id is number => typeof id === "number")),
        );

        const ticketChoicesByProject = new Map<number, LiveTicketChoice[]>();
        if (projectIds.length > 0) {
          const liveTickets = await db
            .select({
              id: engineeringTickets.id,
              projectId: engineeringTickets.projectId,
              requestType: engineeringTickets.requestType,
              status: engineeringTickets.status,
              dueDate: engineeringTickets.dueDate,
            })
            .from(engineeringTickets)
            .where(and(isNull(engineeringTickets.deletedAt), inArray(engineeringTickets.projectId, projectIds)))
            .orderBy(asc(engineeringTickets.id));

          for (const t of liveTickets) {
            if (t.projectId == null) continue;
            const list = ticketChoicesByProject.get(t.projectId) ?? [];
            list.push({
              id: t.id,
              requestType: t.requestType,
              status: t.status,
              dueDate: t.dueDate ?? null,
            });
            ticketChoicesByProject.set(t.projectId, list);
          }
        }

        const ticketChoices: Record<number, LiveTicketChoice[]> = {};
        for (const [pid, list] of ticketChoicesByProject) ticketChoices[pid] = list;

        logAuditFromReq(req, {
          entityType: "work_item_linkage",
          entityId: "list",
          action: "view",
          changesJson: {
            brokenCount: broken.length,
            unlinkedCount: unlinked.length,
          },
        });

        res.json({
          generatedAt: new Date().toISOString(),
          counts: {
            brokenLink: broken.length,
            unlinkedButProjectHasTickets: unlinked.length,
            total: allRows.length,
          },
          rows: allRows,
          ticketChoicesByProject: ticketChoices,
        });
      } catch (err: any) {
        console.error("[admin-work-item-linkage] list failed:", err);
        res.status(500).json({ error: "Failed to list orphan work items" });
      }
    },
  );

  // Task #61: accept either the canonical `engineeringTicketId` or the
  // legacy `pdTicketId`. Exactly one must be provided; if both are present
  // they must agree.
  const relinkBody = z
    .object({
      engineeringTicketId: z.number().int().positive().optional(),
      pdTicketId: z.number().int().positive().optional(),
    })
    .refine(
      (b) =>
        (b.engineeringTicketId !== undefined || b.pdTicketId !== undefined) &&
        (b.engineeringTicketId === undefined ||
          b.pdTicketId === undefined ||
          b.engineeringTicketId === b.pdTicketId),
      { message: "Provide engineeringTicketId (or legacy pdTicketId)." },
    );

  app.post(
    "/api/admin/work-item-linkage/:workItemId/relink",
    requireAuth,
    requirePermission("admin", "edit"),
    async (req: Request, res: Response) => {
      try {
        const workItemId = Number(req.params.workItemId);
        if (!Number.isFinite(workItemId) || workItemId <= 0) {
          return res.status(400).json({ error: "invalid_work_item_id" });
        }
        const parsed = relinkBody.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
        }
        const targetTicketId =
          parsed.data.engineeringTicketId ?? (parsed.data.pdTicketId as number);

        const wiRows = await db
          .select({
            id: workItems.id,
            projectId: workItems.projectId,
            engineeringTicketId: workItems.engineeringTicketId,
          })
          .from(workItems)
          .where(and(eq(workItems.id, workItemId), isNull(workItems.deletedAt)))
          .limit(1);
        const wi = wiRows[0];
        if (!wi) return res.status(404).json({ error: "work_item_not_found" });

        const ticketRows = await db
          .select({
            id: engineeringTickets.id,
            projectId: engineeringTickets.projectId,
            deletedAt: engineeringTickets.deletedAt,
          })
          .from(engineeringTickets)
          .where(eq(engineeringTickets.id, targetTicketId))
          .limit(1);
        const ticket = ticketRows[0];
        if (!ticket || ticket.deletedAt) {
          return res.status(404).json({ error: "ticket_not_found_or_deleted" });
        }

        if (wi.projectId == null || ticket.projectId == null || wi.projectId !== ticket.projectId) {
          return res.status(409).json({
            error: "project_mismatch",
            message: "Work item and ticket must belong to the same project.",
          });
        }

        const previousEngineeringTicketId = wi.engineeringTicketId ?? null;

        await db
          .update(workItems)
          .set({ engineeringTicketId: ticket.id, updatedAt: new Date() })
          .where(eq(workItems.id, workItemId));

        logAuditFromReq(req, {
          entityType: "work_item",
          entityId: String(workItemId),
          action: "linkage_repair_relink",
          changesJson: {
            previousEngineeringTicketId,
            newEngineeringTicketId: ticket.id,
            projectId: wi.projectId,
          },
        });

        // Task #61: emit canonical + legacy keys in the response.
        res.json({
          ok: true,
          workItemId,
          engineeringTicketId: ticket.id,
          previousEngineeringTicketId,
          /** @deprecated use `engineeringTicketId` */
          pdTicketId: ticket.id,
          /** @deprecated use `previousEngineeringTicketId` */
          previousPdTicketId: previousEngineeringTicketId,
        });
      } catch (err: any) {
        console.error("[admin-work-item-linkage] relink failed:", err);
        res.status(500).json({ error: "Failed to relink work item" });
      }
    },
  );

  app.post(
    "/api/admin/work-item-linkage/:workItemId/standalone",
    requireAuth,
    requirePermission("admin", "edit"),
    async (req: Request, res: Response) => {
      try {
        const workItemId = Number(req.params.workItemId);
        if (!Number.isFinite(workItemId) || workItemId <= 0) {
          return res.status(400).json({ error: "invalid_work_item_id" });
        }

        const wiRows = await db
          .select({
            id: workItems.id,
            engineeringTicketId: workItems.engineeringTicketId,
            projectId: workItems.projectId,
          })
          .from(workItems)
          .where(and(eq(workItems.id, workItemId), isNull(workItems.deletedAt)))
          .limit(1);
        const wi = wiRows[0];
        if (!wi) return res.status(404).json({ error: "work_item_not_found" });

        const previousEngineeringTicketId = wi.engineeringTicketId ?? null;

        if (previousEngineeringTicketId !== null) {
          await db
            .update(workItems)
            .set({ engineeringTicketId: null, updatedAt: new Date() })
            .where(eq(workItems.id, workItemId));
        }

        logAuditFromReq(req, {
          entityType: "work_item",
          entityId: String(workItemId),
          action: "linkage_repair_standalone",
          changesJson: {
            previousEngineeringTicketId,
            projectId: wi.projectId ?? null,
          },
        });

        // Task #61: emit canonical + legacy keys.
        res.json({
          ok: true,
          workItemId,
          previousEngineeringTicketId,
          /** @deprecated use `previousEngineeringTicketId` */
          previousPdTicketId: previousEngineeringTicketId,
        });
      } catch (err: any) {
        console.error("[admin-work-item-linkage] standalone failed:", err);
        res.status(500).json({ error: "Failed to convert work item to standalone" });
      }
    },
  );

  // One-shot, idempotent backfill: for every non-deleted engineering_tickets
  // row that has no matching ENG work_items row, insert one. Mirrors the
  // logic of migrations/0032_backfill_work_items_from_engineering_tickets.sql
  // so production can be fixed via a single authenticated POST without
  // requiring shell access. Safe to call repeatedly — the NOT EXISTS guard
  // skips any ticket already linked.
  app.post(
    "/api/admin/work-item-linkage/backfill-from-tickets",
    requireAuth,
    requirePermission("admin", "edit"),
    async (req: Request, res: Response) => {
      try {
        // Caller (admin) is the deterministic created_by fallback. Falls
        // back to MIN(users.id) only if for any reason req.user.id is
        // missing — both keep the FK satisfied and lineage auditable.
        const actorUserId =
          (req as any).user?.id != null ? Number((req as any).user.id) : null;

        // Self-bootstrap: ensure the partial unique index exists before
        // the ON CONFLICT clause references it. This makes the endpoint
        // safe to call on environments where migration 0032 has not been
        // applied separately (e.g. production on first run). Idempotent.
        await db.execute(sql`
          CREATE UNIQUE INDEX IF NOT EXISTS work_items_active_eng_ticket_uniq
            ON work_items (engineering_ticket_id)
            WHERE workstream = 'ENG'
              AND deleted_at IS NULL
              AND engineering_ticket_id IS NOT NULL
        `);

        const result = await db.execute(sql`
          INSERT INTO work_items (
            client_id, project_id, workstream, source, type,
            title, description, status, priority, phase, end_date,
            owner_user_id, engineering_ticket_id, created_by,
            created_at, updated_at
          )
          SELECT
            et.client_id,
            et.project_id,
            'ENG'::work_item_workstream,
            'SYSTEM'::work_item_source,
            'task',
            et.project_site_name,
            et.comments,
            'to_do',
            CASE
              WHEN et.priority = 'Medium' THEN 'Med'
              WHEN et.priority = 'Critical' THEN 'Urgent'
              WHEN et.priority IN ('Low', 'Med', 'High', 'Urgent') THEN et.priority
              ELSE 'Med'
            END,
            et.request_type,
            CASE
              WHEN et.due_date ~ '^\d{4}-\d{2}-\d{2}$' THEN et.due_date::date
              ELSE NULL
            END,
            NULL,
            et.id,
            COALESCE(${actorUserId}, et.created_by, (SELECT MIN(id) FROM users)),
            COALESCE(et.created_at, now()),
            now()
          FROM engineering_tickets et
          WHERE et.deleted_at IS NULL
            AND et.project_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM work_items wi
              WHERE wi.engineering_ticket_id = et.id
                AND wi.workstream = 'ENG'
                AND wi.deleted_at IS NULL
            )
          ON CONFLICT (engineering_ticket_id)
            WHERE workstream = 'ENG'
              AND deleted_at IS NULL
              AND engineering_ticket_id IS NOT NULL
            DO NOTHING
          RETURNING id, engineering_ticket_id, project_id
        `);

        const rows = (result as any).rows ?? (result as any) ?? [];
        const inserted = Array.isArray(rows) ? rows.length : 0;

        logAuditFromReq(req, {
          entityType: "work_item",
          entityId: "backfill",
          action: "backfill_from_engineering_tickets",
          changesJson: {
            insertedCount: inserted,
            insertedIds: Array.isArray(rows)
              ? rows.slice(0, 100).map((r: any) => r.id)
              : [],
          },
        });

        res.json({
          ok: true,
          insertedCount: inserted,
          inserted: Array.isArray(rows) ? rows : [],
        });
      } catch (err: any) {
        console.error("[admin-work-item-linkage] backfill failed:", err);
        res.status(500).json({ error: err?.message || "Backfill failed" });
      }
    },
  );
}

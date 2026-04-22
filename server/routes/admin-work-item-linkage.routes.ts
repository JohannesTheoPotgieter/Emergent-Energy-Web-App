import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../departments/shared-middleware";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { db } from "../db";
import { pdTickets, projectInfo, workItems } from "@shared/schema";

type OrphanRow = {
  workItemId: number;
  workItemTitle: string;
  workItemStatus: string | null;
  workItemPhase: string | null;
  ownerName: string | null;
  projectId: number | null;
  projectName: string | null;
  pdTicketId: number | null;
  pdTicketDeleted: boolean;
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
            pdTicketId: workItems.pdTicketId,
            pdTicketDeletedAt: pdTickets.deletedAt,
            pdTicketIdResolved: pdTickets.id,
            pdTicketRequestType: pdTickets.requestType,
          })
          .from(workItems)
          .leftJoin(pdTickets, eq(pdTickets.id, workItems.pdTicketId))
          .leftJoin(projectInfo, eq(projectInfo.id, workItems.projectId))
          .where(
            and(
              isNull(workItems.deletedAt),
              isNotNull(workItems.pdTicketId),
              sql`(${pdTickets.id} IS NULL OR ${pdTickets.deletedAt} IS NOT NULL)`,
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
              isNull(workItems.pdTicketId),
              sql`EXISTS (SELECT 1 FROM ${pdTickets} pt WHERE pt.project_id = ${workItems.projectId} AND pt.deleted_at IS NULL)`,
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
              id: pdTickets.id,
              projectId: pdTickets.projectId,
              requestType: pdTickets.requestType,
              status: pdTickets.status,
              dueDate: pdTickets.dueDate,
            })
            .from(pdTickets)
            .where(and(isNull(pdTickets.deletedAt), inArray(pdTickets.projectId, projectIds)))
            .orderBy(asc(pdTickets.id));

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

  const relinkBody = z.object({
    pdTicketId: z.number().int().positive(),
  });

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
        const { pdTicketId } = parsed.data;

        const wiRows = await db
          .select({
            id: workItems.id,
            projectId: workItems.projectId,
            pdTicketId: workItems.pdTicketId,
          })
          .from(workItems)
          .where(and(eq(workItems.id, workItemId), isNull(workItems.deletedAt)))
          .limit(1);
        const wi = wiRows[0];
        if (!wi) return res.status(404).json({ error: "work_item_not_found" });

        const ticketRows = await db
          .select({
            id: pdTickets.id,
            projectId: pdTickets.projectId,
            deletedAt: pdTickets.deletedAt,
          })
          .from(pdTickets)
          .where(eq(pdTickets.id, pdTicketId))
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

        const previousPdTicketId = wi.pdTicketId ?? null;

        await db
          .update(workItems)
          .set({ pdTicketId: ticket.id, updatedAt: new Date() })
          .where(eq(workItems.id, workItemId));

        logAuditFromReq(req, {
          entityType: "work_item",
          entityId: String(workItemId),
          action: "linkage_repair_relink",
          changesJson: {
            previousPdTicketId,
            newPdTicketId: ticket.id,
            projectId: wi.projectId,
          },
        });

        res.json({ ok: true, workItemId, pdTicketId: ticket.id, previousPdTicketId });
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
            pdTicketId: workItems.pdTicketId,
            projectId: workItems.projectId,
          })
          .from(workItems)
          .where(and(eq(workItems.id, workItemId), isNull(workItems.deletedAt)))
          .limit(1);
        const wi = wiRows[0];
        if (!wi) return res.status(404).json({ error: "work_item_not_found" });

        const previousPdTicketId = wi.pdTicketId ?? null;

        if (previousPdTicketId !== null) {
          await db
            .update(workItems)
            .set({ pdTicketId: null, updatedAt: new Date() })
            .where(eq(workItems.id, workItemId));
        }

        logAuditFromReq(req, {
          entityType: "work_item",
          entityId: String(workItemId),
          action: "linkage_repair_standalone",
          changesJson: {
            previousPdTicketId,
            projectId: wi.projectId ?? null,
          },
        });

        res.json({ ok: true, workItemId, previousPdTicketId });
      } catch (err: any) {
        console.error("[admin-work-item-linkage] standalone failed:", err);
        res.status(500).json({ error: "Failed to convert work item to standalone" });
      }
    },
  );
}

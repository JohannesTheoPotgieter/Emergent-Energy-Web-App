/**
 * Delete-impact endpoints (R3 / R4 support).
 *
 * Powers the ConfirmDestructive UI primitive — before a user deletes any
 * entity with cascade consequences, the UI calls this endpoint to fetch
 * the blast-radius counts so the user sees exactly what will be affected.
 *
 * Response shape (matches ConfirmDestructive's ImpactRow[]):
 *   {
 *     subject: string,         // human-readable name of the thing being deleted
 *     rows: [
 *       { label: string, count: number, severity?: 'high'|'medium'|'low', note?: string }
 *     ]
 *   }
 *
 * Access: requireAuth for reads. Actual delete endpoints elsewhere gate
 * by role (usually super-user).
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { db } from "../db";
import { projectInfo, clients, sites, opportunities } from "@shared/schema/projects";
import { workItems } from "@shared/schema/tasks";
import { approvals } from "@shared/schema/collaboration";
import { controlledDocuments } from "@shared/schema/documents";
import { ApiError, badRequest, notFound, serverError } from "../lib/api-error";

interface ImpactRow {
  label: string;
  count: number;
  severity?: "high" | "medium" | "low";
  note?: string;
}

const projectIdParam = z.coerce.number().int().positive();

async function countRows(table: any, where: any): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` }).from(table).where(where);
  return Number(result[0]?.count ?? 0);
}

/**
 * Project delete impact.
 *
 * Surfaces the main cascades so users see what else gets touched when
 * they delete a project. The rows are sorted most-important-first so
 * the user's eye lands on the biggest consequences.
 *
 * Not every related table is counted — we show what matters for the
 * "are you sure?" decision. A fuller audit trail is in the audit_events
 * table after the delete, not in the pre-delete preview.
 */
async function getProjectDeleteImpact(projectId: number): Promise<{ subject: string; rows: ImpactRow[] } | null> {
  const [project] = await db
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1);
  if (!project) return null;

  const [workItemCount, pendingApprovalCount, controlledDocCount] = await Promise.all([
    countRows(workItems, eq(workItems.projectId, projectId)),
    countRows(approvals, and(eq(approvals.projectId, projectId), eq(approvals.status, "pending"), isNull(approvals.deletedAt))),
    countRows(controlledDocuments, and(eq(controlledDocuments.projectId, projectId), isNull(controlledDocuments.deletedAt))),
  ]);

  const rows: ImpactRow[] = [];
  if (workItemCount > 0) {
    rows.push({
      label: "Work items (tasks, tickets, blockers)",
      count: workItemCount,
      severity: workItemCount > 20 ? "high" : workItemCount > 5 ? "medium" : "low",
      note: "Engineering, PM, Quality, HSE",
    });
  }
  if (pendingApprovalCount > 0) {
    rows.push({
      label: "Pending approvals",
      count: pendingApprovalCount,
      severity: "high",
      note: "Approvers will be notified",
    });
  }
  if (controlledDocCount > 0) {
    rows.push({
      label: "Controlled documents",
      count: controlledDocCount,
      severity: controlledDocCount > 5 ? "high" : "medium",
      note: "Drafts, approved, history",
    });
  }

  return { subject: project.projectName, rows };
}

/**
 * Client delete impact. Clients are referenced by projects, sites and
 * opportunities — deleting a client is usually a mistake (user means to
 * archive it) so the dialog makes the cascade very visible.
 */
async function getClientDeleteImpact(clientId: number): Promise<{ subject: string; rows: ImpactRow[] } | null> {
  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const [projectCount, siteCount, opportunityCount] = await Promise.all([
    countRows(projectInfo, eq(projectInfo.clientId, clientId)),
    countRows(sites, eq(sites.clientId, clientId)),
    countRows(opportunities, eq(opportunities.clientId, clientId)),
  ]);

  const rows: ImpactRow[] = [];
  if (projectCount > 0) {
    rows.push({
      label: "Projects linked to this client",
      count: projectCount,
      severity: "high",
      note: "Projects will be orphaned",
    });
  }
  if (siteCount > 0) {
    rows.push({
      label: "Sites",
      count: siteCount,
      severity: siteCount > 5 ? "high" : "medium",
    });
  }
  if (opportunityCount > 0) {
    rows.push({
      label: "Sales opportunities",
      count: opportunityCount,
      severity: "medium",
      note: "Includes historical closed deals",
    });
  }

  return { subject: client.name, rows };
}

export function registerImpactRoutes(app: Express): void {
  // ------------------------------------------------------------------
  // GET /api/projects/:id/delete-impact
  // ------------------------------------------------------------------
  app.get(
    "/api/projects/:id/delete-impact",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid project id");
      try {
        const impact = await getProjectDeleteImpact(parsed.data);
        if (!impact) throw notFound(`Project ${parsed.data} not found`);
        res.json(impact);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[impact] project delete-impact error:", err);
        throw serverError("Failed to compute delete impact");
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /api/clients/:id/delete-impact
  // ------------------------------------------------------------------
  app.get(
    "/api/clients/:id/delete-impact",
    requireAuth,
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.id); // same shape: positive int
      if (!parsed.success) throw badRequest("Invalid client id");
      try {
        const impact = await getClientDeleteImpact(parsed.data);
        if (!impact) throw notFound(`Client ${parsed.data} not found`);
        res.json(impact);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[impact] client delete-impact error:", err);
        throw serverError("Failed to compute delete impact");
      }
    },
  );
}

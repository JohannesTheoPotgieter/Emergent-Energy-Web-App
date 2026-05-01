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
 * Access: requireAuth + requireRole(ALL_STAFF_ROLES) for reads. The
 * counts and labels themselves leak structure (eg. "this client owns N
 * projects, M sites"), so previews are gated to authenticated company
 * staff. Actual delete endpoints elsewhere gate by role (usually
 * super-user).
 */

/* eslint-disable no-restricted-syntax -- legacy direct db.* calls; tracked tech debt for migration to repository layer (CLAUDE.md). Do not extend. */
import type { Express, Request, Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../auth-context";
import { requireRole } from "../middleware/requireRole";
import { ALL_STAFF_ROLES } from "@shared/schema/users";
import { db } from "../db";
import { projectInfo, clients, sites, opportunities } from "@shared/schema/projects";
import {
  workItems,
  taskComments,
  taskChecklists,
  taskAttachments,
  taskDeliverables,
  workItemAssignments,
  workItemDependencies,
} from "@shared/schema/tasks";
import { approvals } from "@shared/schema/collaboration";
import { controlledDocuments } from "@shared/schema/documents";
import { purchaseOrders, poReviewAssignments, paymentRequests, invoiceCaptures } from "@shared/schema/finance";
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

/**
 * Purchase order delete impact. POs have review assignments and payment
 * requests hanging off them; deleting a PO with a raised payment request
 * is very high severity because the supplier is expecting the money.
 */
async function getPoDeleteImpact(poId: number): Promise<{ subject: string; rows: ImpactRow[] } | null> {
  const [po] = await db
    .select({ id: purchaseOrders.id, poRef: purchaseOrders.poRef, supplierName: purchaseOrders.supplierName })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1);
  if (!po) return null;

  const [reviewCount, paymentRequestCount] = await Promise.all([
    countRows(poReviewAssignments, eq(poReviewAssignments.purchaseOrderId, poId)),
    countRows(paymentRequests, eq(paymentRequests.purchaseOrderId, poId)),
  ]);

  const rows: ImpactRow[] = [];
  if (reviewCount > 0) {
    rows.push({
      label: "Review assignments",
      count: reviewCount,
      severity: "medium",
      note: "Reviewers notified",
    });
  }
  if (paymentRequestCount > 0) {
    rows.push({
      label: "Payment requests raised against this PO",
      count: paymentRequestCount,
      severity: "high",
      note: "Supplier expecting funds — investigate before delete",
    });
  }
  return { subject: `${po.poRef} — ${po.supplierName}`, rows };
}

/**
 * Invoice (capture) delete impact. Invoices attach to payment requests
 * and can be linked to POs + procurement items — severity high when any
 * of those are live.
 */
async function getInvoiceDeleteImpact(invoiceId: number): Promise<{ subject: string; rows: ImpactRow[] } | null> {
  const [invoice] = await db
    .select({
      id: invoiceCaptures.id,
      invoiceNumber: invoiceCaptures.invoiceNumber,
      amount: invoiceCaptures.amount,
      linkedPoId: invoiceCaptures.linkedPoId,
    })
    .from(invoiceCaptures)
    .where(eq(invoiceCaptures.id, invoiceId))
    .limit(1);
  if (!invoice) return null;

  const [paymentRequestCount] = await Promise.all([
    countRows(paymentRequests, eq(paymentRequests.invoiceCaptureId, invoiceId)),
  ]);

  const rows: ImpactRow[] = [];
  if (paymentRequestCount > 0) {
    rows.push({
      label: "Payment requests raised from this invoice",
      count: paymentRequestCount,
      severity: "high",
      note: "Removing can break the reconciliation chain",
    });
  }
  if (invoice.linkedPoId) {
    rows.push({
      label: "Linked to a purchase order",
      count: 1,
      severity: "medium",
      note: "PO → invoice link will be broken",
    });
  }

  const label = invoice.invoiceNumber
    ? `Invoice ${invoice.invoiceNumber}${invoice.amount ? ` — R ${invoice.amount}` : ""}`
    : `Invoice #${invoice.id}`;
  return { subject: label, rows };
}

/**
 * Work item delete impact. Work items have several related tables that
 * cascade ON DELETE in the schema — we count them so the user sees what
 * they're trashing: comments, checklists, attachments, deliverables,
 * assignments, dependencies.
 */
async function getWorkItemDeleteImpact(workItemId: number): Promise<{ subject: string; rows: ImpactRow[] } | null> {
  const [item] = await db
    .select({ id: workItems.id, title: workItems.title })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);
  if (!item) return null;

  const [commentCount, checklistCount, attachmentCount, deliverableCount, assignmentCount, depCount] =
    await Promise.all([
      countRows(taskComments, eq(taskComments.workItemId, workItemId)),
      countRows(taskChecklists, eq(taskChecklists.workItemId, workItemId)),
      countRows(taskAttachments, eq(taskAttachments.workItemId, workItemId)),
      countRows(taskDeliverables, eq(taskDeliverables.workItemId, workItemId)),
      countRows(workItemAssignments, eq(workItemAssignments.workItemId, workItemId)),
      // Dependencies — count rows where this work item is either
      // predecessor or successor.
      countRows(workItemDependencies, sql`${workItemDependencies.predecessorId} = ${workItemId} OR ${workItemDependencies.successorId} = ${workItemId}`),
    ]);

  const rows: ImpactRow[] = [];
  if (commentCount > 0) rows.push({ label: "Comments", count: commentCount, severity: "low" });
  if (checklistCount > 0) rows.push({ label: "Checklists", count: checklistCount, severity: "low" });
  if (attachmentCount > 0) rows.push({ label: "Attachments", count: attachmentCount, severity: "medium" });
  if (deliverableCount > 0) rows.push({ label: "Deliverables", count: deliverableCount, severity: "medium" });
  if (assignmentCount > 0) rows.push({ label: "Assignments", count: assignmentCount, severity: "medium", note: "Assignees notified" });
  if (depCount > 0) rows.push({ label: "Dependent items", count: depCount, severity: "high", note: "Other work items depend on this" });

  return { subject: item.title ?? `Work item #${item.id}`, rows };
}

/**
 * Controlled-document delete impact. D3 uses soft-delete by default
 * (deletedAt set) rather than hard-delete, so the blast radius is
 * normally small. High severity only when the row is currently in
 * state='approved' — removing an approved document can break downstream
 * references (CEO home headline numbers, handover packs).
 */
async function getControlledDocDeleteImpact(docId: number): Promise<{ subject: string; rows: ImpactRow[] } | null> {
  const [doc] = await db
    .select({ id: controlledDocuments.id, fileName: controlledDocuments.fileName, state: controlledDocuments.state, typeKey: controlledDocuments.typeKey })
    .from(controlledDocuments)
    .where(eq(controlledDocuments.id, docId))
    .limit(1);
  if (!doc) return null;

  const rows: ImpactRow[] = [];
  if (doc.state === "approved") {
    rows.push({
      label: "Current approved version",
      count: 1,
      severity: "high",
      note: "CEO home + handover packs reference this",
    });
  } else if (doc.state === "submitted") {
    // Pending approvals will be cancelled.
    const pendingApprovalsCount = await countRows(
      approvals,
      and(
        eq(approvals.relatedEntityType, "controlled_document"),
        eq(approvals.relatedEntityId, docId),
        eq(approvals.status, "pending"),
      ),
    );
    if (pendingApprovalsCount > 0) {
      rows.push({
        label: "Pending approvals that will be cancelled",
        count: pendingApprovalsCount,
        severity: "medium",
        note: "Approvers notified",
      });
    }
  }

  return { subject: `${doc.typeKey}: ${doc.fileName}`, rows };
}

export function registerImpactRoutes(app: Express): void {
  // ------------------------------------------------------------------
  // GET /api/projects/:id/delete-impact
  // ------------------------------------------------------------------
  app.get(
    "/api/projects/:id/delete-impact",
    requireAuth,
    requireRole(ALL_STAFF_ROLES),
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
    requireRole(ALL_STAFF_ROLES),
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

  // ------------------------------------------------------------------
  // GET /api/purchase-orders/:id/delete-impact
  // ------------------------------------------------------------------
  app.get(
    "/api/purchase-orders/:id/delete-impact",
    requireAuth,
    requireRole(ALL_STAFF_ROLES),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid PO id");
      try {
        const impact = await getPoDeleteImpact(parsed.data);
        if (!impact) throw notFound(`Purchase order ${parsed.data} not found`);
        res.json(impact);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[impact] PO delete-impact error:", err);
        throw serverError("Failed to compute delete impact");
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /api/invoices/:id/delete-impact
  // ------------------------------------------------------------------
  app.get(
    "/api/invoices/:id/delete-impact",
    requireAuth,
    requireRole(ALL_STAFF_ROLES),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid invoice id");
      try {
        const impact = await getInvoiceDeleteImpact(parsed.data);
        if (!impact) throw notFound(`Invoice ${parsed.data} not found`);
        res.json(impact);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[impact] invoice delete-impact error:", err);
        throw serverError("Failed to compute delete impact");
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /api/work-items/:id/delete-impact
  // ------------------------------------------------------------------
  app.get(
    "/api/work-items/:id/delete-impact",
    requireAuth,
    requireRole(ALL_STAFF_ROLES),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid work item id");
      try {
        const impact = await getWorkItemDeleteImpact(parsed.data);
        if (!impact) throw notFound(`Work item ${parsed.data} not found`);
        res.json(impact);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[impact] work-item delete-impact error:", err);
        throw serverError("Failed to compute delete impact");
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /api/documents/:id/delete-impact   (controlled documents)
  // ------------------------------------------------------------------
  app.get(
    "/api/documents/:id/delete-impact",
    requireAuth,
    requireRole(ALL_STAFF_ROLES),
    async (req: Request, res: Response) => {
      const parsed = projectIdParam.safeParse(req.params.id);
      if (!parsed.success) throw badRequest("Invalid document id");
      try {
        const impact = await getControlledDocDeleteImpact(parsed.data);
        if (!impact) throw notFound(`Controlled document ${parsed.data} not found`);
        res.json(impact);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[impact] controlled-doc delete-impact error:", err);
        throw serverError("Failed to compute delete impact");
      }
    },
  );
}

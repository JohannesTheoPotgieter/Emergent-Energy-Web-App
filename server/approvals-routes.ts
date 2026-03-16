import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import {
  projectEngApprovals,
  projectEngStages,
  engStageTemplates,
  projectInfo,
  qcItemInstance,
  qcChecklist,
  qcTemplateItem,
  deliverables,
  users,
  approvals,
} from "@shared/schema";
import { evaluateAuthorityForRequest, requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";
import { getAssignmentsForEntity, setEntityAssignment } from "./services/assignment-service";
import { badRequest, forbidden, notFound, sendError } from "./lib/api-error";

const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];

const APPROVAL_ROLE_TO_USER_ROLES: Record<string, string[]> = {
  QA_REVIEW: ["QUALITY_MANAGER"],
  TECHNICAL_SIGNOFF: ["ENGINEERING_MANAGER", "COO_ADMIN", "CEO_ADMIN"],
  "Engineering Manager": ["ENGINEERING_MANAGER"],
  "Quality Manager": ["QUALITY_MANAGER"],
  "COO": ["COO_ADMIN"],
};

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.includes("no such table") || message.includes("does not exist");
}

function normalizeApprovalAssigneeInput(body: Record<string, any>) {
  const assigneeType = body.approverAssigneeType ?? (body.assignedApprover != null ? "internal_user" : null);
  const rawAssigneeId = body.approverAssigneeId ?? body.assignedApprover ?? null;
  const assigneeId = rawAssigneeId == null ? null : parseInt(String(rawAssigneeId), 10);

  return {
    assigneeType,
    assigneeId: Number.isFinite(assigneeId) ? assigneeId : null,
  };
}

async function getGeneralApprovalAssignments(approvalId: number) {
  return getAssignmentsForEntity("approval", approvalId, "APPROVER");
}

async function canCurrentUserDecideGeneralApproval(req: Request, approvalId: number): Promise<boolean> {
  const currentUser = getEffectiveUser(req);
  if (!currentUser?.id) {
    return false;
  }

  const authority = await evaluateAuthorityForRequest(req, "approvals", "approve");
  if (authority.allowed) {
    return true;
  }

  const assignments = await getGeneralApprovalAssignments(approvalId);
  return assignments.some((assignment) =>
    assignment.assigneeType === "internal_user" && assignment.assigneeId === currentUser.id,
  );
}

export function registerApprovalsRoutes(app: Express) {
  app.get("/api/approvals/pending", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    const currentUser = getEffectiveUser(req);
    const userId = currentUser?.id;
    const userRole = currentUser?.role || "";
    const isAdmin = ADMIN_ROLES.includes(userRole);
    const showAll = isAdmin && req.query.showAll === "true";

    try {
      const engApprovals = await db.select({
        id: projectEngApprovals.id,
        status: projectEngApprovals.status,
        approverRole: projectEngApprovals.approverRole,
        comments: projectEngApprovals.comments,
        createdAt: projectEngApprovals.createdAt,
        updatedAt: projectEngApprovals.updatedAt,
        stageId: projectEngStages.id,
        stageStatus: projectEngStages.status,
        stageName: engStageTemplates.name,
        projectName: projectInfo.projectName,
        projectId: projectInfo.id,
        approverUserId: projectEngApprovals.approverUserId,
      })
        .from(projectEngApprovals)
        .innerJoin(projectEngStages, eq(projectEngApprovals.projectEngStageId, projectEngStages.id))
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .innerJoin(projectInfo, eq(projectEngStages.projectId, projectInfo.id))
        .where(eq(projectEngApprovals.status, "pending"));

      const approverIds = engApprovals.map(a => a.approverUserId).filter(Boolean) as number[];
      let approverMap: Record<number, string> = {};
      if (approverIds.length > 0) {
        const approverUsers = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, approverIds));
        approverMap = Object.fromEntries(approverUsers.map(u => [u.id, u.name]));
      }

      let filteredEngApprovals = engApprovals;
      if (!isAdmin && !showAll) {
        filteredEngApprovals = engApprovals.filter(a => {
          if (a.approverUserId && a.approverUserId === userId) return true;
          if (a.approverRole) {
            const allowedRoles = APPROVAL_ROLE_TO_USER_ROLES[a.approverRole];
            if (allowedRoles && allowedRoles.includes(userRole)) return true;
          }
          return false;
        });
      }

      const engineeringItems = filteredEngApprovals.map(a => ({
        id: `eng-${a.id}`,
        type: "engineering" as const,
        title: `${a.stageName} - ${a.approverRole}`,
        projectName: a.projectName,
        projectId: a.projectId,
        status: a.status,
        assignee: a.approverUserId ? (approverMap[a.approverUserId] || "Unknown") : a.approverRole,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        meta: { stageId: a.stageId, approvalId: a.id },
      }));

      const qcItems = await db.select({
        id: qcItemInstance.id,
        qmStatus: qcItemInstance.qmStatus,
        approved: qcItemInstance.approved,
        lastUpdatedAt: qcItemInstance.lastUpdatedAt,
        itemName: qcTemplateItem.itemName,
        projectName: qcChecklist.projectName,
        projectId: qcChecklist.projectId,
        checklistId: qcChecklist.id,
        pmUserId: projectInfo.pmUserId,
        pm: projectInfo.pm,
      })
        .from(qcItemInstance)
        .innerJoin(qcChecklist, eq(qcItemInstance.checklistId, qcChecklist.id))
        .innerJoin(qcTemplateItem, eq(qcItemInstance.templateItemId, qcTemplateItem.id))
        .innerJoin(projectInfo, eq(qcChecklist.projectId, projectInfo.id))
        .where(
          and(
            eq(qcItemInstance.qmStatus, "review"),
            eq(qcItemInstance.approved, false)
          )
        );

      let filteredQcItems = qcItems;
      if (!isAdmin && !showAll) {
        if (userRole === "QUALITY_MANAGER" || userRole === "quality_manager") {
          filteredQcItems = qcItems;
        } else {
          filteredQcItems = [];
        }
      }

      const qualityItems = filteredQcItems.map(q => {
        return {
          id: `qc-${q.id}`,
          type: "quality" as const,
          title: q.itemName,
          projectName: q.projectName,
          projectId: q.projectId,
          status: "review",
          assignee: "Quality Manager",
          createdAt: q.lastUpdatedAt,
          updatedAt: q.lastUpdatedAt,
          meta: { itemInstanceId: q.id, checklistId: q.checklistId },
        };
      });

      const deliverableItems = await db.select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        projectName: deliverables.projectName,
        projectId: deliverables.projectId,
        deliverableType: deliverables.deliverableType,
        phase: deliverables.phase,
        createdAt: deliverables.createdAt,
        updatedAt: deliverables.updatedAt,
        ownerUserId: deliverables.ownerUserId,
        reviewerUserId: deliverables.reviewerUserId,
      })
        .from(deliverables)
        .where(
          sql`${deliverables.status} IN ('NEEDS APPROVAL', 'QC APPROVED', 'OPERATIONAL APPROVAL')`
        );

      const delivUserIds = [...new Set([
        ...deliverableItems.map(d => d.ownerUserId),
        ...deliverableItems.map(d => d.reviewerUserId),
      ].filter(Boolean))] as number[];
      let delivUserMap: Record<number, string> = {};
      if (delivUserIds.length > 0) {
        const dUsers = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, delivUserIds));
        delivUserMap = Object.fromEntries(dUsers.map(u => [u.id, u.name]));
      }

      let filteredDeliverables = deliverableItems;
      if (!isAdmin && !showAll) {
        filteredDeliverables = deliverableItems.filter(d => {
          if (d.reviewerUserId && d.reviewerUserId === userId) return true;
          if (d.ownerUserId && d.ownerUserId === userId) return true;
          return false;
        });
      }

      const delivItems = filteredDeliverables.map(d => ({
        id: `del-${d.id}`,
        type: "deliverable" as const,
        title: `${d.title} (${d.deliverableType})`,
        projectName: d.projectName,
        projectId: d.projectId,
        status: d.status,
        assignee: d.reviewerUserId ? (delivUserMap[d.reviewerUserId] || "Reviewer") : (d.ownerUserId ? (delivUserMap[d.ownerUserId] || "Owner") : "Unassigned"),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        meta: { deliverableId: d.id, phase: d.phase },
      }));

      const generalApprovals = await db.select({
        id: approvals.id,
        title: approvals.title,
        status: approvals.status,
        projectId: approvals.projectId,
        projectName: projectInfo.projectName,
        requestedAt: approvals.requestedAt,
        approvalCategory: approvals.approvalCategory,
        assignedApprover: approvals.assignedApprover,
      })
        .from(approvals)
        .innerJoin(projectInfo, eq(approvals.projectId, projectInfo.id))
        .where(eq(approvals.status, "pending"))
        .orderBy(desc(approvals.requestedAt));

      const generalApproverIds = [...new Set(
        generalApprovals
          .map((approval) => approval.assignedApprover)
          .filter((value): value is number => typeof value === "number"),
      )];
      let generalApproverMap: Record<number, string> = {};
      if (generalApproverIds.length > 0) {
        const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, generalApproverIds));
        generalApproverMap = Object.fromEntries(rows.map((row) => [row.id, row.name]));
      }

      const generalAssignments = await Promise.all(
        generalApprovals.map(async (approval) => [approval.id, await getGeneralApprovalAssignments(approval.id)] as const),
      );
      const generalAssignmentMap = new Map(generalAssignments);

      let filteredGeneralApprovals = generalApprovals;
      if (!isAdmin && !showAll) {
        filteredGeneralApprovals = generalApprovals.filter((approval) => {
          const primaryAssignment = (generalAssignmentMap.get(approval.id) || [])[0] || null;
          return Boolean(
            approval.assignedApprover === userId ||
            (primaryAssignment?.assigneeType === "internal_user" && primaryAssignment.assigneeId === userId),
          );
        });
      }

      const generalItems = filteredGeneralApprovals.map((approval) => {
        const assignments = generalAssignmentMap.get(approval.id) || [];
        const primaryAssignment = assignments[0] || null;
        return {
          id: `gen-${approval.id}`,
          type: "general" as const,
          title: approval.title,
          projectName: approval.projectName,
          projectId: approval.projectId,
          status: approval.status,
          assignee: primaryAssignment?.displayLabel || (approval.assignedApprover ? (generalApproverMap[approval.assignedApprover] || "Assigned approver") : "Unassigned"),
          createdAt: approval.requestedAt,
          updatedAt: approval.requestedAt,
          meta: {
            generalApprovalId: approval.id,
            approvalCategory: approval.approvalCategory,
            assignments,
            primaryAssignment,
          },
        };
      });

      const allItems = [...engineeringItems, ...qualityItems, ...delivItems, ...generalItems];
      allItems.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      res.json({
        items: allItems,
        counts: {
          engineering: engineeringItems.length,
          quality: qualityItems.length,
          deliverable: delivItems.length,
          general: generalItems.length,
          total: allItems.length,
        },
        isAdmin,
      });
    } catch (err: any) {
      if (isMissingTableError(err)) {
        return res.json({
          items: [],
          counts: {
            engineering: 0,
            quality: 0,
            deliverable: 0,
            total: 0,
          },
          isAdmin,
        });
      }

      console.error("Error fetching pending approvals:", err);
      res.status(500).json({ error: "Failed to fetch approvals" });
    }
  });

  app.get("/api/approvals/general", jwtAuth, requireAuth, requirePermission("approvals", "view"), async (req: Request, res: Response) => {
    try {
      const projectIdFilter = req.query.projectId ? parseInt(req.query.projectId as string) : null;
      const categoryFilter = req.query.category as string || null;
      const statusFilter = req.query.status as string || null;

      let conditions: any[] = [];
      if (projectIdFilter) conditions.push(eq(approvals.projectId, projectIdFilter));
      if (statusFilter) conditions.push(eq(approvals.status, statusFilter as any));
      if (categoryFilter) conditions.push(sql`${approvals.approvalCategory} = ${categoryFilter}`);

      const rows = await db.select({
        approval: approvals,
        projectName: projectInfo.projectName,
      })
        .from(approvals)
        .innerJoin(projectInfo, eq(approvals.projectId, projectInfo.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(approvals.requestedAt));

      const userIds = [...new Set([
        ...rows.map((row) => row.approval.requestedBy),
        ...rows.map((row) => row.approval.decidedBy).filter(Boolean),
        ...rows.map((row) => row.approval.assignedApprover).filter(Boolean),
      ])] as number[];
      let userMap: Record<number, string> = {};
      if (userIds.length > 0) {
        const uRows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
        userMap = Object.fromEntries(uRows.map(u => [u.id, u.name]));
      }

      const assignmentEntries = await Promise.all(
        rows.map(async ({ approval }) => [approval.id, await getGeneralApprovalAssignments(approval.id)] as const),
      );
      const assignmentMap = new Map(assignmentEntries);

      res.json({
        approvals: rows.map(({ approval, projectName }) => {
          const assignments = assignmentMap.get(approval.id) || [];
          const primaryAssignment = assignments[0] || null;
          return {
            ...approval,
            projectName,
            requestedByName: userMap[approval.requestedBy] || "Unknown",
            decidedByName: approval.decidedBy ? (userMap[approval.decidedBy] || "Unknown") : null,
            assignedApproverName: primaryAssignment?.displayLabel || (approval.assignedApprover ? (userMap[approval.assignedApprover] || "Unknown") : null),
            assignments,
            primaryAssignment,
          };
        }),
      });
    } catch (err: any) {
      console.error("Error fetching general approvals:", err);
      res.status(500).json({ error: "Failed to fetch approvals" });
    }
  });

  app.post("/api/approvals/general", jwtAuth, requireAuth, requirePermission("approvals", "edit"), async (req: Request, res: Response) => {
    try {
      const userId = getEffectiveUser(req)?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { type, title, description, dueDate, projectId, approvalCategory, relatedEntityType, relatedEntityId } = req.body;
      const { assigneeType, assigneeId } = normalizeApprovalAssigneeInput(req.body || {});
      if (!type || !title) return res.status(400).json({ error: "type and title are required" });
      if (!projectId) return res.status(400).json({ error: "projectId is required" });

      const result = await db.insert(approvals).values({
        type,
        title,
        description: description || null,
        status: "pending",
        requestedBy: userId,
        assignedApprover: assigneeType === "internal_user" ? assigneeId : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        projectId: parseInt(projectId),
        approvalCategory: approvalCategory || null,
        relatedEntityType: relatedEntityType || null,
        relatedEntityId: relatedEntityId ? parseInt(relatedEntityId) : null,
      }).returning();

      const created = (Array.isArray(result) ? result : (result as any).rows || [])[0];
      const assignments = assigneeType && assigneeId
        ? await setEntityAssignment(req, {
          entityType: "approval",
          entityId: created.id,
          assignmentRole: "APPROVER",
          assigneeType,
          assigneeId,
          mode: "replace",
        })
        : [];

      logAuditFromReq(req, {
        entityType: "approvals",
        entityId: created?.id ? String(created.id) : undefined,
        action: "approval_created",
        changesJson: { type, title, projectId, approvalCategory, assigneeType, assigneeId },
      });
      if (created?.projectId) {
        const actor = actorFromReq(req);
        await createProjectEvent({
          projectId: created.projectId,
          eventType: "approval.requested",
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "approvals",
          sourceEntityId: String(created.id),
          summary: `Approval requested: ${created.title}`,
          details: { status: created.status, approvalCategory: created.approvalCategory, type: created.type },
          idempotencyKey: `approval-requested:${created.id}`,
        });
      }
      res.status(201).json({
        ...created,
        assignments,
        primaryAssignment: assignments[0] || null,
      });
    } catch (err: any) {
      console.error("Error creating approval:", err);
      res.status(500).json({ error: "Failed to create approval" });
    }
  });

  app.patch("/api/approvals/general/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        throw badRequest("Invalid approval ID");
      }
      const userId = getEffectiveUser(req)?.id;
      if (!userId) {
        throw forbidden("Authentication required");
      }

      const [existing] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
      if (!existing) {
        throw notFound("Approval");
      }

      const {
        status,
        decisionNote,
        title,
        description,
        dueDate,
        approvalCategory,
      } = req.body || {};
      const validStatuses = ["pending", "approved", "rejected", "cancelled"];
      if (status && !validStatuses.includes(status)) {
        throw badRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }

      const { assigneeType, assigneeId } = normalizeApprovalAssigneeInput(req.body || {});
      const assignmentRequested =
        Object.prototype.hasOwnProperty.call(req.body || {}, "approverAssigneeType") ||
        Object.prototype.hasOwnProperty.call(req.body || {}, "approverAssigneeId") ||
        Object.prototype.hasOwnProperty.call(req.body || {}, "assignedApprover");

      const decisionRequested = status === "approved" || status === "rejected";
      const metadataRequested =
        title !== undefined ||
        description !== undefined ||
        dueDate !== undefined ||
        approvalCategory !== undefined ||
        status === "pending" ||
        status === "cancelled";

      if (decisionRequested) {
        const canDecide = await canCurrentUserDecideGeneralApproval(req, id);
        if (!canDecide) {
          throw forbidden("You are not allowed to approve or reject this approval");
        }
      }

      if (metadataRequested) {
        const editAuthority = await evaluateAuthorityForRequest(req, "approvals", "edit");
        if (!editAuthority.allowed) {
          throw forbidden(editAuthority.reason || "You do not have permission to update approvals");
        }
      }

      const updates: Record<string, any> = {};
      if (status) updates.status = status;
      if (decisionNote !== undefined) updates.decisionNote = decisionNote;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
      if (approvalCategory !== undefined) updates.approvalCategory = approvalCategory || null;
      if (status === "approved" || status === "rejected") {
        updates.decidedBy = userId;
        updates.decidedAt = new Date();
      }

      const result = Object.keys(updates).length > 0
        ? await db.update(approvals).set(updates).where(eq(approvals.id, id)).returning()
        : [existing];
      const updated = (Array.isArray(result) ? result : (result as any).rows || [])[0];
      if (!updated) {
        throw notFound("Approval");
      }

      const assignments = assignmentRequested
        ? await setEntityAssignment(req, {
          entityType: "approval",
          entityId: id,
          assignmentRole: "APPROVER",
          assigneeType,
          assigneeId,
          mode: assigneeType && assigneeId ? "replace" : "clear",
        })
        : await getGeneralApprovalAssignments(id);

      logAuditFromReq(req, {
        entityType: "approvals",
        entityId: String(id),
        action: `approval_${status || "updated"}`,
        changesJson: { status, decisionNote, assigneeType, assigneeId },
      });
      if (updated.projectId && decisionRequested) {
        const actor = actorFromReq(req);
        await createProjectEvent({
          projectId: updated.projectId,
          eventType: status === "approved" ? "approval.approved" : "approval.rejected",
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "approvals",
          sourceEntityId: String(updated.id),
          summary: `Approval ${status}: ${updated.title}`,
          details: { status: updated.status, decisionNote: updated.decisionNote || null, type: updated.type },
          idempotencyKey: `approval-decision:${updated.id}:${updated.status}`,
        });
      }
      res.json({
        ...updated,
        assignments,
        primaryAssignment: assignments[0] || null,
      });
    } catch (err: any) {
      sendError(res, err);
    }
  });

  app.delete("/api/approvals/general/:id", jwtAuth, requireAuth, requirePermission("approvals", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      await db.delete(approvals).where(eq(approvals.id, id));
      logAuditFromReq(req, {
        entityType: "approvals",
        entityId: String(id),
        action: "approval_deleted",
        changesJson: {},
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting approval:", err);
      res.status(500).json({ error: "Failed to delete approval" });
    }
  });
}

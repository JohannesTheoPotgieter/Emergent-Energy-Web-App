import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
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
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";

const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];

const APPROVAL_ROLE_TO_USER_ROLES: Record<string, string[]> = {
  QA_REVIEW: ["QUALITY_MANAGER"],
  TECHNICAL_SIGNOFF: ["ENGINEERING_MANAGER", "COO_ADMIN", "CEO_ADMIN"],
  "Engineering Manager": ["ENGINEERING_MANAGER"],
  "Quality Manager": ["QUALITY_MANAGER"],
  "COO": ["COO_ADMIN"],
};

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

export function registerApprovalsRoutes(app: Express) {
  app.get("/api/approvals/pending", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as any).user;
      const userId = currentUser?.id;
      const userRole = currentUser?.role || "";
      const isAdmin = ADMIN_ROLES.includes(userRole);
      const showAll = isAdmin && req.query.showAll === "true";

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
        title: `${a.stageName} — ${a.approverRole}`,
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

      const allItems = [...engineeringItems, ...qualityItems, ...delivItems];
      allItems.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      res.json({
        items: allItems,
        counts: {
          engineering: engineeringItems.length,
          quality: qualityItems.length,
          deliverable: delivItems.length,
          total: allItems.length,
        },
        isAdmin,
      });
    } catch (err: any) {
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

      const rows = await db.select().from(approvals)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(approvals.requestedAt));

      const userIds = [...new Set([
        ...rows.map(r => r.requestedBy),
        ...rows.map(r => r.decidedBy).filter(Boolean),
        ...rows.map(r => r.assignedApprover).filter(Boolean),
      ])] as number[];
      let userMap: Record<number, string> = {};
      if (userIds.length > 0) {
        const uRows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
        userMap = Object.fromEntries(uRows.map(u => [u.id, u.name]));
      }

      res.json({
        approvals: rows.map(r => ({
          ...r,
          requestedByName: userMap[r.requestedBy] || "Unknown",
          decidedByName: r.decidedBy ? (userMap[r.decidedBy] || "Unknown") : null,
          assignedApproverName: r.assignedApprover ? (userMap[r.assignedApprover] || "Unknown") : null,
        })),
      });
    } catch (err: any) {
      console.error("Error fetching general approvals:", err);
      res.status(500).json({ error: "Failed to fetch approvals" });
    }
  });

  app.post("/api/approvals/general", jwtAuth, requireAuth, requirePermission("approvals", "edit"), async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { type, title, description, assignedApprover, dueDate, projectId, approvalCategory, relatedEntityType, relatedEntityId } = req.body;
      if (!type || !title) return res.status(400).json({ error: "type and title are required" });

      const result = await db.insert(approvals).values({
        type,
        title,
        description: description || null,
        status: "pending",
        requestedBy: userId,
        assignedApprover: assignedApprover ? parseInt(assignedApprover) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        projectId: projectId ? parseInt(projectId) : null,
        approvalCategory: approvalCategory || null,
        relatedEntityType: relatedEntityType || null,
        relatedEntityId: relatedEntityId ? parseInt(relatedEntityId) : null,
      }).returning();

      const created = (Array.isArray(result) ? result : (result as any).rows || [])[0];
      logAuditFromReq(req, "approval_created", "approvals", created?.id, { type, title, projectId, approvalCategory });
      res.status(201).json(created);
    } catch (err: any) {
      console.error("Error creating approval:", err);
      res.status(500).json({ error: "Failed to create approval" });
    }
  });

  app.patch("/api/approvals/general/:id", jwtAuth, requireAuth, requirePermission("approvals", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const userId = (req as any).user?.id;

      const { status, decisionNote } = req.body;
      const validStatuses = ["pending", "approved", "rejected", "cancelled"];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }

      const updates: Record<string, any> = {};
      if (status) updates.status = status;
      if (decisionNote !== undefined) updates.decisionNote = decisionNote;
      if (status === "approved" || status === "rejected") {
        updates.decidedBy = userId;
        updates.decidedAt = new Date();
      }

      const result = await db.update(approvals).set(updates).where(eq(approvals.id, id)).returning();
      const updated = (Array.isArray(result) ? result : (result as any).rows || [])[0];
      if (!updated) return res.status(404).json({ error: "Approval not found" });

      logAuditFromReq(req, `approval_${status || "updated"}`, "approvals", id, { status, decisionNote });
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating approval:", err);
      res.status(500).json({ error: "Failed to update approval" });
    }
  });

  app.delete("/api/approvals/general/:id", jwtAuth, requireAuth, requirePermission("approvals", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      await db.delete(approvals).where(eq(approvals.id, id));
      logAuditFromReq(req, "approval_deleted", "approvals", id, {});
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting approval:", err);
      res.status(500).json({ error: "Failed to delete approval" });
    }
  });
}

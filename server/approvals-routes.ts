import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, sql, inArray } from "drizzle-orm";
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
} from "@shared/schema";

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

      const pmUserIds = [...new Set(qcItems.map(q => q.pmUserId).filter(Boolean))] as number[];
      let pmUserMap: Record<number, string> = {};
      if (pmUserIds.length > 0) {
        const pmUsers = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, pmUserIds));
        pmUserMap = Object.fromEntries(pmUsers.map(u => [u.id, u.name]));
      }

      let filteredQcItems = qcItems;
      if (!isAdmin && !showAll) {
        if (userRole === "QUALITY_MANAGER") {
          filteredQcItems = qcItems;
        } else {
          filteredQcItems = qcItems.filter(q => q.pmUserId === userId);
        }
      }

      const qualityItems = filteredQcItems.map(q => {
        const assigneeName = q.pmUserId
          ? (pmUserMap[q.pmUserId] || q.pm || "Unassigned PM")
          : (q.pm || "Unassigned PM");

        return {
          id: `qc-${q.id}`,
          type: "quality" as const,
          title: q.itemName,
          projectName: q.projectName,
          projectId: q.projectId,
          status: "review",
          assignee: assigneeName,
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
}

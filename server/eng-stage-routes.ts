// @ts-nocheck
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql, eq, and, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  engStageTemplates,
  engTaskTemplates,
  engDeliverableTemplates,
  projectEngStages,
  projectEngTasks,
  projectEngDeliverables,
  projectEngApprovals,
  projectInfo,
  users,
  workItems,
  notifications,
  projectTeamMembers,
} from "@shared/schema";
import { logAuditFromReq } from "./audit-logger";
import { sendError } from "./lib/api-error";
import { createEngineeringWorkItem, updateEngineeringWorkItem } from "./work-items-adapter";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "eng-deliverables");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${sanitized}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

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

const COO_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin"];
const ENGINEER_ROLES = ["ENGINEER", "COO_ADMIN", "CEO_ADMIN", "admin", "PROGRAM_MANAGER"];
const QA_ROLE = "QUALITY_MANAGER";

function getUser(req: Request): { id: number; name: string; role: string } {
  const u = (req as any).user;
  return { id: u.id || u.userId, name: u.name, role: u.role };
}

function isCoo(role: string): boolean {
  return COO_ROLES.includes(role);
}

function isEngineer(role: string): boolean {
  return ENGINEER_ROLES.includes(role) || role === QA_ROLE;
}

function requireEngineerOrAdmin(req: Request, res: Response, next: NextFunction) {
  const role = getUser(req).role;
  if (isEngineer(role) || isCoo(role)) return next();
  res.status(403).json({ error: "forbidden", message: "Insufficient role for this action" });
}

export async function generateEngStagesForProject(
  projectId: number,
  userId: number,
  stageNames?: string[]
): Promise<{ stagesCreated: number; tasksCreated: number; stageDetails: string[] }> {
  const existingStages = await db.select({ id: projectEngStages.id, stageTemplateId: projectEngStages.stageTemplateId })
    .from(projectEngStages).where(eq(projectEngStages.projectId, projectId));
  const existingTemplateIds = existingStages.map(s => s.stageTemplateId);

  let templatesToGenerate = await db.select().from(engStageTemplates)
    .where(eq(engStageTemplates.isActive, true))
    .orderBy(engStageTemplates.sortOrder);

  templatesToGenerate = templatesToGenerate.filter(t => !existingTemplateIds.includes(t.id));

  if (stageNames && stageNames.length > 0) {
    const namesLower = stageNames.map(n => n.toLowerCase());
    templatesToGenerate = templatesToGenerate.filter(t => namesLower.includes(t.name.toLowerCase()));
  }

  let stagesCreated = 0;
  let tasksCreated = 0;
  const stageDetails: string[] = [];

  for (const template of templatesToGenerate) {
    const [stage] = await db.insert(projectEngStages).values({
      projectId,
      stageTemplateId: template.id,
      status: "not_started",
      createdBy: userId,
    }).returning({ id: projectEngStages.id });

    const taskTemplates = await db.select().from(engTaskTemplates)
      .where(eq(engTaskTemplates.stageTemplateId, template.id))
      .orderBy(engTaskTemplates.sequence);

    for (const tt of taskTemplates) {
      // Idempotency: check if a work_item already exists for this stage+template combo
      const [existingStageTask] = await db.select({ id: projectEngTasks.id, workItemId: projectEngTasks.workItemId })
        .from(projectEngTasks)
        .where(and(eq(projectEngTasks.projectEngStageId, stage.id), eq(projectEngTasks.taskTemplateId, tt.id)));

      if (existingStageTask) continue; // Already generated — skip

      const wi = await createEngineeringWorkItem({
        projectId,
        title: `[${template.name}] ${tt.title}`,
        status: "TO DO",
        priority: "Med",
        phase: template.name,
        createdBy: userId,
      });

      await db.insert(projectEngTasks).values({
        projectEngStageId: stage.id,
        taskTemplateId: tt.id,
        status: "pending",
        workItemId: wi.id,
      });
      tasksCreated++;
    }

    const rules = template.stageGateRules as any;
    if (rules?.requireQaApproval) {
      await db.insert(projectEngApprovals).values({
        projectEngStageId: stage.id,
        approverRole: "QA_REVIEW",
      });
    }
    if (rules?.requireTechnicalSignoff) {
      await db.insert(projectEngApprovals).values({
        projectEngStageId: stage.id,
        approverRole: "TECHNICAL_SIGNOFF",
      });
    }

    stagesCreated++;
    stageDetails.push(template.name);
  }

  return { stagesCreated, tasksCreated, stageDetails };
}

export function registerEngStageRoutes(app: Express) {
  app.get("/api/eng-stages/templates", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const templates = await db.select().from(engStageTemplates).orderBy(engStageTemplates.sortOrder);

      const result = [];
      for (const t of templates) {
        const taskCount = await db.select({ count: sql<number>`count(*)` }).from(engTaskTemplates).where(eq(engTaskTemplates.stageTemplateId, t.id));
        const delCount = await db.select({ count: sql<number>`count(*)` }).from(engDeliverableTemplates).where(eq(engDeliverableTemplates.stageTemplateId, t.id));
        result.push({
          ...t,
          taskCount: Number(taskCount[0]?.count || 0),
          deliverableCount: Number(delCount[0]?.count || 0),
        });
      }

      res.json({ templates: result });
    } catch (err: any) {
      console.error("[EngStages] Templates list error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng-stages/templates/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const [template] = await db.select().from(engStageTemplates).where(eq(engStageTemplates.id, id));
      if (!template) return res.status(404).json({ error: "Template not found" });

      const tasks = await db.select().from(engTaskTemplates).where(eq(engTaskTemplates.stageTemplateId, id)).orderBy(engTaskTemplates.sequence);
      const deliverables = await db.select().from(engDeliverableTemplates).where(eq(engDeliverableTemplates.stageTemplateId, id));

      res.json({ template, tasks, deliverables });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng-stages/templates/:id", jwtAuth, requireAuth, requireEngineerOrAdmin, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required" });

      const id = parseInt(req.params.id);
      const { isActive } = req.body;
      await db.update(engStageTemplates).set({ isActive }).where(eq(engStageTemplates.id, id));
      logAuditFromReq(req, { entityType: "eng_stage_template", entityId: String(id), action: "update", changesJson: { description: "Stage template updated", isActive } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng-stages/templates/:id/tasks", jwtAuth, requireAuth, requireEngineerOrAdmin, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required" });
      const stageTemplateId = parseInt(req.params.id);
      const { title, description, isRequired, sequence, defaultOwnerRole } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required" });
      const maxSeq = await db.select({ max: sql<number>`COALESCE(MAX(sequence), 0)` }).from(engTaskTemplates).where(eq(engTaskTemplates.stageTemplateId, stageTemplateId));
      const [task] = await db.insert(engTaskTemplates).values({
        stageTemplateId,
        title,
        description: description || null,
        isRequired: isRequired !== false,
        sequence: sequence ?? (Number(maxSeq[0]?.max || 0) + 1),
        defaultOwnerRole: defaultOwnerRole || null,
      }).returning();
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(task.id), action: "create", changesJson: { description: "Task template created", title } });
      res.json(task);
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng-stages/template-tasks/:taskId", jwtAuth, requireAuth, requireEngineerOrAdmin, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required" });
      const taskId = parseInt(req.params.taskId);
      const { title, description, isRequired, sequence, defaultOwnerRole } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description || null;
      if (isRequired !== undefined) updates.isRequired = isRequired;
      if (sequence !== undefined) updates.sequence = sequence;
      if (defaultOwnerRole !== undefined) updates.defaultOwnerRole = defaultOwnerRole || null;
      const [updated] = await db.update(engTaskTemplates).set(updates).where(eq(engTaskTemplates.id, taskId)).returning();
      if (!updated) return res.status(404).json({ error: "Task template not found" });
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(taskId), action: "update", changesJson: { description: "Task template updated", title } });
      res.json(updated);
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/eng-stages/template-tasks/:taskId", jwtAuth, requireAuth, requireEngineerOrAdmin, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required" });
      const taskId = parseInt(req.params.taskId);
      const [deleted] = await db.delete(engTaskTemplates).where(eq(engTaskTemplates.id, taskId)).returning();
      if (!deleted) return res.status(404).json({ error: "Task template not found" });
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(taskId), action: "delete", changesJson: { description: "Task template deleted", title: deleted.title } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng-stages/templates/:id/deliverables", jwtAuth, requireAuth, requireEngineerOrAdmin, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required" });
      const stageTemplateId = parseInt(req.params.id);
      const { name, description, isRequired, allowedFileTypes, requiredCount } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const [deliverable] = await db.insert(engDeliverableTemplates).values({
        stageTemplateId,
        name,
        description: description || null,
        isRequired: isRequired !== false,
        allowedFileTypes: allowedFileTypes || null,
        requiredCount: requiredCount || 1,
      }).returning();
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(deliverable.id), action: "create", changesJson: { description: "Deliverable template created", name } });
      res.json(deliverable);
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng-stages/template-deliverables/:delId", jwtAuth, requireAuth, requireEngineerOrAdmin, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required" });
      const delId = parseInt(req.params.delId);
      const { name, description, isRequired, allowedFileTypes, requiredCount } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description || null;
      if (isRequired !== undefined) updates.isRequired = isRequired;
      if (allowedFileTypes !== undefined) updates.allowedFileTypes = allowedFileTypes;
      if (requiredCount !== undefined) updates.requiredCount = requiredCount;
      const [updated] = await db.update(engDeliverableTemplates).set(updates).where(eq(engDeliverableTemplates.id, delId)).returning();
      if (!updated) return res.status(404).json({ error: "Deliverable template not found" });
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(delId), action: "update", changesJson: { description: "Deliverable template updated", name } });
      res.json(updated);
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/eng-stages/template-deliverables/:delId", jwtAuth, requireAuth, requireEngineerOrAdmin, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required" });
      const delId = parseInt(req.params.delId);
      const [deleted] = await db.delete(engDeliverableTemplates).where(eq(engDeliverableTemplates.id, delId)).returning();
      if (!deleted) return res.status(404).json({ error: "Deliverable template not found" });
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(delId), action: "delete", changesJson: { description: "Deliverable template deleted", name: deleted.name } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/projects/:projectId/eng-stages/generate", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const projectId = parseInt(req.params.projectId);

      const [project] = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const stageTemplateId = req.query.stageId ? parseInt(req.query.stageId as string) : null;
      let stageNames: string[] | undefined;

      if (stageTemplateId) {
        const [tmpl] = await db.select({ name: engStageTemplates.name }).from(engStageTemplates)
          .where(and(eq(engStageTemplates.id, stageTemplateId), eq(engStageTemplates.isActive, true)));
        if (!tmpl) return res.status(404).json({ error: "Template not found or inactive" });
        stageNames = [tmpl.name];
      }

      const existingStages = await db.select({ id: projectEngStages.id, stageTemplateId: projectEngStages.stageTemplateId })
        .from(projectEngStages).where(eq(projectEngStages.projectId, projectId));

      if (!stageTemplateId && existingStages.length > 0) {
        const activeTemplates = await db.select({ id: engStageTemplates.id })
          .from(engStageTemplates).where(eq(engStageTemplates.isActive, true));
        const existingTemplateIds = new Set(existingStages.map(s => s.stageTemplateId));
        const remaining = activeTemplates.filter(t => !existingTemplateIds.has(t.id));
        if (remaining.length === 0) {
          return res.status(409).json({ error: "Engineering stages have already been generated for this project" });
        }
      }

      if (stageTemplateId) {
        const alreadyExists = existingStages.some(s => s.stageTemplateId === stageTemplateId);
        if (alreadyExists) {
          return res.status(409).json({ error: "This engineering stage has already been generated for this project" });
        }
      }

      const result = await generateEngStagesForProject(projectId, user.id, stageNames);

      if (result.stagesCreated === 0) {
        return res.status(409).json({ error: "All stages already generated or no active templates" });
      }

      logAuditFromReq(req, { entityType: "eng_project_stage", entityId: String(projectId), action: "create", projectName: project.projectName, changesJson: { description: "Engineering stages generated", stagesCreated: result.stagesCreated, stageDetails: result.stageDetails } });
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[EngStages] Generate error:", err.message);
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/projects/:projectId/eng-stages", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);

      const stages = await db.select({
        id: projectEngStages.id,
        projectId: projectEngStages.projectId,
        stageTemplateId: projectEngStages.stageTemplateId,
        status: projectEngStages.status,
        startedAt: projectEngStages.startedAt,
        completedAt: projectEngStages.completedAt,
        overrideReason: projectEngStages.overrideReason,
        createdAt: projectEngStages.createdAt,
        templateName: engStageTemplates.name,
        templatePurpose: engStageTemplates.purpose,
        templateSortOrder: engStageTemplates.sortOrder,
        templateInputs: engStageTemplates.inputs,
        raciResponsible: engStageTemplates.raciResponsible,
        raciAccountable: engStageTemplates.raciAccountable,
        raciConsulted: engStageTemplates.raciConsulted,
        raciInformed: engStageTemplates.raciInformed,
        failureModes: engStageTemplates.failureModes,
        stageGateRules: engStageTemplates.stageGateRules,
      })
        .from(projectEngStages)
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .where(eq(projectEngStages.projectId, projectId))
        .orderBy(engStageTemplates.sortOrder);

      const result = [];
      for (const s of stages) {
        const tasks = await db.select({
          id: projectEngTasks.id,
          status: projectEngTasks.status,
          taskTitle: engTaskTemplates.title,
          isRequired: engTaskTemplates.isRequired,
        })
          .from(projectEngTasks)
          .innerJoin(engTaskTemplates, eq(projectEngTasks.taskTemplateId, engTaskTemplates.id))
          .where(eq(projectEngTasks.projectEngStageId, s.id));

        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => t.status === "complete").length;
        const requiredTasks = tasks.filter(t => t.isRequired).length;
        const requiredComplete = tasks.filter(t => t.isRequired && t.status === "complete").length;

        const deliverables = await db.select({ id: projectEngDeliverables.id })
          .from(projectEngDeliverables)
          .where(eq(projectEngDeliverables.projectEngStageId, s.id));

        const approvals = await db.select({
          id: projectEngApprovals.id,
          approverRole: projectEngApprovals.approverRole,
          approverUserId: projectEngApprovals.approverUserId,
          status: projectEngApprovals.status,
          comments: projectEngApprovals.comments,
          approverUserName: users.name,
        })
          .from(projectEngApprovals)
          .leftJoin(users, eq(projectEngApprovals.approverUserId, users.id))
          .where(eq(projectEngApprovals.projectEngStageId, s.id));

        result.push({
          ...s,
          totalTasks,
          completedTasks,
          requiredTasks,
          requiredComplete,
          deliverableCount: deliverables.length,
          approvals,
        });
      }

      res.json({ stages: result });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/projects/:projectId/eng-stages/:stageId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const stageId = parseInt(req.params.stageId);

      const [stage] = await db.select({
        id: projectEngStages.id,
        projectId: projectEngStages.projectId,
        stageTemplateId: projectEngStages.stageTemplateId,
        status: projectEngStages.status,
        startedAt: projectEngStages.startedAt,
        completedAt: projectEngStages.completedAt,
        overrideReason: projectEngStages.overrideReason,
        createdAt: projectEngStages.createdAt,
        templateName: engStageTemplates.name,
        templatePurpose: engStageTemplates.purpose,
        templateInputs: engStageTemplates.inputs,
        raciResponsible: engStageTemplates.raciResponsible,
        raciAccountable: engStageTemplates.raciAccountable,
        raciConsulted: engStageTemplates.raciConsulted,
        raciInformed: engStageTemplates.raciInformed,
        failureModes: engStageTemplates.failureModes,
        stageGateRules: engStageTemplates.stageGateRules,
      })
        .from(projectEngStages)
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .where(eq(projectEngStages.id, stageId));

      if (!stage) return res.status(404).json({ error: "Stage not found" });

      const tasks = await db.select({
        id: projectEngTasks.id,
        projectEngStageId: projectEngTasks.projectEngStageId,
        taskTemplateId: projectEngTasks.taskTemplateId,
        status: projectEngTasks.status,
        ownerUserId: projectEngTasks.ownerUserId,
        notes: projectEngTasks.notes,
        dueDate: projectEngTasks.dueDate,
        completedAt: projectEngTasks.completedAt,
        completedBy: projectEngTasks.completedBy,
        hasDeliverable: projectEngTasks.hasDeliverable,
        templateTitle: engTaskTemplates.title,
        templateDescription: engTaskTemplates.description,
        isRequired: engTaskTemplates.isRequired,
        sequence: engTaskTemplates.sequence,
        defaultOwnerRole: engTaskTemplates.defaultOwnerRole,
        ownerUserName: sql<string>`(SELECT name FROM users WHERE id = ${projectEngTasks.ownerUserId})`,
        completedByName: sql<string>`(SELECT name FROM users WHERE id = ${projectEngTasks.completedBy})`,
      })
        .from(projectEngTasks)
        .innerJoin(engTaskTemplates, eq(projectEngTasks.taskTemplateId, engTaskTemplates.id))
        .where(eq(projectEngTasks.projectEngStageId, stageId))
        .orderBy(engTaskTemplates.sequence);

      const deliverableTemplatesForStage = await db.select()
        .from(engDeliverableTemplates)
        .where(eq(engDeliverableTemplates.stageTemplateId, stage.stageTemplateId));

      const uploadedDeliverables = await db.select()
        .from(projectEngDeliverables)
        .where(eq(projectEngDeliverables.projectEngStageId, stageId));

      const approvals = await db.select({
        id: projectEngApprovals.id,
        projectEngStageId: projectEngApprovals.projectEngStageId,
        approverRole: projectEngApprovals.approverRole,
        approverUserId: projectEngApprovals.approverUserId,
        status: projectEngApprovals.status,
        comments: projectEngApprovals.comments,
        createdAt: projectEngApprovals.createdAt,
        updatedAt: projectEngApprovals.updatedAt,
        approverUserName: users.name,
      })
        .from(projectEngApprovals)
        .leftJoin(users, eq(projectEngApprovals.approverUserId, users.id))
        .where(eq(projectEngApprovals.projectEngStageId, stageId));

      res.json({
        stage,
        tasks,
        deliverableTemplates: deliverableTemplatesForStage,
        uploadedDeliverables,
        approvals,
      });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng-stages/tasks/:taskId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.taskId);
      const user = getUser(req);
      const { status, notes, ownerUserId, hasDeliverable } = req.body;

      const [existingTask] = await db.select().from(projectEngTasks).where(eq(projectEngTasks.id, taskId));
      if (!existingTask) return res.status(404).json({ error: "Task not found" });

      const effectiveHasDeliverable = hasDeliverable !== undefined ? hasDeliverable : existingTask.hasDeliverable;
      const effectiveStatus = status !== undefined ? status : existingTask.status;

      if (effectiveStatus === "complete" && effectiveHasDeliverable) {
        const taskDeliverables = await db.select()
          .from(projectEngDeliverables)
          .where(eq(projectEngDeliverables.projectEngTaskId, taskId));
        if (taskDeliverables.length === 0) {
          if (status === "complete") {
            return res.status(400).json({ error: "This task requires a deliverable to be uploaded before it can be completed." });
          }
          if (hasDeliverable === true && existingTask.status === "complete") {
            const revertUpdates: any = { hasDeliverable: true, status: "pending", completedAt: null, completedBy: null };
            await db.update(projectEngTasks).set(revertUpdates).where(eq(projectEngTasks.id, taskId));
            return res.json({ success: true, reverted: true, message: "Task reverted to pending because it now requires an approved deliverable." });
          }
        } else {
          const hasApproved = taskDeliverables.some((d: any) => d.approvalStatus === "approved");
          if (!hasApproved) {
            if (status === "complete") {
              return res.status(400).json({ error: "The deliverable for this task must be approved before it can be completed." });
            }
            if (hasDeliverable === true && existingTask.status === "complete") {
              const revertUpdates: any = { hasDeliverable: true, status: "pending", completedAt: null, completedBy: null };
              await db.update(projectEngTasks).set(revertUpdates).where(eq(projectEngTasks.id, taskId));
              return res.json({ success: true, reverted: true, message: "Task reverted to pending because deliverable is not yet approved." });
            }
          }
        }
      }

      const updates: any = {};
      if (status !== undefined) {
        updates.status = status;
        if (status === "complete") {
          updates.completedAt = new Date();
          updates.completedBy = user.id;
        } else {
          updates.completedAt = null;
          updates.completedBy = null;
        }
      }
      if (notes !== undefined) updates.notes = notes;
      if (ownerUserId !== undefined) updates.ownerUserId = ownerUserId;
      if (hasDeliverable !== undefined) updates.hasDeliverable = hasDeliverable;

      await db.update(projectEngTasks).set(updates).where(eq(projectEngTasks.id, taskId));

      // Sync stage task status to linked work_item
      if (existingTask.workItemId && status !== undefined) {
        const statusMap: Record<string, string> = {
          "pending": "TO DO",
          "in_progress": "IN PROGRESS",
          "complete": "COMPLETE",
          "skipped": "COMPLETE",
        };
        const mappedStatus = statusMap[status] || "TO DO";
        await updateEngineeringWorkItem(existingTask.workItemId, {
          status: mappedStatus,
          completedAt: status === "complete" ? new Date() : undefined,
        });
      }

      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(taskId), action: "update", changesJson: { description: "Stage task updated", status, notes } });

      const [task] = await db.select({ stageId: projectEngTasks.projectEngStageId })
        .from(projectEngTasks).where(eq(projectEngTasks.id, taskId));
      if (task) {
        const allTasks = await db.select({ status: projectEngTasks.status })
          .from(projectEngTasks).where(eq(projectEngTasks.projectEngStageId, task.stageId));
        const anyInProgress = allTasks.some(t => t.status === "in_progress" || t.status === "complete");
        const [currentStage] = await db.select({ status: projectEngStages.status, projectId: projectEngStages.projectId })
          .from(projectEngStages).where(eq(projectEngStages.id, task.stageId));
        if (currentStage?.status === "not_started" && anyInProgress) {
          await db.update(projectEngStages).set({ status: "in_progress", startedAt: new Date() })
            .where(eq(projectEngStages.id, task.stageId));
        }
        if (currentStage) {
          const [proj] = await db.select({ projectName: projectInfo.projectName })
            .from(projectInfo).where(eq(projectInfo.id, currentStage.projectId));
          if (proj) {
          }
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng-stages/tasks/:taskId/deliverables", jwtAuth, requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.taskId);
      const user = getUser(req);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const [task] = await db.select().from(projectEngTasks).where(eq(projectEngTasks.id, taskId));
      if (!task) return res.status(404).json({ error: "Task not found" });

      const sharepointFolderPath = req.body.sharepointFolderPath || null;
      const versionTag = req.body.versionTag || "v1";

      const [deliverable] = await db.insert(projectEngDeliverables).values({
        projectEngStageId: task.projectEngStageId,
        projectEngTaskId: taskId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        storageRef: file.filename,
        uploadedBy: user.id,
        versionTag,
        sharepointFolderPath,
        approvalStatus: "pending",
      }).returning();

      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(deliverable.id), action: "create", changesJson: { description: "Task deliverable uploaded", fileName: file.originalname } });
      res.json({ deliverable });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng-stages/deliverables/:id/approve", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = getUser(req);
      const { status } = req.body;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
      }

      if (!isCoo(user.role) && !isEngineer(user.role) && user.role !== "PROGRAM_MANAGER") {
        return res.status(403).json({ error: "Only COO, engineers, or program managers can approve deliverables" });
      }

      const [deliverable] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });

      if (deliverable.uploadedBy === user.id) {
        return res.status(403).json({ error: "You cannot approve your own deliverable" });
      }

      await db.update(projectEngDeliverables).set({
        approvalStatus: status,
        approvedBy: user.id,
        approvedAt: new Date(),
      }).where(eq(projectEngDeliverables.id, id));

      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(id), action: status === "approved" ? "approve" : "reject", changesJson: { description: `Deliverable ${status}`, fileName: deliverable.fileName } });
      res.json({ success: true, status });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng-stages/stages/:stageId/deliverables", jwtAuth, requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const stageId = parseInt(req.params.stageId);
      const user = getUser(req);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const deliverableTemplateId = req.body.deliverableTemplateId ? parseInt(req.body.deliverableTemplateId) : null;
      const versionTag = req.body.versionTag || "v1";
      const notes = req.body.notes || null;
      const sharepointFolderPath = req.body.sharepointFolderPath || null;

      const [deliverable] = await db.insert(projectEngDeliverables).values({
        projectEngStageId: stageId,
        deliverableTemplateId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        storageRef: file.filename,
        uploadedBy: user.id,
        versionTag,
        notes,
        sharepointFolderPath,
      }).returning();

      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(deliverable.id), action: "create", changesJson: { description: "Stage deliverable uploaded", fileName: file.originalname } });
      res.json({ deliverable });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng-stages/deliverables/:id/download", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const [deliverable] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });

      const filePath = path.join(UPLOADS_DIR, deliverable.storageRef);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });

      res.setHeader("Content-Disposition", `attachment; filename="${deliverable.fileName}"`);
      res.setHeader("Content-Type", deliverable.mimeType || "application/octet-stream");
      fs.createReadStream(filePath).pipe(res);
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/eng-stages/deliverables/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const [deliverable] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });

      const filePath = path.join(UPLOADS_DIR, deliverable.storageRef);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await db.delete(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(id), action: "delete", changesJson: { description: "Deliverable deleted", fileName: deliverable.fileName } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng-stages/approvals/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const id = parseInt(req.params.id);
      const { status, comments } = req.body;

      const [approval] = await db.select().from(projectEngApprovals).where(eq(projectEngApprovals.id, id));
      if (!approval) return res.status(404).json({ error: "Approval not found" });

      const [parentStage] = await db.select({ createdBy: projectEngStages.createdBy })
        .from(projectEngStages)
        .where(eq(projectEngStages.id, approval.projectEngStageId));

      if (parentStage && parentStage.createdBy === user.id) {
        return res.status(403).json({ error: "You cannot approve your own stage gate" });
      }

      if (approval.approverRole === "QA_REVIEW" && user.role !== QA_ROLE && !isCoo(user.role)) {
        return res.status(403).json({ error: "Only Quality Manager can perform QA review" });
      }

      await db.update(projectEngApprovals).set({
        status,
        comments,
        approverUserId: user.id,
        updatedAt: new Date(),
      }).where(eq(projectEngApprovals.id, id));

      const [stage] = await db.select({
        projectId: projectEngStages.projectId,
        templateName: engStageTemplates.name,
      })
        .from(projectEngStages)
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .where(eq(projectEngStages.id, approval.projectEngStageId));

      if (stage) {
        const [proj] = await db.select({ projectName: projectInfo.projectName })
          .from(projectInfo).where(eq(projectInfo.id, stage.projectId));
        if (proj) {
        }
      }

      logAuditFromReq(req, { entityType: "eng_stage_gate", entityId: String(id), action: status === "approved" ? "approve" : "reject", projectName: proj?.projectName, changesJson: { description: `Stage gate ${status}`, stageName: stage?.templateName, approverRole: approval.approverRole } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng-stages/stages/:stageId/complete", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const stageId = parseInt(req.params.stageId);

      const [stage] = await db.select({
        id: projectEngStages.id,
        stageTemplateId: projectEngStages.stageTemplateId,
        status: projectEngStages.status,
        stageGateRules: engStageTemplates.stageGateRules,
        templateName: engStageTemplates.name,
      })
        .from(projectEngStages)
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .where(eq(projectEngStages.id, stageId));

      if (!stage) return res.status(404).json({ error: "Stage not found" });

      const missing: string[] = [];
      const rules = stage.stageGateRules as any || {};

      if (rules.requireAllTasks) {
        const tasks = await db.select({
          status: projectEngTasks.status,
          title: engTaskTemplates.title,
          isRequired: engTaskTemplates.isRequired,
        })
          .from(projectEngTasks)
          .innerJoin(engTaskTemplates, eq(projectEngTasks.taskTemplateId, engTaskTemplates.id))
          .where(eq(projectEngTasks.projectEngStageId, stageId));

        const incompleteTasks = tasks.filter(t => t.isRequired && t.status !== "complete");
        for (const t of incompleteTasks) {
          missing.push(`Task incomplete: ${t.title}`);
        }
      }

      if (rules.requireAllDeliverables) {
        const delTemplates = await db.select().from(engDeliverableTemplates)
          .where(eq(engDeliverableTemplates.stageTemplateId, stage.stageTemplateId));

        const uploaded = await db.select({ deliverableTemplateId: projectEngDeliverables.deliverableTemplateId })
          .from(projectEngDeliverables)
          .where(eq(projectEngDeliverables.projectEngStageId, stageId));

        for (const dt of delTemplates) {
          if (!dt.isRequired) continue;
          const uploadedForThis = uploaded.filter(u => u.deliverableTemplateId === dt.id);
          if (uploadedForThis.length < dt.requiredCount) {
            missing.push(`Deliverable missing: ${dt.name} (${uploadedForThis.length}/${dt.requiredCount} uploaded)`);
          }
        }
      }

      if (rules.requireQaApproval) {
        const qaApprovals = await db.select().from(projectEngApprovals)
          .where(and(eq(projectEngApprovals.projectEngStageId, stageId), eq(projectEngApprovals.approverRole, "QA_REVIEW")));
        if (qaApprovals.length === 0 || qaApprovals.some(a => a.status !== "approved")) {
          missing.push("QA Review approval required (Dean)");
        }
      }

      if (rules.requireTechnicalSignoff) {
        const techApprovals = await db.select().from(projectEngApprovals)
          .where(and(eq(projectEngApprovals.projectEngStageId, stageId), eq(projectEngApprovals.approverRole, "TECHNICAL_SIGNOFF")));
        if (techApprovals.length === 0 || techApprovals.some(a => a.status !== "approved")) {
          missing.push("Technical Signoff required (Tanaka)");
        }
      }

      if (missing.length > 0) {
        return res.json({ success: false, missing });
      }

      await db.update(projectEngStages).set({ status: "complete", completedAt: new Date() })
        .where(eq(projectEngStages.id, stageId));

      // Sync all linked work_items to COMPLETE
      const stageTasks = await db.select({ workItemId: projectEngTasks.workItemId })
        .from(projectEngTasks)
        .where(eq(projectEngTasks.projectEngStageId, stageId));
      for (const st of stageTasks) {
        if (st.workItemId) {
          await updateEngineeringWorkItem(st.workItemId, {
            status: "COMPLETE",
            completedAt: new Date(),
          });
        }
      }

      logAuditFromReq(req, { entityType: "eng_stage_gate", entityId: String(stageId), action: "approve", changesJson: { description: "Stage completed", stageName: stage.templateName } });

      // Notify project team members about stage completion
      try {
        const [stageProject] = await db.select({ projectId: projectEngStages.projectId })
          .from(projectEngStages).where(eq(projectEngStages.id, stageId));
        if (stageProject) {
          const teamMembers = await db.select({ userId: projectTeamMembers.userId })
            .from(projectTeamMembers)
            .where(eq(projectTeamMembers.projectId, stageProject.projectId));
          const currentUser = getUser(req);
          for (const m of teamMembers) {
            if (m.userId && m.userId !== currentUser.id) {
              await db.insert(notifications).values({
                recipientUserId: m.userId,
                eventType: "stage.completed",
                title: `Stage completed: ${stage.templateName}`,
                body: `Engineering stage "${stage.templateName}" has been marked complete.`,
                projectId: stageProject.projectId,
                linkedTaskId: null,
              }).catch(() => {});
            }
          }
        }
      } catch (_) { /* notification is best-effort */ }

      // If this is the Handover Pack stage, log commissioning unlock
      if (stage.templateName && /handover\s*pack/i.test(stage.templateName)) {
        const [stageRow] = await db.select({ projectId: projectEngStages.projectId }).from(projectEngStages).where(eq(projectEngStages.id, stageId));
        if (stageRow) {
          logAuditFromReq(req, {
            entityType: "commissioning_gate",
            entityId: String(stageRow.projectId),
            action: "unlocked",
            changesJson: { description: "Commissioning unlocked: Handover Pack stage completed", stageId },
          });
        }
      }

      res.json({ success: true, missing: [] });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng-stages/stages/:stageId/override-complete", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required for override" });

      const stageId = parseInt(req.params.stageId);
      const { reason } = req.body;
      if (!reason || reason.trim().length === 0) {
        return res.status(400).json({ error: "Override reason is mandatory" });
      }

      await db.update(projectEngStages).set({
        status: "complete",
        completedAt: new Date(),
        overrideReason: reason,
      }).where(eq(projectEngStages.id, stageId));

      // Sync all linked work_items to COMPLETE on override
      const overrideStageTasks = await db.select({ workItemId: projectEngTasks.workItemId })
        .from(projectEngTasks)
        .where(eq(projectEngTasks.projectEngStageId, stageId));
      for (const st of overrideStageTasks) {
        if (st.workItemId) {
          await updateEngineeringWorkItem(st.workItemId, {
            status: "COMPLETE",
            completedAt: new Date(),
          });
        }
      }

      logAuditFromReq(req, { entityType: "eng_stage_gate", entityId: String(stageId), action: "override", changesJson: { description: "Stage override completed", reason } });

      // If this is the Handover Pack stage, log commissioning unlock
      const [overrideStageInfo] = await db.select({ projectId: projectEngStages.projectId, name: engStageTemplates.name })
        .from(projectEngStages)
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .where(eq(projectEngStages.id, stageId));
      if (overrideStageInfo?.name && /handover\s*pack/i.test(overrideStageInfo.name)) {
        logAuditFromReq(req, {
          entityType: "commissioning_gate",
          entityId: String(overrideStageInfo.projectId),
          action: "unlocked",
          changesJson: { description: "Commissioning unlocked: Handover Pack stage override completed", stageId, reason },
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng-stages/stages/:stageId/status", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const stageId = parseInt(req.params.stageId);
      const { status } = req.body;
      const updates: any = { status };
      if (status === "in_progress" || status === "blocked" || status === "ready_for_review") {
        const [current] = await db.select({ startedAt: projectEngStages.startedAt })
          .from(projectEngStages).where(eq(projectEngStages.id, stageId));
        if (!current?.startedAt) updates.startedAt = new Date();
      }
      await db.update(projectEngStages).set(updates).where(eq(projectEngStages.id, stageId));

      const [statusStage] = await db.select({ projectId: projectEngStages.projectId })
        .from(projectEngStages).where(eq(projectEngStages.id, stageId));
      if (statusStage) {
        const [proj] = await db.select({ projectName: projectInfo.projectName })
          .from(projectInfo).where(eq(projectInfo.id, statusStage.projectId));
        if (proj) {
        }
      }

      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(stageId), action: "update", changesJson: { description: "Stage status updated", status } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });
}

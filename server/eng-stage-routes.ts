// Error breakdown: TS7006 implicit-any: 21, TS2345 query/param types: 12, other: 3
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql, eq, and, inArray, desc, isNull } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { sanitizeFilename, allowedFileFilter } from "./lib/upload-security";
import { paramStr, parseIntParam } from "./lib/req-params";
import {
  engStageTemplates,
  engTaskTemplates,
  engDeliverableTemplates,
  projectEngStages,
  projectEngTasks,
  projectEngDeliverables,
  projectEngApprovals,
  engTransmittals,
  engTransmittalItems,
  drawingRegister,
  projectInfo,
  users,
  workItems,
} from "@shared/schema";
import {
  RELEASED_FOR_STATES,
  RELEASED_FOR_TRANSITIONS,
  type ReleasedForState,
} from "@shared/schema/engineering";
import { logAuditFromReq } from "./audit-logger";
import { recordAudit } from "./api/v2/services/audit-service";
import { canOverride } from "@shared/permissions/authoriser-matrix";
import { sendError } from "./lib/api-error";
import { createEngineeringWorkItem, updateEngineeringWorkItem } from "./work-items-adapter";
import { jwtAuth, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "eng-deliverables");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}_${sanitizeFilename(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024, files: 20 }, fileFilter: allowedFileFilter });

const COO_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
const ENGINEER_ROLES = ["ENGINEER", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"];
const QA_ROLE = "QUALITY_MANAGER";

function getUser(req: Request): { id: number; name: string; role: string } {
  const u = (req as any).user;
  const companyRole = req.headers["x-company-role"] as string | undefined;
  return { id: u.id || u.userId, name: u.name, role: companyRole || u.companyRole || u.role };
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
  const existingTemplateIds = existingStages.map((s: any) => s.stageTemplateId);

  let templatesToGenerate = await db.select().from(engStageTemplates)
    .where(eq(engStageTemplates.isActive, true))
    .orderBy(engStageTemplates.sortOrder);

  templatesToGenerate = templatesToGenerate.filter((t: any) => !existingTemplateIds.includes(t.id));

  if (stageNames && stageNames.length > 0) {
    const namesLower = stageNames.map(n => n.toLowerCase());
    templatesToGenerate = templatesToGenerate.filter((t: any) => namesLower.includes(t.name.toLowerCase()));
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
      .where(and(eq(engTaskTemplates.stageTemplateId, template.id), isNull(engTaskTemplates.deletedAt)))
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
        const taskCount = await db.select({ count: sql<number>`count(*)` }).from(engTaskTemplates).where(and(eq(engTaskTemplates.stageTemplateId, t.id), isNull(engTaskTemplates.deletedAt)));
        const delCount = await db.select({ count: sql<number>`count(*)` }).from(engDeliverableTemplates).where(and(eq(engDeliverableTemplates.stageTemplateId, t.id), isNull(engDeliverableTemplates.deletedAt)));
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
      const id = parseIntParam(req.params.id);
      const [template] = await db.select().from(engStageTemplates).where(eq(engStageTemplates.id, id));
      if (!template) return res.status(404).json({ error: "Template not found" });

      const tasks = await db.select().from(engTaskTemplates).where(and(eq(engTaskTemplates.stageTemplateId, id), isNull(engTaskTemplates.deletedAt))).orderBy(engTaskTemplates.sequence);
      const deliverables = await db.select().from(engDeliverableTemplates).where(and(eq(engDeliverableTemplates.stageTemplateId, id), isNull(engDeliverableTemplates.deletedAt)));

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

      const id = parseIntParam(req.params.id);
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
      const stageTemplateId = parseIntParam(req.params.id);
      const { title, description, isRequired, sequence, defaultOwnerRole } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required" });
      const maxSeq = await db.select({ max: sql<number>`COALESCE(MAX(sequence), 0)` }).from(engTaskTemplates).where(and(eq(engTaskTemplates.stageTemplateId, stageTemplateId), isNull(engTaskTemplates.deletedAt)));
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
      const taskId = parseIntParam(req.params.taskId);
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
      const taskId = parseIntParam(req.params.taskId);
      const [deleted] = await db.update(engTaskTemplates).set({ deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(engTaskTemplates.id, taskId)).returning();
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
      const stageTemplateId = parseIntParam(req.params.id);
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
      const delId = parseIntParam(req.params.delId);
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
      const delId = parseIntParam(req.params.delId);
      const [deleted] = await db.update(engDeliverableTemplates).set({ deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(engDeliverableTemplates.id, delId)).returning();
      if (!deleted) return res.status(404).json({ error: "Deliverable template not found" });
      logAuditFromReq(req, { entityType: "eng_stage_item", entityId: String(delId), action: "delete", changesJson: { description: "Deliverable template deleted", name: deleted.name } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  // Permission: generating stage packs is a write to eng_stages — require create.
  app.post("/api/projects/:projectId/eng-stages/generate", jwtAuth, requireAuth, requirePermission("eng_stages", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const projectId = parseIntParam(req.params.projectId);

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

      // Plan v3 § D.G — softening the "already generated" idempotency guards.
      // COO / CEO with an override_reason can request regeneration; without
      // override, the 409 still fires.
      const overrideReason = typeof req.body?.override_reason === "string"
        ? req.body.override_reason.trim()
        : "";
      const overrideAllowed = overrideReason.length > 0 && canOverride(user.role, "eng_stages");

      if (!stageTemplateId && existingStages.length > 0 && !overrideAllowed) {
        const activeTemplates = await db.select({ id: engStageTemplates.id })
          .from(engStageTemplates).where(eq(engStageTemplates.isActive, true));
        const existingTemplateIds = new Set(existingStages.map((s: any) => s.stageTemplateId));
        const remaining = activeTemplates.filter((t: any) => !existingTemplateIds.has(t.id));
        if (remaining.length === 0) {
          return res.status(409).json({
            error: "Engineering stages have already been generated for this project",
            hint: "Pass override_reason as a COO/CEO to regenerate (idempotent — existing stages are kept).",
          });
        }
      }

      if (stageTemplateId && !overrideAllowed) {
        const alreadyExists = existingStages.some((s: any) => s.stageTemplateId === stageTemplateId);
        if (alreadyExists) {
          return res.status(409).json({
            error: "This engineering stage has already been generated for this project",
            hint: "Pass override_reason as a COO/CEO to bypass the duplicate-template guard.",
          });
        }
      }

      const result = await generateEngStagesForProject(projectId, user.id, stageNames);

      if (result.stagesCreated === 0 && !overrideAllowed) {
        return res.status(409).json({
          error: "All stages already generated or no active templates",
          hint: "Pass override_reason as a COO/CEO to record an audited no-op.",
        });
      }
      if (overrideAllowed) {
        await recordAudit({
          actorRole: user.role,
          userId: user.id,
          entityType: "eng_project_stage",
          entityId: String(projectId),
          action: "OVERRIDE_REGENERATE_ENG_STAGES",
          projectName: project.projectName,
          changesJson: {
            override_applied: true,
            reason: overrideReason,
            stagesCreated: result.stagesCreated,
          },
        });
      }

      logAuditFromReq(req, { entityType: "eng_project_stage", entityId: String(projectId), action: "create", projectName: project.projectName, changesJson: { description: "Engineering stages generated", stagesCreated: result.stagesCreated, stageDetails: result.stageDetails } });
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user.id,
        entityType: "eng_project_stage",
        entityId: String(projectId),
        action: "GENERATE_ENG_STAGES",
        projectName: project.projectName,
        changesJson: { stagesCreated: result.stagesCreated, stageNames: stageNames ?? null },
      });
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[EngStages] Generate error:", err.message);
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/projects/:projectId/eng-stages", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);

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
        const completedTasks = tasks.filter((t: any) => t.status === "complete").length;
        const requiredTasks = tasks.filter((t: any) => t.isRequired).length;
        const requiredComplete = tasks.filter((t: any) => t.isRequired && t.status === "complete").length;

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
      const stageId = parseIntParam(req.params.stageId);

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
        workItemId: projectEngTasks.workItemId,
        workItemStatus: workItems.status,
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
        .leftJoin(workItems, eq(projectEngTasks.workItemId, workItems.id))
        .where(eq(projectEngTasks.projectEngStageId, stageId))
        .orderBy(engTaskTemplates.sequence);

      const deliverableTemplatesForStage = await db.select()
        .from(engDeliverableTemplates)
        .where(and(eq(engDeliverableTemplates.stageTemplateId, stage.stageTemplateId), isNull(engDeliverableTemplates.deletedAt)));

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

  // Permission: changing stage task status is an edit to eng_tasks.
  app.patch("/api/eng-stages/tasks/:taskId", jwtAuth, requireAuth, requirePermission("eng_tasks", "edit"), async (req: Request, res: Response) => {
    try {
      const taskId = parseIntParam(req.params.taskId);
      const user = getUser(req);
      const { status, notes, ownerUserId, hasDeliverable } = req.body;

      const [existingTask] = await db.select().from(projectEngTasks).where(eq(projectEngTasks.id, taskId));
      if (!existingTask) return res.status(404).json({ error: "Task not found" });

      const effectiveHasDeliverable = hasDeliverable !== undefined ? hasDeliverable : existingTask.hasDeliverable;
      const effectiveStatus = status !== undefined ? status : existingTask.status;

      // Plan v3 § D.G — softening the deliverable-required and
      // deliverable-must-be-approved guards. A COO / CEO with an
      // override_reason can complete the task; the original gate stays
      // for everyone else and the override path writes a canonical audit row.
      const taskOverrideReason = typeof req.body?.override_reason === "string"
        ? req.body.override_reason.trim()
        : "";
      const taskOverrideAllowed = taskOverrideReason.length > 0 && canOverride(user.role, "eng_stages");
      let taskOverrideTriggered: "missing_deliverable" | "deliverable_not_approved" | null = null;

      if (effectiveStatus === "complete" && effectiveHasDeliverable) {
        const taskDeliverables = await db.select()
          .from(projectEngDeliverables)
          .where(eq(projectEngDeliverables.projectEngTaskId, taskId));
        if (taskDeliverables.length === 0) {
          if (status === "complete") {
            if (!taskOverrideAllowed) {
              return res.status(400).json({
                error: "This task requires a deliverable to be uploaded before it can be completed.",
                hint: "Pass override_reason as a COO/CEO to complete without a deliverable.",
              });
            }
            taskOverrideTriggered = "missing_deliverable";
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
              if (!taskOverrideAllowed) {
                return res.status(400).json({
                  error: "The deliverable for this task must be approved before it can be completed.",
                  hint: "Pass override_reason as a COO/CEO to complete with an unapproved deliverable.",
                });
              }
              taskOverrideTriggered = "deliverable_not_approved";
            }
            if (hasDeliverable === true && existingTask.status === "complete") {
              const revertUpdates: any = { hasDeliverable: true, status: "pending", completedAt: null, completedBy: null };
              await db.update(projectEngTasks).set(revertUpdates).where(eq(projectEngTasks.id, taskId));
              return res.json({ success: true, reverted: true, message: "Task reverted to pending because deliverable is not yet approved." });
            }
          }
        }
      }
      if (taskOverrideTriggered) {
        await recordAudit({
          actorRole: user.role,
          userId: user.id,
          entityType: "eng_task",
          entityId: String(taskId),
          action: "OVERRIDE_TASK_COMPLETION_GATE",
          changesJson: {
            override_applied: true,
            triggeredBy: taskOverrideTriggered,
            reason: taskOverrideReason,
          },
        });
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
        const anyInProgress = allTasks.some((t: any) => t.status === "in_progress" || t.status === "complete");
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

  // Permission: uploading a deliverable is a create on deliverables.
  app.post("/api/eng-stages/tasks/:taskId/deliverables", jwtAuth, requireAuth, requirePermission("deliverables", "edit"), upload.single("file"), async (req: Request, res: Response) => {
    try {
      const taskId = parseIntParam(req.params.taskId);
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

  // Permission: approving a deliverable requires approve on deliverables (middleware)
  // + inline role check (defense-in-depth) + self-review block.
  app.patch("/api/eng-stages/deliverables/:id/approve", jwtAuth, requireAuth, requirePermission("deliverables", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
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

      logAuditFromReq(req, {
        entityType: "eng_stage_item",
        entityId: String(id),
        action: status === "approved" ? "approve" : "reject",
        changesJson: {
          description: `Deliverable ${status}`,
          fileName: deliverable.fileName,
          // Explicit disclaimer in the audit trail: review/QA approval is
          // NOT the same as release for construction. Use
          // POST /api/eng-stages/deliverables/:id/issue-for-construction
          // to cross the IFC boundary.
          note: status === "approved" ? "Approval is for review only; NOT an issue for construction" : undefined,
          releasedForAfter: "approved_for_review",
        },
      });

      // Promote the controlled-document lifecycle — approval moves the
      // deliverable to `approved_for_review`, NOT `issued_for_construction`.
      if (status === "approved") {
        await db.update(projectEngDeliverables)
          .set({ releasedFor: "approved_for_review" })
          .where(eq(projectEngDeliverables.id, id));
      } else if (status === "rejected") {
        await db.update(projectEngDeliverables)
          .set({ releasedFor: "under_review" })
          .where(eq(projectEngDeliverables.id, id));
      }

      res.json({ success: true, status, releasedFor: status === "approved" ? "approved_for_review" : "under_review" });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  // ===== Controlled-document release endpoints =====
  // Approval alone does NOT imply Issued For Construction. A separate,
  // explicit, role-gated action is required so the audit trail distinguishes
  // "this has been reviewed" from "this is safe to build from".

  // Permission: issuing for construction requires approve on deliverables (middleware)
  // + inline engineer/COO check (defense-in-depth) + self-issue block.
  app.post("/api/eng-stages/deliverables/:id/issue-for-construction", jwtAuth, requireAuth, requirePermission("deliverables", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      const user = getUser(req);
      const { notes } = req.body || {};

      // Only engineers / COO can release for construction. PM alone is not
      // enough — construction release crosses a safety-of-life boundary.
      if (!isEngineer(user.role) && !isCoo(user.role)) {
        return res.status(403).json({
          error: "forbidden",
          message: "Only engineers or COO can issue a deliverable for construction",
        });
      }

      const [deliverable] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });

      const current = (deliverable.releasedFor ?? "draft") as ReleasedForState;
      if (!RELEASED_FOR_TRANSITIONS[current].includes("issued_for_construction")) {
        return res.status(409).json({
          error: "invalid_transition",
          message: `Cannot issue for construction from state "${current}". Deliverable must be approved for review first.`,
          currentState: current,
          allowedNext: RELEASED_FOR_TRANSITIONS[current],
        });
      }

      // Segregation of duties: issuer must not be the same person who
      // uploaded the file. (Approved-by is allowed to be the issuer — the
      // reviewer is typically the senior engineer and also signs off.)
      if (deliverable.uploadedBy === user.id) {
        return res.status(403).json({
          error: "forbidden",
          message: "You cannot issue your own uploaded deliverable for construction",
        });
      }

      await db.update(projectEngDeliverables).set({
        releasedFor: "issued_for_construction",
        issuedForConstructionAt: new Date(),
        issuedForConstructionBy: user.id,
      }).where(eq(projectEngDeliverables.id, id));

      logAuditFromReq(req, {
        entityType: "eng_stage_item",
        entityId: String(id),
        action: "issue_for_construction",
        changesJson: {
          description: "Deliverable issued for construction (IFC)",
          fileName: deliverable.fileName,
          versionTag: deliverable.versionTag,
          notes,
          releasedForBefore: current,
          releasedForAfter: "issued_for_construction",
        },
      });
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user.id,
        entityType: "eng_deliverable",
        entityId: String(id),
        action: "ISSUE_FOR_CONSTRUCTION",
        changesJson: { fileName: deliverable.fileName, versionTag: deliverable.versionTag, releasedForBefore: current, releasedForAfter: "issued_for_construction" },
      });

      res.json({ success: true, releasedFor: "issued_for_construction" });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  // Permission: marking as-built requires approve on deliverables (middleware)
  // + inline engineer/COO/construction_manager check.
  app.post("/api/eng-stages/deliverables/:id/mark-as-built", jwtAuth, requireAuth, requirePermission("deliverables", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      const user = getUser(req);
      const { notes } = req.body || {};

      // Construction manager, engineers, and COO can mark as-built.
      const allowed = isEngineer(user.role) || isCoo(user.role) || user.role === "CONSTRUCTION_MANAGER";
      if (!allowed) {
        return res.status(403).json({
          error: "forbidden",
          message: "Only engineers, construction manager, or COO can mark a deliverable as-built",
        });
      }

      const [deliverable] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });

      const current = (deliverable.releasedFor ?? "draft") as ReleasedForState;
      if (!RELEASED_FOR_TRANSITIONS[current].includes("as_built")) {
        return res.status(409).json({
          error: "invalid_transition",
          message: `Cannot mark as-built from state "${current}". Deliverable must be issued for construction first.`,
          currentState: current,
          allowedNext: RELEASED_FOR_TRANSITIONS[current],
        });
      }

      await db.update(projectEngDeliverables).set({
        releasedFor: "as_built",
        asBuiltAt: new Date(),
        asBuiltBy: user.id,
      }).where(eq(projectEngDeliverables.id, id));

      logAuditFromReq(req, {
        entityType: "eng_stage_item",
        entityId: String(id),
        action: "mark_as_built",
        changesJson: {
          description: "Deliverable marked as-built",
          fileName: deliverable.fileName,
          notes,
          releasedForBefore: current,
          releasedForAfter: "as_built",
        },
      });
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user.id,
        entityType: "eng_deliverable",
        entityId: String(id),
        action: "MARK_AS_BUILT",
        changesJson: { fileName: deliverable.fileName, releasedForBefore: current, releasedForAfter: "as_built" },
      });

      res.json({ success: true, releasedFor: "as_built" });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  // Permission: uploading a stage-level deliverable is a create on deliverables.
  app.post("/api/eng-stages/stages/:stageId/deliverables", jwtAuth, requireAuth, requirePermission("deliverables", "edit"), upload.single("file"), async (req: Request, res: Response) => {
    try {
      const stageId = parseIntParam(req.params.stageId);
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
      const id = parseIntParam(req.params.id);
      const [deliverable] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });

      const filePath = path.join(UPLOADS_DIR, deliverable.storageRef);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(deliverable.fileName || 'file')}"`);
      res.setHeader("Content-Type", deliverable.mimeType || "application/octet-stream");
      fs.createReadStream(filePath).pipe(res);
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  // Permission: deleting a deliverable requires delete on deliverables. CRITICAL fix.
  app.delete("/api/eng-stages/deliverables/:id", jwtAuth, requireAuth, requirePermission("deliverables", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
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

  // Permission: stage gate approvals require approve on eng_stages (middleware)
  // + inline QA/COO role check + self-approval block.
  app.patch("/api/eng-stages/approvals/:id", jwtAuth, requireAuth, requirePermission("eng_stages", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const id = parseIntParam(req.params.id);
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

      let projName: string | undefined;
      if (stage) {
        const [proj] = await db.select({ projectName: projectInfo.projectName })
          .from(projectInfo).where(eq(projectInfo.id, stage.projectId));
        if (proj) {
          projName = proj.projectName ?? undefined;
        }
      }

      logAuditFromReq(req, { entityType: "eng_stage_gate", entityId: String(id), action: status === "approved" ? "approve" : "reject", projectName: projName, changesJson: { description: `Stage gate ${status}`, stageName: stage?.templateName, approverRole: approval.approverRole } });
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user.id,
        entityType: "eng_stage_gate",
        entityId: String(id),
        action: status === "approved" ? "APPROVE_STAGE_GATE" : "REJECT_STAGE_GATE",
        projectName: projName,
        changesJson: { status, stageName: stage?.templateName, approverRole: approval.approverRole },
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[EngStages] Error:", err);
      sendError(res, err);
    }
  });

  // Permission: completing a stage is an approve-level action on eng_stages.
  app.post("/api/eng-stages/stages/:stageId/complete", jwtAuth, requireAuth, requirePermission("eng_stages", "edit"), async (req: Request, res: Response) => {
    try {
      const stageId = parseIntParam(req.params.stageId);
      const user = getUser(req);

      const [stage] = await db.select({
        id: projectEngStages.id,
        stageTemplateId: projectEngStages.stageTemplateId,
        status: projectEngStages.status,
        projectId: projectEngStages.projectId,
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

        const incompleteTasks = tasks.filter((t: any) => t.isRequired && t.status !== "complete");
        for (const t of incompleteTasks) {
          missing.push(`Task incomplete: ${t.title}`);
        }
      }

      if (rules.requireAllDeliverables) {
        const delTemplates = await db.select().from(engDeliverableTemplates)
          .where(and(eq(engDeliverableTemplates.stageTemplateId, stage.stageTemplateId), isNull(engDeliverableTemplates.deletedAt)));

        const uploaded = await db.select({ deliverableTemplateId: projectEngDeliverables.deliverableTemplateId })
          .from(projectEngDeliverables)
          .where(eq(projectEngDeliverables.projectEngStageId, stageId));

        for (const dt of delTemplates) {
          if (!dt.isRequired) continue;
          const uploadedForThis = uploaded.filter((u: any) => u.deliverableTemplateId === dt.id);
          if (uploadedForThis.length < dt.requiredCount) {
            missing.push(`Deliverable missing: ${dt.name} (${uploadedForThis.length}/${dt.requiredCount} uploaded)`);
          }
        }
      }

      if (rules.requireQaApproval) {
        const qaApprovals = await db.select().from(projectEngApprovals)
          .where(and(eq(projectEngApprovals.projectEngStageId, stageId), eq(projectEngApprovals.approverRole, "QA_REVIEW")));
        if (qaApprovals.length === 0 || qaApprovals.some((a: any) => a.status !== "approved")) {
          missing.push("QA Review approval required (Dean)");
        }
      }

      if (rules.requireTechnicalSignoff) {
        const techApprovals = await db.select().from(projectEngApprovals)
          .where(and(eq(projectEngApprovals.projectEngStageId, stageId), eq(projectEngApprovals.approverRole, "TECHNICAL_SIGNOFF")));
        if (techApprovals.length === 0 || techApprovals.some((a: any) => a.status !== "approved")) {
          missing.push("Technical Signoff required (Tanaka)");
        }
      }

      // Optional IFC-issuance gate: when a stage template opts in via
      // `requireIfcIssuance: true`, every required deliverable template in
      // this stage must have at least one uploaded row with
      // releasedFor='issued_for_construction'. Default off — existing
      // templates are unaffected.
      if (rules.requireIfcIssuance) {
        const delTemplates = await db.select().from(engDeliverableTemplates)
          .where(and(eq(engDeliverableTemplates.stageTemplateId, stage.stageTemplateId), isNull(engDeliverableTemplates.deletedAt)));
        const uploadedIfc = await db.select({
          deliverableTemplateId: projectEngDeliverables.deliverableTemplateId,
          releasedFor: projectEngDeliverables.releasedFor,
        })
          .from(projectEngDeliverables)
          .where(eq(projectEngDeliverables.projectEngStageId, stageId));
        for (const dt of delTemplates) {
          if (!dt.isRequired) continue;
          const ifcCount = uploadedIfc.filter(
            (u: any) => u.deliverableTemplateId === dt.id &&
              (u.releasedFor === "issued_for_construction" || u.releasedFor === "as_built"),
          ).length;
          if (ifcCount < dt.requiredCount) {
            missing.push(
              `Not Issued For Construction: ${dt.name} (${ifcCount}/${dt.requiredCount} IFC-released). ` +
              `Approval alone is not sufficient; use the "Issue for Construction" action.`,
            );
          }
        }
      }

      // Optional as-built gate for handover readiness. When a stage template
      // opts in via `requireAsBuilt: true`, required deliverables must be in
      // state `as_built` (not just IFC) for the stage to be marked complete.
      if (rules.requireAsBuilt) {
        const delTemplates = await db.select().from(engDeliverableTemplates)
          .where(and(eq(engDeliverableTemplates.stageTemplateId, stage.stageTemplateId), isNull(engDeliverableTemplates.deletedAt)));
        const uploadedAb = await db.select({
          deliverableTemplateId: projectEngDeliverables.deliverableTemplateId,
          releasedFor: projectEngDeliverables.releasedFor,
        })
          .from(projectEngDeliverables)
          .where(eq(projectEngDeliverables.projectEngStageId, stageId));
        for (const dt of delTemplates) {
          if (!dt.isRequired) continue;
          const abCount = uploadedAb.filter(
            (u: any) => u.deliverableTemplateId === dt.id && u.releasedFor === "as_built",
          ).length;
          if (abCount < dt.requiredCount) {
            missing.push(`Not marked As-Built: ${dt.name} (${abCount}/${dt.requiredCount} as-built)`);
          }
        }
      }

      // Optional procurement-readiness gate: when a stage template opts in
      // via `requireProcurementReady: true`, at least one deliverable must
      // have been transmitted with purpose "for_procurement". This ensures
      // procurement specs were formally issued before the stage closes.
      if (rules.requireProcurementReady) {
        const stageTransmittals = await db.select({ purpose: engTransmittals.purpose })
          .from(engTransmittals)
          .innerJoin(engTransmittalItems, eq(engTransmittalItems.transmittalId, engTransmittals.id))
          .where(eq(engTransmittals.projectEngStageId, stageId));
        const hasProcurementTransmittal = stageTransmittals.some((t: any) => t.purpose === "for_procurement");
        if (!hasProcurementTransmittal) {
          missing.push("Procurement spec not issued: no transmittal with purpose 'for_procurement' found for this stage");
        }
      }

      if (missing.length > 0) {
        return res.json({ success: false, missing });
      }

      // Record audit-grade timestamps for downstream reporting. These are
      // set in addition to the status change so that reports can distinguish
      // "stage complete" from "stage complete with IFC release" and
      // "stage complete with handover readiness".
      const stageUpdates: any = { status: "complete", completedAt: new Date() };
      if (rules.requireIfcIssuance) stageUpdates.ifcIssuedAt = new Date();
      if (rules.requireAsBuilt) stageUpdates.handoverReadyAt = new Date();
      await db.update(projectEngStages).set(stageUpdates)
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
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user.id,
        entityType: "eng_stage_gate",
        entityId: String(stageId),
        action: "COMPLETE_ENG_STAGE",
        changesJson: { stageName: stage.templateName, projectId: stage.projectId },
      });

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

  // Permission: override-completing a stage requires override on eng_stages (middleware)
  // + inline COO check.
  app.post("/api/eng-stages/stages/:stageId/override-complete", jwtAuth, requireAuth, requirePermission("eng_stages", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isCoo(user.role)) return res.status(403).json({ error: "COO access required for override" });

      const stageId = parseIntParam(req.params.stageId);
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
      await recordAudit({
        actorRole: (user as any)?.role,
        userId: user.id,
        entityType: "eng_stage_gate",
        entityId: String(stageId),
        action: "OVERRIDE_ENG_STAGE",
        changesJson: { reason, override_applied: true },
      });

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

  // Permission: changing stage status is an edit on eng_stages.
  app.patch("/api/eng-stages/stages/:stageId/status", jwtAuth, requireAuth, requirePermission("eng_stages", "edit"), async (req: Request, res: Response) => {
    try {
      const stageId = parseIntParam(req.params.stageId);
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

  // ===== TRANSMITTAL REGISTER =====
  // Formal issue events: "document X was issued to person Y for purpose Z".

  app.post("/api/eng-stages/transmittals", jwtAuth, requireAuth, requirePermission("eng_stages", "edit"), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { projectId, title, purpose, recipientName, recipientOrg, recipientUserId, notes, projectEngStageId, items } = req.body;

      if (!projectId || !title || !purpose || !recipientName) {
        return res.status(400).json({ error: "projectId, title, purpose, and recipientName are required" });
      }

      // Generate transmittal number: T-{projectId}-{YYYYMMDD}-{seq}
      const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
      const existingCount = await db.select({ id: engTransmittals.id })
        .from(engTransmittals)
        .where(eq(engTransmittals.projectId, projectId));
      const seq = String(existingCount.length + 1).padStart(3, "0");
      const transmittalNumber = `T-${projectId}-${today}-${seq}`;

      const [transmittal] = await db.insert(engTransmittals).values({
        projectId,
        transmittalNumber,
        title,
        purpose,
        recipientName,
        recipientOrg: recipientOrg || null,
        recipientUserId: recipientUserId || null,
        issuedByUserId: user.id,
        issuedAt: new Date(),
        notes: notes || null,
        projectEngStageId: projectEngStageId || null,
      }).returning();

      // Insert transmittal items (deliverables and/or drawings)
      const insertedItems: any[] = [];
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          // Snapshot the current releasedFor state of the deliverable
          let releasedForAtIssue: string | null = null;
          let revision: string | null = item.revision || null;

          if (item.deliverableId) {
            const [del] = await db.select({ releasedFor: projectEngDeliverables.releasedFor, versionTag: projectEngDeliverables.versionTag })
              .from(projectEngDeliverables).where(eq(projectEngDeliverables.id, item.deliverableId));
            if (del) {
              releasedForAtIssue = del.releasedFor;
              if (!revision) revision = del.versionTag;
            }
          }
          if (item.drawingId && !revision) {
            const [dwg] = await db.select({ currentRevision: drawingRegister.currentRevision })
              .from(drawingRegister).where(eq(drawingRegister.id, item.drawingId));
            if (dwg) revision = dwg.currentRevision;
          }

          const [inserted] = await db.insert(engTransmittalItems).values({
            transmittalId: transmittal.id,
            deliverableId: item.deliverableId || null,
            drawingId: item.drawingId || null,
            revision,
            releasedForAtIssue,
            notes: item.notes || null,
          }).returning();
          insertedItems.push(inserted);
        }
      }

      logAuditFromReq(req, {
        entityType: "eng_transmittal",
        entityId: String(transmittal.id),
        action: "create",
        changesJson: {
          description: `Transmittal ${transmittalNumber} issued`,
          purpose,
          recipientName,
          itemCount: insertedItems.length,
        },
      });

      res.status(201).json({ transmittal, items: insertedItems });
    } catch (err: any) {
      console.error("[EngStages] Transmittal error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng-stages/transmittals", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
      const conditions = projectId ? [eq(engTransmittals.projectId, projectId)] : [];

      const rows = conditions.length > 0
        ? await db.select().from(engTransmittals).where(and(...conditions)).orderBy(engTransmittals.issuedAt)
        : await db.select().from(engTransmittals).orderBy(engTransmittals.issuedAt);

      res.json({ transmittals: rows });
    } catch (err: any) {
      console.error("[EngStages] Transmittal list error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng-stages/transmittals/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      const [transmittal] = await db.select().from(engTransmittals).where(eq(engTransmittals.id, id));
      if (!transmittal) return res.status(404).json({ error: "Transmittal not found" });

      const items = await db.select().from(engTransmittalItems).where(eq(engTransmittalItems.transmittalId, id));

      res.json({ transmittal, items });
    } catch (err: any) {
      console.error("[EngStages] Transmittal detail error:", err);
      sendError(res, err);
    }
  });

  // ===== SUPERSEDE DELIVERABLE =====
  // Formally supersedes a deliverable by linking it to a replacement.

  app.post("/api/eng-stages/deliverables/:id/supersede", jwtAuth, requireAuth, requirePermission("deliverables", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      const user = getUser(req);
      const { supersededById, reason } = req.body;

      if (!supersededById) {
        return res.status(400).json({ error: "supersededById (the replacement deliverable ID) is required" });
      }

      const [old] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, id));
      if (!old) return res.status(404).json({ error: "Deliverable not found" });

      const [replacement] = await db.select().from(projectEngDeliverables).where(eq(projectEngDeliverables.id, supersededById));
      if (!replacement) return res.status(404).json({ error: "Replacement deliverable not found" });

      if (old.releasedFor === "superseded") {
        return res.status(409).json({ error: "Deliverable is already superseded" });
      }

      await db.update(projectEngDeliverables).set({
        releasedFor: "superseded",
        supersededById,
      }).where(eq(projectEngDeliverables.id, id));

      logAuditFromReq(req, {
        entityType: "eng_stage_item",
        entityId: String(id),
        action: "supersede",
        changesJson: {
          description: `Deliverable superseded by #${supersededById}`,
          fileName: old.fileName,
          reason: reason || null,
          supersededById,
          releasedForBefore: old.releasedFor,
        },
      });

      res.json({ success: true, releasedFor: "superseded", supersededById });
    } catch (err: any) {
      console.error("[EngStages] Supersede error:", err);
      sendError(res, err);
    }
  });

  // ===== HANDOVER READINESS COMPUTATION =====
  // Aggregates engineering completeness for a project: all stages
  // complete, all required deliverables in final state, all drawings
  // at IFC or as-built.

  app.get("/api/projects/:projectId/eng-handover-readiness", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseIntParam(req.params.projectId);

      // 1. Stage completion
      const stages = await db.select({
        id: projectEngStages.id,
        status: projectEngStages.status,
        templateName: engStageTemplates.name,
        completedAt: projectEngStages.completedAt,
        ifcIssuedAt: projectEngStages.ifcIssuedAt,
        handoverReadyAt: projectEngStages.handoverReadyAt,
      })
        .from(projectEngStages)
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .where(eq(projectEngStages.projectId, projectId));

      const totalStages = stages.length;
      const completedStages = stages.filter((s: any) => s.status === "complete").length;
      const stageItems = stages.map((s: any) => ({
        name: s.templateName,
        status: s.status,
        complete: s.status === "complete",
        ifcIssued: !!s.ifcIssuedAt,
        handoverReady: !!s.handoverReadyAt,
      }));

      // 2. Deliverable state
      const stageIds = stages.map((s: any) => s.id);
      let deliverables: any[] = [];
      if (stageIds.length > 0) {
        deliverables = await db.select({
          id: projectEngDeliverables.id,
          releasedFor: projectEngDeliverables.releasedFor,
          fileName: projectEngDeliverables.fileName,
        })
          .from(projectEngDeliverables)
          .where(inArray(projectEngDeliverables.projectEngStageId, stageIds));
      }

      const totalDeliverables = deliverables.length;
      const ifcOrAsBuilt = deliverables.filter((d: any) =>
        d.releasedFor === "issued_for_construction" || d.releasedFor === "as_built"
      ).length;
      const asBuiltOnly = deliverables.filter((d: any) => d.releasedFor === "as_built").length;

      // 3. Drawing state
      const drawings = await db.select({
        id: drawingRegister.id,
        status: drawingRegister.status,
        drawingNumber: drawingRegister.drawingNumber,
      })
        .from(drawingRegister)
        .where(eq(drawingRegister.projectId, projectId));

      const totalDrawings = drawings.length;
      const drawingsIfc = drawings.filter((d: any) => d.status === "ifc" || d.status === "as_built").length;
      const drawingsAsBuilt = drawings.filter((d: any) => d.status === "as_built").length;

      // 4. Compute overall readiness
      const allStagesComplete = totalStages > 0 && completedStages === totalStages;
      const allDeliverablesIfc = totalDeliverables === 0 || ifcOrAsBuilt === totalDeliverables;
      const allDrawingsIfc = totalDrawings === 0 || drawingsIfc === totalDrawings;
      const allAsBuilt = (totalDeliverables === 0 || asBuiltOnly === totalDeliverables) &&
                         (totalDrawings === 0 || drawingsAsBuilt === totalDrawings);

      let readiness: "not_ready" | "ifc_complete" | "as_built_complete" | "fully_ready" = "not_ready";
      if (allAsBuilt && allStagesComplete) readiness = "fully_ready";
      else if (allDeliverablesIfc && allDrawingsIfc && allStagesComplete) readiness = "ifc_complete";
      else if (allStagesComplete) readiness = "ifc_complete";

      const missingItems: string[] = [];
      if (!allStagesComplete) {
        const incomplete = stages.filter((s: any) => s.status !== "complete");
        for (const s of incomplete) missingItems.push(`Stage not complete: ${(s as any).templateName}`);
      }
      if (!allDeliverablesIfc) {
        const notIfc = deliverables.filter((d: any) =>
          d.releasedFor !== "issued_for_construction" && d.releasedFor !== "as_built"
        );
        for (const d of notIfc) missingItems.push(`Deliverable not IFC: ${(d as any).fileName}`);
      }
      if (!allDrawingsIfc) {
        const notIfc = drawings.filter((d: any) => d.status !== "ifc" && d.status !== "as_built");
        for (const d of notIfc) missingItems.push(`Drawing not IFC: ${(d as any).drawingNumber}`);
      }

      res.json({
        readiness,
        summary: {
          stages: { total: totalStages, complete: completedStages },
          deliverables: { total: totalDeliverables, ifcOrAsBuilt, asBuilt: asBuiltOnly },
          drawings: { total: totalDrawings, ifc: drawingsIfc, asBuilt: drawingsAsBuilt },
        },
        stageItems,
        missingItems,
      });
    } catch (err: any) {
      console.error("[EngStages] Handover readiness error:", err);
      sendError(res, err);
    }
  });
}

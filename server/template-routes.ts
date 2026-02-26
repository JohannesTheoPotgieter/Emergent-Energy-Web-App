import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  users, projectInfo, projectPhaseHistory, operationalTasks,
  deliverables, taskActivityLog,
  phaseTemplate, phaseTemplateItem, phaseTemplateItemHistory, phaseTemplateApplication,
  PROJECT_PHASES, PROJECT_PHASE_LABELS, LIFECYCLE_PHASES,
  type ProjectPhase,
  TEMPLATE_ITEM_TYPES, TEMPLATE_WORKSTREAMS, TEMPLATE_LINK_TARGET_TYPES,
  qcWarning,
} from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { createHash } from "crypto";

function getUser(req: Request) {
  return (req as any).user;
}

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
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

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = getUser(req)?.role;
  const execRoles = ["admin", "COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "ENGINEERING_MANAGER"];
  if (!role || !execRoles.includes(role)) return res.status(403).json({ error: "Admin access required" });
  next();
}

function makeApplicationKey(projectId: number, phase: string, templateId: number, templateVersion: number): string {
  const raw = `${projectId}:${phase}:${templateId}:${templateVersion}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

interface ApplyResult {
  tasksCreated: number;
  tasksSkipped: number;
  deliverablesCreated: number;
  deliverablesSkipped: number;
  qualityLinksCreated: number;
  qualityLinksSkipped: number;
  viewShortcutsCreated: number;
  viewShortcutsSkipped: number;
  warningsCreated: string[];
  details: { itemKey: string; action: string; type: string; title: string }[];
}

async function buildPreview(
  projectId: number,
  targetPhase: string,
  templateId: number,
): Promise<{ items_to_create: any[]; items_to_skip: any[]; items_to_update: any[]; warnings: string[] }> {
  const items = await db.select().from(phaseTemplateItem)
    .where(and(eq(phaseTemplateItem.templateId, templateId), eq(phaseTemplateItem.isDeleted, false)))
    .orderBy(asc(phaseTemplateItem.sortOrder));

  const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
  if (!project) throw new Error("Project not found");

  const cleanName = project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
  const existingTasks = await db.select({ id: operationalTasks.id, title: operationalTasks.title, phase: operationalTasks.phase })
    .from(operationalTasks)
    .where(eq(operationalTasks.projectName, cleanName));

  const existingDeliverables = await db.select({ id: deliverables.id, deliverableType: deliverables.deliverableType })
    .from(deliverables)
    .where(eq(deliverables.projectName, cleanName));

  const existingTaskKeys = new Set(existingTasks.map(t => `${t.title}__${t.phase || ""}`));
  const existingDelKeys = new Set(existingDeliverables.map(d => d.deliverableType));

  const toCreate: any[] = [];
  const toSkip: any[] = [];
  const toUpdate: any[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    if (item.itemType === "TASK") {
      const key = `${item.title}__${targetPhase}`;
      if (existingTaskKeys.has(key)) {
        toSkip.push({ ...item, reason: "Task already exists" });
      } else {
        toCreate.push(item);
      }
    } else if (item.itemType === "DELIVERABLE") {
      if (item.deliverableTypeKey && existingDelKeys.has(item.deliverableTypeKey)) {
        toSkip.push({ ...item, reason: "Deliverable type already exists" });
      } else {
        toCreate.push(item);
      }
    } else if (item.itemType === "QUALITY_LINK") {
      warnings.push(`Quality link "${item.title}" will reference quality module`);
      toCreate.push(item);
    } else if (item.itemType === "VIEW_SHORTCUT") {
      toCreate.push(item);
    }
  }

  return { items_to_create: toCreate, items_to_skip: toSkip, items_to_update: toUpdate, warnings };
}

async function applyTemplate(
  projectId: number,
  targetPhase: string,
  templateId: number,
  templateVersion: number,
  actorUserId: number,
): Promise<ApplyResult> {
  const appKey = makeApplicationKey(projectId, targetPhase, templateId, templateVersion);

  const [existingApp] = await db.select().from(phaseTemplateApplication)
    .where(eq(phaseTemplateApplication.applicationKey, appKey));
  if (existingApp) {
    return {
      tasksCreated: 0, tasksSkipped: 0,
      deliverablesCreated: 0, deliverablesSkipped: 0,
      qualityLinksCreated: 0, qualityLinksSkipped: 0,
      viewShortcutsCreated: 0, viewShortcutsSkipped: 0,
      warningsCreated: ["Template already applied (idempotency check)"],
      details: [{ itemKey: "LEDGER", action: "skipped", type: "SYSTEM", title: "Already applied" }],
    };
  }

  const items = await db.select().from(phaseTemplateItem)
    .where(and(eq(phaseTemplateItem.templateId, templateId), eq(phaseTemplateItem.isDeleted, false)))
    .orderBy(asc(phaseTemplateItem.sortOrder));

  const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
  if (!project) throw new Error("Project not found");

  const cleanName = project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

  const result: ApplyResult = {
    tasksCreated: 0, tasksSkipped: 0,
    deliverablesCreated: 0, deliverablesSkipped: 0,
    qualityLinksCreated: 0, qualityLinksSkipped: 0,
    viewShortcutsCreated: 0, viewShortcutsSkipped: 0,
    warningsCreated: [],
    details: [],
  };

  for (const item of items) {
    try {
      if (item.itemType === "TASK") {
        const existingByKey = await db.select({ id: operationalTasks.id })
          .from(operationalTasks)
          .where(and(
            eq(operationalTasks.projectName, cleanName),
            eq(operationalTasks.title, item.title),
            sql`${operationalTasks.phase} = ${targetPhase} OR ${operationalTasks.phase} IS NULL`,
          ))
          .limit(1);

        if (existingByKey.length > 0) {
          result.tasksSkipped++;
          result.details.push({ itemKey: item.itemKey, action: "skipped", type: "TASK", title: item.title });
        } else {
          const dueDate = item.offsetDaysFromPhaseStart
            ? new Date(Date.now() + item.offsetDaysFromPhaseStart * 86400000).toISOString().split("T")[0]
            : undefined;

          const [task] = await db.insert(operationalTasks).values({
            projectName: cleanName,
            title: item.title,
            description: item.description || undefined,
            status: item.defaultStatus || "TO DO",
            priority: item.defaultPriority || "Med",
            phase: targetPhase,
            primaryWorkstream: item.primaryWorkstream || undefined,
            approvalRequired: item.requiresApproval,
            approverUserId: undefined,
            dueDate,
            sortOrder: item.sortOrder,
            createdBy: actorUserId,
          }).returning();

          await db.insert(taskActivityLog).values({
            taskId: task.id,
            actorId: actorUserId,
            actionType: "created",
            newValue: `${item.title} (template-generated, key: ${item.itemKey})`,
          });

          result.tasksCreated++;
          result.details.push({ itemKey: item.itemKey, action: "created", type: "TASK", title: item.title });
        }
      } else if (item.itemType === "DELIVERABLE") {
        const typeKey = item.deliverableTypeKey || item.itemKey;
        const existingDel = await db.select({ id: deliverables.id })
          .from(deliverables)
          .where(and(
            eq(deliverables.projectName, cleanName),
            eq(deliverables.deliverableType, typeKey),
          ))
          .limit(1);

        if (existingDel.length > 0) {
          result.deliverablesSkipped++;
          result.details.push({ itemKey: item.itemKey, action: "skipped", type: "DELIVERABLE", title: item.title });
        } else {
          await db.insert(deliverables).values({
            projectName: cleanName,
            deliverableType: typeKey,
            title: item.title,
            description: item.description || undefined,
            phase: targetPhase,
            status: "TO DO",
          });
          result.deliverablesCreated++;
          result.details.push({ itemKey: item.itemKey, action: "created", type: "DELIVERABLE", title: item.title });
        }
      } else if (item.itemType === "QUALITY_LINK") {
        result.warningsCreated.push(`Quality link "${item.title}" references quality module - manual linking needed`);
        result.qualityLinksCreated++;
        result.details.push({ itemKey: item.itemKey, action: "warning", type: "QUALITY_LINK", title: item.title });
      } else if (item.itemType === "VIEW_SHORTCUT") {
        result.viewShortcutsCreated++;
        result.details.push({ itemKey: item.itemKey, action: "created", type: "VIEW_SHORTCUT", title: item.title });
      }
    } catch (err: any) {
      result.warningsCreated.push(`Error processing ${item.itemType} "${item.title}": ${err.message}`);
      result.details.push({ itemKey: item.itemKey, action: "error", type: item.itemType, title: item.title });
    }
  }

  if (result.warningsCreated.length > 0) {
    for (const warnMsg of result.warningsCreated) {
      try {
        await db.insert(qcWarning).values({
          projectName: cleanName,
          severity: "Medium",
          warningType: "phase_template_warning",
          title: `Template Warning: ${targetPhase}`,
          description: warnMsg,
          status: "open",
        });
      } catch { /* warning table may not accept this type */ }
    }
  }

  await db.insert(phaseTemplateApplication).values({
    projectId,
    phase: targetPhase,
    templateId,
    templateVersion,
    appliedByUserId: actorUserId,
    applicationKey: appKey,
    resultSummaryJson: result,
  });

  return result;
}

export function registerTemplateRoutes(app: Express) {
  // ========== TEMPLATE CRUD ==========

  app.get("/api/phase-templates", jwtAuth, requireAuth, requireAdmin, async (_req, res) => {
    try {
      const templates = await db.select().from(phaseTemplate)
        .orderBy(asc(phaseTemplate.phase), desc(phaseTemplate.version));
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/phase-templates/:id", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [tmpl] = await db.select().from(phaseTemplate).where(eq(phaseTemplate.id, id));
      if (!tmpl) return res.status(404).json({ error: "Template not found" });

      const items = await db.select().from(phaseTemplateItem)
        .where(and(eq(phaseTemplateItem.templateId, id), eq(phaseTemplateItem.isDeleted, false)))
        .orderBy(asc(phaseTemplateItem.sortOrder));

      res.json({ ...tmpl, items });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/phase-templates", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const { phase, name } = req.body;
      if (!phase || !name) return res.status(400).json({ error: "phase and name are required" });
      if (!PROJECT_PHASES.includes(phase as any)) return res.status(400).json({ error: "Invalid phase" });

      const existing = await db.select({ maxVer: sql<number>`COALESCE(MAX(${phaseTemplate.version}), 0)` })
        .from(phaseTemplate)
        .where(eq(phaseTemplate.phase, phase));
      const nextVersion = (existing[0]?.maxVer || 0) + 1;

      const [created] = await db.insert(phaseTemplate).values({
        phase,
        name,
        version: nextVersion,
        isActive: false,
        createdByUserId: user.id,
      }).returning();

      res.json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/phase-templates/:id/activate", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [tmpl] = await db.select().from(phaseTemplate).where(eq(phaseTemplate.id, id));
      if (!tmpl) return res.status(404).json({ error: "Template not found" });

      await db.update(phaseTemplate)
        .set({ isActive: false })
        .where(eq(phaseTemplate.phase, tmpl.phase));

      await db.update(phaseTemplate)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(phaseTemplate.id, id));

      res.json({ activated: true, phase: tmpl.phase, templateId: id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/phase-templates/:id/clone", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const sourceId = parseInt(req.params.id);
      const { targetPhase } = req.body;

      const [source] = await db.select().from(phaseTemplate).where(eq(phaseTemplate.id, sourceId));
      if (!source) return res.status(404).json({ error: "Source template not found" });

      const phase = targetPhase || source.phase;
      if (!PROJECT_PHASES.includes(phase as any)) return res.status(400).json({ error: "Invalid target phase" });

      const existing = await db.select({ maxVer: sql<number>`COALESCE(MAX(${phaseTemplate.version}), 0)` })
        .from(phaseTemplate)
        .where(eq(phaseTemplate.phase, phase));
      const nextVersion = (existing[0]?.maxVer || 0) + 1;

      const [cloned] = await db.insert(phaseTemplate).values({
        phase,
        name: `${source.name} (Clone)`,
        version: nextVersion,
        isActive: false,
        createdByUserId: user.id,
      }).returning();

      const sourceItems = await db.select().from(phaseTemplateItem)
        .where(and(eq(phaseTemplateItem.templateId, sourceId), eq(phaseTemplateItem.isDeleted, false)))
        .orderBy(asc(phaseTemplateItem.sortOrder));

      const collisions: string[] = [];
      for (const item of sourceItems) {
        let newKey = item.itemKey;
        if (targetPhase && targetPhase !== source.phase) {
          newKey = item.itemKey.replace(source.phase, targetPhase);
          if (newKey === item.itemKey) {
            newKey = `${targetPhase}_${item.itemKey}`;
          }
        }

        await db.insert(phaseTemplateItem).values({
          templateId: cloned.id,
          itemKey: newKey,
          itemType: item.itemType,
          title: item.title,
          description: item.description,
          primaryWorkstream: item.primaryWorkstream,
          defaultStatus: item.defaultStatus,
          defaultPriority: item.defaultPriority,
          offsetDaysFromPhaseStart: item.offsetDaysFromPhaseStart,
          requiresApproval: item.requiresApproval,
          approverRole: item.approverRole,
          linkTargetType: item.linkTargetType,
          linkTargetKey: item.linkTargetKey,
          deliverableTypeKey: item.deliverableTypeKey,
          requiresQcApproval: item.requiresQcApproval,
          requiresOperationalApproval: item.requiresOperationalApproval,
          qualityItemKey: item.qualityItemKey,
          evidenceRequired: item.evidenceRequired,
          viewKey: item.viewKey,
          sortOrder: item.sortOrder,
          isDeleted: false,
        });
      }

      res.json({ cloned, itemsCloned: sourceItems.length, collisions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== TEMPLATE ITEMS CRUD ==========

  app.post("/api/phase-templates/:id/items", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const templateId = parseInt(req.params.id);
      const [tmpl] = await db.select().from(phaseTemplate).where(eq(phaseTemplate.id, templateId));
      if (!tmpl) return res.status(404).json({ error: "Template not found" });

      const { itemKey, itemType, title, description, primaryWorkstream, defaultStatus, defaultPriority,
        offsetDaysFromPhaseStart, requiresApproval, approverRole, linkTargetType, linkTargetKey,
        deliverableTypeKey, requiresQcApproval, requiresOperationalApproval, qualityItemKey,
        evidenceRequired, viewKey, sortOrder } = req.body;

      if (!itemKey || !itemType || !title) {
        return res.status(400).json({ error: "itemKey, itemType, and title are required" });
      }
      if (!TEMPLATE_ITEM_TYPES.includes(itemType as any)) {
        return res.status(400).json({ error: "Invalid itemType" });
      }

      const [created] = await db.insert(phaseTemplateItem).values({
        templateId,
        itemKey,
        itemType,
        title,
        description: description || null,
        primaryWorkstream: primaryWorkstream || null,
        defaultStatus: defaultStatus || null,
        defaultPriority: defaultPriority || null,
        offsetDaysFromPhaseStart: offsetDaysFromPhaseStart || null,
        requiresApproval: requiresApproval || false,
        approverRole: approverRole || null,
        linkTargetType: linkTargetType || "NONE",
        linkTargetKey: linkTargetKey || null,
        deliverableTypeKey: deliverableTypeKey || null,
        requiresQcApproval: requiresQcApproval || false,
        requiresOperationalApproval: requiresOperationalApproval || false,
        qualityItemKey: qualityItemKey || null,
        evidenceRequired: evidenceRequired || false,
        viewKey: viewKey || null,
        sortOrder: sortOrder || 0,
        isDeleted: false,
      }).returning();

      await db.insert(phaseTemplateItemHistory).values({
        templateItemId: created.id,
        changedByUserId: user.id,
        changeJson: { action: "created", item: created },
      });

      res.json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/phase-template-items/:itemId", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const itemId = parseInt(req.params.itemId);
      const [existing] = await db.select().from(phaseTemplateItem).where(eq(phaseTemplateItem.id, itemId));
      if (!existing) return res.status(404).json({ error: "Item not found" });

      const updates: any = {};
      const allowed = ["title", "description", "primaryWorkstream", "defaultStatus", "defaultPriority",
        "offsetDaysFromPhaseStart", "requiresApproval", "approverRole", "linkTargetType", "linkTargetKey",
        "deliverableTypeKey", "requiresQcApproval", "requiresOperationalApproval", "qualityItemKey",
        "evidenceRequired", "viewKey", "sortOrder"];

      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      await db.update(phaseTemplateItem).set(updates).where(eq(phaseTemplateItem.id, itemId));

      await db.insert(phaseTemplateItemHistory).values({
        templateItemId: itemId,
        changedByUserId: user.id,
        changeJson: { action: "updated", changes: updates, before: existing },
      });

      const [updated] = await db.select().from(phaseTemplateItem).where(eq(phaseTemplateItem.id, itemId));
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/phase-template-items/:itemId", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const itemId = parseInt(req.params.itemId);

      await db.update(phaseTemplateItem)
        .set({ isDeleted: true })
        .where(eq(phaseTemplateItem.id, itemId));

      await db.insert(phaseTemplateItemHistory).values({
        templateItemId: itemId,
        changedByUserId: user.id,
        changeJson: { action: "soft_deleted" },
      });

      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== PREVIEW ==========

  app.get("/api/phase-templates/:id/preview", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      const items = await db.select().from(phaseTemplateItem)
        .where(and(eq(phaseTemplateItem.templateId, templateId), eq(phaseTemplateItem.isDeleted, false)))
        .orderBy(asc(phaseTemplateItem.sortOrder));

      const byType: Record<string, any[]> = {};
      for (const item of items) {
        if (!byType[item.itemType]) byType[item.itemType] = [];
        byType[item.itemType].push(item);
      }

      res.json({
        totalItems: items.length,
        byType,
        counts: {
          TASK: byType.TASK?.length || 0,
          DELIVERABLE: byType.DELIVERABLE?.length || 0,
          QUALITY_LINK: byType.QUALITY_LINK?.length || 0,
          VIEW_SHORTCUT: byType.VIEW_SHORTCUT?.length || 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/projects/:projectId/phase-preview", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const { toPhase } = req.body;
      if (!toPhase || !PROJECT_PHASES.includes(toPhase as any)) {
        return res.status(400).json({ error: "Valid toPhase required" });
      }

      const [activeTemplate] = await db.select().from(phaseTemplate)
        .where(and(eq(phaseTemplate.phase, toPhase), eq(phaseTemplate.isActive, true)));

      if (!activeTemplate) {
        return res.json({
          hasTemplate: false,
          message: `No active template for ${PROJECT_PHASE_LABELS[toPhase as ProjectPhase] || toPhase}`,
          items_to_create: [],
          items_to_skip: [],
          items_to_update: [],
          warnings: [],
        });
      }

      const preview = await buildPreview(projectId, toPhase, activeTemplate.id);
      res.json({
        hasTemplate: true,
        templateId: activeTemplate.id,
        templateName: activeTemplate.name,
        templateVersion: activeTemplate.version,
        ...preview,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== APPLY (used by phase change integration) ==========

  app.post("/api/projects/:projectId/apply-template", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const projectId = parseInt(req.params.projectId);
      const { phase } = req.body;

      if (!phase || !PROJECT_PHASES.includes(phase as any)) {
        return res.status(400).json({ error: "Valid phase required" });
      }

      const [activeTemplate] = await db.select().from(phaseTemplate)
        .where(and(eq(phaseTemplate.phase, phase), eq(phaseTemplate.isActive, true)));

      if (!activeTemplate) {
        return res.json({ applied: false, message: "No active template for this phase" });
      }

      const result = await applyTemplate(projectId, phase, activeTemplate.id, activeTemplate.version, user.id);
      res.json({ applied: true, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== TEMPLATE HISTORY ==========

  app.get("/api/phase-template-items/:itemId/history", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemId);
      const history = await db.select({
        id: phaseTemplateItemHistory.id,
        changedAt: phaseTemplateItemHistory.changedAt,
        changeJson: phaseTemplateItemHistory.changeJson,
        changedByName: users.name,
      })
        .from(phaseTemplateItemHistory)
        .leftJoin(users, eq(phaseTemplateItemHistory.changedByUserId, users.id))
        .where(eq(phaseTemplateItemHistory.templateItemId, itemId))
        .orderBy(desc(phaseTemplateItemHistory.changedAt));
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== APPLICATION HISTORY ==========

  app.get("/api/projects/:projectId/template-applications", jwtAuth, requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const apps = await db.select({
        id: phaseTemplateApplication.id,
        phase: phaseTemplateApplication.phase,
        templateVersion: phaseTemplateApplication.templateVersion,
        appliedAt: phaseTemplateApplication.appliedAt,
        resultSummaryJson: phaseTemplateApplication.resultSummaryJson,
        appliedByName: users.name,
        templateName: phaseTemplate.name,
      })
        .from(phaseTemplateApplication)
        .leftJoin(users, eq(phaseTemplateApplication.appliedByUserId, users.id))
        .leftJoin(phaseTemplate, eq(phaseTemplateApplication.templateId, phaseTemplate.id))
        .where(eq(phaseTemplateApplication.projectId, projectId))
        .orderBy(desc(phaseTemplateApplication.appliedAt));
      res.json(apps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== PROJECT CREATION (exec-only) ==========

  app.post("/api/projects", jwtAuth, requireAuth, requirePermission('create_project', 'edit'), async (req, res) => {
    try {
      const user = getUser(req);
      const { projectName, clientName, projectCode, location, initialPhase } = req.body;
      if (!projectName || typeof projectName !== "string" || projectName.trim().length === 0) {
        return res.status(400).json({ error: "projectName is required" });
      }

      const existing = await db.select({ id: projectInfo.id })
        .from(projectInfo)
        .where(eq(projectInfo.projectName, projectName.trim()));
      if (existing.length > 0) {
        return res.status(400).json({ error: "A project with this name already exists" });
      }

      const phase = initialPhase && PROJECT_PHASES.includes(initialPhase as any) ? initialPhase : "P0_FIRST_ASSESSMENT";

      const [created] = await db.insert(projectInfo).values({
        projectName: projectName.trim(),
        phase,
        phaseUpdatedAt: new Date(),
        phaseUpdatedByUserId: user.id,
        phaseNotes: `Project created at ${PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase}`,
        pd: clientName || null,
      }).returning();

      await db.insert(projectPhaseHistory).values({
        projectId: created.id,
        fromPhase: null,
        toPhase: phase,
        changedByUserId: user.id,
        reason: "Project created",
      });

      let applyResult = null;
      const [activeTemplate] = await db.select().from(phaseTemplate)
        .where(and(eq(phaseTemplate.phase, phase), eq(phaseTemplate.isActive, true)));

      if (activeTemplate) {
        applyResult = await applyTemplate(created.id, phase, activeTemplate.id, activeTemplate.version, user.id);
      }

      res.json({
        project: created,
        phaseLabel: PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase,
        templateApplied: !!applyResult,
        applyResult,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== EXEC PORTFOLIO ==========

  app.get("/api/exec/portfolio", jwtAuth, requireAuth, requireAdmin, async (_req, res) => {
    try {
      const projects = await db.select().from(projectInfo)
        .where(eq(projectInfo.isActive, true))
        .orderBy(asc(projectInfo.projectName));

      const result = [];
      for (const p of projects) {
        const cleanName = p.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

        const openWarnings = await db.select({ id: qcWarning.id, severity: qcWarning.severity })
          .from(qcWarning)
          .where(and(eq(qcWarning.projectName, cleanName), eq(qcWarning.status, "open")));

        const highWarnings = openWarnings.filter(w => w.severity === "High" || w.severity === "HIGH").length;
        const medWarnings = openWarnings.filter(w => w.severity === "Medium" || w.severity === "MED").length;

        const tasks = await db.select({
          id: operationalTasks.id,
          status: operationalTasks.status,
        })
          .from(operationalTasks)
          .where(eq(operationalTasks.projectName, cleanName));

        const totalTasks = tasks.length;
        const completeTasks = tasks.filter(t => t.status === "COMPLETE").length;
        const pendingApprovals = tasks.filter(t =>
          t.status === "NEEDS APPROVAL" || t.status === "PROVIDE FEEDBACK"
        ).length;

        const phaseAge = p.phaseUpdatedAt
          ? Math.floor((Date.now() - new Date(p.phaseUpdatedAt).getTime()) / 86400000)
          : null;

        result.push({
          id: p.id,
          projectName: cleanName,
          rawProjectName: p.projectName,
          phase: p.phase,
          phaseLabel: PROJECT_PHASE_LABELS[p.phase as ProjectPhase] || p.phase || "Unknown",
          phaseAge,
          contractValue: p.contractValue,
          sizeKwp: p.sizeKwp,
          pd: p.pd,
          pm: p.pm,
          ragStatus: p.ragStatus,
          totalTasks,
          completeTasks,
          readinessPercent: totalTasks > 0 ? Math.round((completeTasks / totalTasks) * 100) : null,
          pendingApprovals,
          highWarnings,
          medWarnings,
          totalWarnings: openWarnings.length,
        });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/exec/portfolio/:projectId", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cleanName = project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

      const history = await db.select({
        id: projectPhaseHistory.id,
        fromPhase: projectPhaseHistory.fromPhase,
        toPhase: projectPhaseHistory.toPhase,
        reason: projectPhaseHistory.reason,
        changedAt: projectPhaseHistory.changedAt,
        changedByName: users.name,
      })
        .from(projectPhaseHistory)
        .leftJoin(users, eq(projectPhaseHistory.changedByUserId, users.id))
        .where(eq(projectPhaseHistory.projectId, projectId))
        .orderBy(desc(projectPhaseHistory.changedAt));

      const applications = await db.select({
        id: phaseTemplateApplication.id,
        phase: phaseTemplateApplication.phase,
        templateVersion: phaseTemplateApplication.templateVersion,
        appliedAt: phaseTemplateApplication.appliedAt,
        resultSummaryJson: phaseTemplateApplication.resultSummaryJson,
        templateName: phaseTemplate.name,
      })
        .from(phaseTemplateApplication)
        .leftJoin(phaseTemplate, eq(phaseTemplateApplication.templateId, phaseTemplate.id))
        .where(eq(phaseTemplateApplication.projectId, projectId))
        .orderBy(desc(phaseTemplateApplication.appliedAt));

      const warnings = await db.select().from(qcWarning)
        .where(and(eq(qcWarning.projectName, cleanName), eq(qcWarning.status, "open")))
        .orderBy(desc(qcWarning.createdAt));

      const tasks = await db.select({
        id: operationalTasks.id,
        status: operationalTasks.status,
        title: operationalTasks.title,
        phase: operationalTasks.phase,
      })
        .from(operationalTasks)
        .where(eq(operationalTasks.projectName, cleanName));

      const pendingApprovals = tasks.filter(t =>
        t.status === "NEEDS APPROVAL" || t.status === "PROVIDE FEEDBACK"
      );

      res.json({
        project: {
          ...project,
          cleanName,
          phaseLabel: PROJECT_PHASE_LABELS[project.phase as ProjectPhase] || project.phase,
        },
        phaseHistory: history,
        templateApplications: applications,
        openWarnings: warnings,
        pendingApprovals,
        taskSummary: {
          total: tasks.length,
          complete: tasks.filter(t => t.status === "COMPLETE").length,
          inProgress: tasks.filter(t => t.status === "IN PROGRESS").length,
          todo: tasks.filter(t => t.status === "TO DO").length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== CONSTANTS ==========

  app.get("/api/template-constants", jwtAuth, requireAuth, async (_req, res) => {
    const lifecycleLabels: Record<string, string> = {};
    for (const p of LIFECYCLE_PHASES) lifecycleLabels[p] = p;
    res.json({
      itemTypes: TEMPLATE_ITEM_TYPES,
      workstreams: TEMPLATE_WORKSTREAMS,
      linkTargetTypes: TEMPLATE_LINK_TARGET_TYPES,
      projectPhases: LIFECYCLE_PHASES,
      projectPhaseLabels: lifecycleLabels,
    });
  });
}

export { applyTemplate, buildPreview };

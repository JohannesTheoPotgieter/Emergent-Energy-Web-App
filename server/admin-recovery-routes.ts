// @ts-nocheck
import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, or, sql, desc, ilike, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { verifyToken } from "./jwt";
import { logAuditFromReq } from "./audit-logger";
import {
  operationalTasks, mytoolTasks, engineeringTasks, workItems,
  smartImportRuns, importIssues, projectInfo, users, pdTickets, qcItemInstance,
} from "@shared/schema";
import { normalizeStatus } from "./lib/canonical-task-engine";

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
  res.status(401).json({ error: "auth_required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  res.status(403).json({ error: "admin_required", message: "Admin access required" });
}

const taskSearchSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  projectName: z.string().optional(),
  taskType: z.string().optional(),
  assigneeUserId: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const taskPatchSchema = z.object({
  status: z.string().optional(),
  title: z.string().optional(),
  projectName: z.string().optional(),
  projectId: z.number().optional(),
  assigneeUserId: z.number().nullable().optional(),
  ownerUserId: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.string().optional(),
  workstream: z.string().optional(),
  description: z.string().optional(),
});

const restoreSchema = z.object({
  items: z.array(z.object({
    id: z.number(),
    type: z.enum(["work_item", "engineering_task", "operational_task", "mytool_task"]),
  })),
});

const projectPatchSchema = z.object({
  projectName: z.string().optional(),
  pm: z.string().optional(),
  pd: z.string().optional(),
  phase: z.string().optional(),
  executionPhase: z.string().optional(),
  sizeKwp: z.string().optional(),
  contractValue: z.string().optional(),
  ragStatus: z.string().optional(),
  ragComment: z.string().optional(),
  isActive: z.boolean().optional(),
  pmUserId: z.number().nullable().optional(),
  pdUserId: z.number().nullable().optional(),
  clientId: z.number().nullable().optional(),
});

export function registerAdminRecoveryRoutes(app: Express) {
  app.get("/api/admin/recovery/tasks", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const params = taskSearchSchema.parse(req.query);
      const limit = Math.min(parseInt(params.limit || "100"), 500);
      const offset = parseInt(params.offset || "0");
      const searchTerm = params.q ? `%${params.q}%` : null;

      const results: any[] = [];

      if (!params.taskType || params.taskType === "operational") {
        let query = db.select().from(operationalTasks);
        const conditions: any[] = [];
        if (searchTerm) conditions.push(ilike(operationalTasks.title, searchTerm));
        if (params.status) conditions.push(eq(operationalTasks.status, params.status));
        if (params.projectName) conditions.push(eq(operationalTasks.projectName, params.projectName));
        if (params.assigneeUserId) conditions.push(eq(operationalTasks.ownerUserId, parseInt(params.assigneeUserId)));

        const rows = conditions.length > 0
          ? await query.where(and(...conditions)).orderBy(desc(operationalTasks.updatedAt)).limit(limit).offset(offset)
          : await query.orderBy(desc(operationalTasks.updatedAt)).limit(limit).offset(offset);

        for (const r of rows) {
          results.push({ ...r, taskType: "operational", taskSource: "operational" });
        }
      }

      if (!params.taskType || params.taskType === "personal") {
        let query = db.select().from(mytoolTasks);
        const conditions: any[] = [];
        if (searchTerm) conditions.push(ilike(mytoolTasks.title, searchTerm));
        if (params.status) conditions.push(eq(mytoolTasks.status, params.status));
        if (params.projectName) conditions.push(eq(mytoolTasks.projectName, params.projectName));
        if (params.assigneeUserId) conditions.push(eq(mytoolTasks.ownerUserId, parseInt(params.assigneeUserId)));

        const rows = conditions.length > 0
          ? await query.where(and(...conditions)).orderBy(desc(mytoolTasks.updatedAt)).limit(limit).offset(offset)
          : await query.orderBy(desc(mytoolTasks.updatedAt)).limit(limit).offset(offset);

        for (const r of rows) {
          results.push({ ...r, taskType: "personal", taskSource: "personal" });
        }
      }

      if (!params.taskType || params.taskType === "engineering") {
        let query = db.select().from(engineeringTasks);
        const conditions: any[] = [];
        if (searchTerm) conditions.push(ilike(engineeringTasks.title, searchTerm));
        if (params.status) conditions.push(eq(engineeringTasks.status, params.status));
        if (params.projectName) conditions.push(eq(engineeringTasks.projectName, params.projectName));
        if (params.assigneeUserId) conditions.push(eq(engineeringTasks.assigneeUserId, parseInt(params.assigneeUserId)));
        conditions.push(isNull(engineeringTasks.softDeletedAt));

        const rows = await query.where(and(...conditions)).orderBy(desc(engineeringTasks.updatedAt)).limit(limit).offset(offset);

        for (const r of rows) {
          results.push({ ...r, taskType: "engineering", taskSource: "engineering_task" });
        }
      }

      if (!params.taskType || params.taskType === "work_item") {
        let query = db.select().from(workItems);
        const conditions: any[] = [];
        if (searchTerm) conditions.push(ilike(workItems.title, searchTerm));
        if (params.status) conditions.push(eq(workItems.status, params.status));
        if (params.assigneeUserId) conditions.push(eq(workItems.ownerUserId, parseInt(params.assigneeUserId)));
        conditions.push(isNull(workItems.deletedAt));

        const rows = await query.where(and(...conditions)).orderBy(desc(workItems.updatedAt)).limit(limit).offset(offset);

        for (const r of rows) {
          results.push({ ...r, taskType: "work_item", taskSource: "plan" });
        }
      }

      if (!params.taskType || params.taskType === "pd_ticket") {
        const pdRows = await db.execute(sql`
          SELECT pd.*, pi.project_name as project_name, u.name as pd_user_name
          FROM pd_tickets pd
          LEFT JOIN project_info pi ON pd.project_id = pi.id
          LEFT JOIN users u ON pd.project_developer_user_id = u.id
          WHERE 1=1
            ${searchTerm ? sql`AND (pd.project_site_name ILIKE ${searchTerm} OR pd.request_type ILIKE ${searchTerm})` : sql``}
            ${params.status ? sql`AND pd.status = ${params.status}` : sql``}
            ${params.assigneeUserId ? sql`AND pd.project_developer_user_id = ${parseInt(params.assigneeUserId)}` : sql``}
          ORDER BY pd.id DESC
          LIMIT ${limit} OFFSET ${offset}
        `).then((r: any) => Array.isArray(r) ? r : (r.rows || []));

        for (const r of pdRows) {
          results.push({
            ...r,
            title: r.project_site_name || r.request_type || `PD Ticket #${r.id}`,
            taskType: "pd_ticket",
            taskSource: "pd_ticket",
          });
        }
      }

      if (!params.taskType || params.taskType === "quality") {
        const qcRows = await db.execute(sql`
          SELECT qi.*, qc.project_name, qc.project_id, qti.item_name
          FROM qc_item_instance qi
          JOIN qc_checklist qc ON qi.checklist_id = qc.id
          JOIN qc_template_item qti ON qi.template_item_id = qti.id
          WHERE qi.is_applicable = true
            ${searchTerm ? sql`AND qti.item_name ILIKE ${searchTerm}` : sql``}
            ${params.status ? sql`AND qi.qm_status = ${params.status}` : sql``}
            ${params.assigneeUserId ? sql`AND qi.assignee_user_id = ${parseInt(params.assigneeUserId)}` : sql``}
          ORDER BY qi.last_updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `).then((r: any) => Array.isArray(r) ? r : (r.rows || []));

        for (const r of qcRows) {
          results.push({
            ...r,
            title: r.item_name || `QC Item #${r.id}`,
            status: r.qm_status || "not_started",
            taskType: "quality",
            taskSource: "quality_task",
          });
        }
      }

      const allUsers = await db.select({ id: users.id, name: users.name, role: users.role }).from(users);
      const allProjects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);

      res.json({
        tasks: results.slice(0, limit),
        total: results.length,
        users: allUsers,
        projects: allProjects,
      });
    } catch (err: any) {
      console.error("[AdminRecovery] GET tasks error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/recovery/tasks/:id", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.id);
      if (isNaN(taskId)) return res.status(400).json({ error: "Invalid task ID" });

      const { taskSource, ...updates } = req.body;
      const parsed = taskPatchSchema.safeParse(updates);
      if (!parsed.success) return res.status(400).json({ error: "Invalid update data", details: parsed.error.issues });

      const fields = parsed.data;
      if (fields.status) fields.status = normalizeStatus(fields.status);
      const changesJson: Record<string, any> = { taskId, taskSource, updates: fields };

      switch (taskSource) {
        case "operational": {
          const setObj: any = {};
          if (fields.status !== undefined) setObj.status = fields.status;
          if (fields.title !== undefined) setObj.title = fields.title;
          if (fields.projectName !== undefined) setObj.projectName = fields.projectName;
          if (fields.projectId !== undefined) setObj.projectId = fields.projectId;
          if (fields.ownerUserId !== undefined) setObj.ownerUserId = fields.ownerUserId;
          if (fields.dueDate !== undefined) setObj.dueDate = fields.dueDate;
          if (fields.priority !== undefined) setObj.priority = fields.priority;
          if (fields.description !== undefined) setObj.description = fields.description;
          setObj.updatedAt = new Date();
          await db.update(operationalTasks).set(setObj).where(eq(operationalTasks.id, taskId));
          break;
        }
        case "personal": {
          const setObj: any = {};
          if (fields.status !== undefined) setObj.status = fields.status;
          if (fields.title !== undefined) setObj.title = fields.title;
          if (fields.projectName !== undefined) setObj.projectName = fields.projectName;
          if (fields.ownerUserId !== undefined) setObj.ownerUserId = fields.ownerUserId;
          if (fields.priority !== undefined) setObj.priority = fields.priority;
          setObj.updatedAt = new Date();
          await db.update(mytoolTasks).set(setObj).where(eq(mytoolTasks.id, taskId));
          break;
        }
        case "engineering_task": {
          const setObj: any = {};
          if (fields.status !== undefined) setObj.status = fields.status;
          if (fields.title !== undefined) setObj.title = fields.title;
          if (fields.projectName !== undefined) setObj.projectName = fields.projectName;
          if (fields.assigneeUserId !== undefined) setObj.assigneeUserId = fields.assigneeUserId;
          if (fields.description !== undefined) setObj.description = fields.description;
          setObj.updatedAt = new Date();
          await db.update(engineeringTasks).set(setObj).where(eq(engineeringTasks.id, taskId));
          break;
        }
        case "plan": {
          const setObj: any = {};
          if (fields.status !== undefined) setObj.status = fields.status;
          if (fields.title !== undefined) setObj.title = fields.title;
          if (fields.projectId !== undefined) setObj.projectId = fields.projectId;
          if (fields.ownerUserId !== undefined) setObj.ownerUserId = fields.ownerUserId;
          if (fields.workstream !== undefined) setObj.workstream = fields.workstream;
          if (fields.description !== undefined) setObj.description = fields.description;
          setObj.updatedAt = new Date();
          await db.update(workItems).set(setObj).where(eq(workItems.id, taskId));
          break;
        }
        default:
          return res.status(400).json({ error: `Unknown task source: ${taskSource}` });
      }

      logAuditFromReq(req, {
        entityType: "task",
        entityId: String(taskId),
        action: "admin_recovery_edit",
        changesJson,
        source: "UI",
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[AdminRecovery] PATCH task error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/recovery/imports", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
      const offset = parseInt(String(req.query.offset || "0"));

      const runs = await db.select({
        id: smartImportRuns.id,
        projectName: smartImportRuns.projectName,
        sourceFileName: smartImportRuns.sourceFileName,
        status: smartImportRuns.status,
        uploadedAt: smartImportRuns.uploadedAt,
        uploadedBy: smartImportRuns.uploadedBy,
        summaryJson: smartImportRuns.summaryJson,
      }).from(smartImportRuns)
        .orderBy(desc(smartImportRuns.uploadedAt))
        .limit(limit)
        .offset(offset);

      const runIds = runs.map(r => r.id);
      let issues: any[] = [];
      if (runIds.length > 0) {
        issues = await db.select().from(importIssues)
          .where(sql`${importIssues.importRunId} = ANY(${runIds})`);
      }

      const issuesByRun = new Map<number, any[]>();
      for (const issue of issues) {
        const list = issuesByRun.get(issue.importRunId) || [];
        list.push(issue);
        issuesByRun.set(issue.importRunId, list);
      }

      const enriched = runs.map(r => ({
        ...r,
        issues: issuesByRun.get(r.id) || [],
        issueCount: (issuesByRun.get(r.id) || []).length,
      }));

      res.json({ runs: enriched, total: enriched.length });
    } catch (err: any) {
      console.error("[AdminRecovery] GET imports error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/recovery/deleted", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const deletedWorkItems = await db.select({
        id: workItems.id,
        title: workItems.title,
        status: workItems.status,
        projectId: workItems.projectId,
        deletedAt: workItems.deletedAt,
        ownerUserId: workItems.ownerUserId,
        workstream: workItems.workstream,
      }).from(workItems)
        .where(isNotNull(workItems.deletedAt))
        .orderBy(desc(workItems.deletedAt))
        .limit(100);

      const deletedEngTasks = await db.select({
        id: engineeringTasks.id,
        title: engineeringTasks.title,
        status: engineeringTasks.status,
        projectName: engineeringTasks.projectName,
        softDeletedAt: engineeringTasks.softDeletedAt,
        assigneeUserId: engineeringTasks.assigneeUserId,
      }).from(engineeringTasks)
        .where(isNotNull(engineeringTasks.softDeletedAt))
        .orderBy(desc(engineeringTasks.softDeletedAt))
        .limit(100);

      const deletedOpTasks = await db.select({
        id: operationalTasks.id,
        title: operationalTasks.title,
        status: operationalTasks.status,
        projectName: operationalTasks.projectName,
        deletedAt: operationalTasks.deletedAt,
        ownerUserId: operationalTasks.ownerUserId,
      }).from(operationalTasks)
        .where(isNotNull(operationalTasks.deletedAt))
        .orderBy(desc(operationalTasks.deletedAt))
        .limit(100);

      const deletedMytoolTasks = await db.select({
        id: mytoolTasks.id,
        title: mytoolTasks.title,
        status: mytoolTasks.status,
        deletedAt: mytoolTasks.deletedAt,
        ownerUserId: mytoolTasks.ownerUserId,
      }).from(mytoolTasks)
        .where(isNotNull(mytoolTasks.deletedAt))
        .orderBy(desc(mytoolTasks.deletedAt))
        .limit(100);

      const items = [
        ...deletedWorkItems.map(wi => ({
          ...wi,
          type: "work_item" as const,
          deletedDate: wi.deletedAt,
        })),
        ...deletedEngTasks.map(et => ({
          ...et,
          type: "engineering_task" as const,
          deletedDate: et.softDeletedAt,
        })),
        ...deletedOpTasks.map(ot => ({
          ...ot,
          type: "operational_task" as const,
          deletedDate: ot.deletedAt,
        })),
        ...deletedMytoolTasks.map(mt => ({
          ...mt,
          type: "mytool_task" as const,
          deletedDate: mt.deletedAt,
        })),
      ].sort((a, b) => {
        const da = a.deletedDate ? new Date(a.deletedDate).getTime() : 0;
        const db2 = b.deletedDate ? new Date(b.deletedDate).getTime() : 0;
        return db2 - da;
      });

      res.json({ items, total: items.length });
    } catch (err: any) {
      console.error("[AdminRecovery] GET deleted error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/recovery/restore", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = restoreSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid restore data", details: parsed.error.issues });

      let restored = 0;
      for (const item of parsed.data.items) {
        if (item.type === "work_item") {
          await db.update(workItems).set({ deletedAt: null }).where(eq(workItems.id, item.id));
          restored++;
        } else if (item.type === "engineering_task") {
          await db.update(engineeringTasks).set({ softDeletedAt: null }).where(eq(engineeringTasks.id, item.id));
          restored++;
        } else if (item.type === "operational_task") {
          await db.update(operationalTasks).set({ deletedAt: null }).where(eq(operationalTasks.id, item.id));
          restored++;
        } else if (item.type === "mytool_task") {
          await db.update(mytoolTasks).set({ deletedAt: null }).where(eq(mytoolTasks.id, item.id));
          restored++;
        }
      }

      logAuditFromReq(req, {
        entityType: "recovery",
        action: "restore_deleted_items",
        changesJson: { items: parsed.data.items, restoredCount: restored },
        source: "UI",
      });

      res.json({ success: true, restored });
    } catch (err: any) {
      console.error("[AdminRecovery] POST restore error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/recovery/project/:id", jwtAuth, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const parsed = projectPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid project data", details: parsed.error.issues });

      const fields = parsed.data;
      const setObj: any = {};
      if (fields.projectName !== undefined) setObj.projectName = fields.projectName;
      if (fields.pm !== undefined) setObj.pm = fields.pm;
      if (fields.pd !== undefined) setObj.pd = fields.pd;
      if (fields.phase !== undefined) setObj.phase = fields.phase;
      if (fields.executionPhase !== undefined) setObj.executionPhase = fields.executionPhase;
      if (fields.sizeKwp !== undefined) setObj.sizeKwp = fields.sizeKwp;
      if (fields.contractValue !== undefined) setObj.contractValue = fields.contractValue;
      if (fields.ragStatus !== undefined) setObj.ragStatus = fields.ragStatus;
      if (fields.ragComment !== undefined) setObj.ragComment = fields.ragComment;
      if (fields.isActive !== undefined) setObj.isActive = fields.isActive;
      if (fields.pmUserId !== undefined) setObj.pmUserId = fields.pmUserId;
      if (fields.pdUserId !== undefined) setObj.pdUserId = fields.pdUserId;
      if (fields.clientId !== undefined) setObj.clientId = fields.clientId;
      setObj.updatedAt = new Date();

      await db.update(projectInfo).set(setObj).where(eq(projectInfo.id, projectId));

      logAuditFromReq(req, {
        entityType: "project_info",
        entityId: String(projectId),
        action: "admin_recovery_project_edit",
        changesJson: { projectId, updates: fields },
        source: "UI",
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[AdminRecovery] PATCH project error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

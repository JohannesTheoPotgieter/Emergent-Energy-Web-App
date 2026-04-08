/**
 * Work Items Routes — Extracted from server/routes.ts (Phase 4a)
 *
 * 7 handlers:
 *   GET    /api/tasks
 *   POST   /api/work-items/delete
 *   POST   /api/work-items/restore
 *   GET    /api/work-items/deleted
 *   GET    /api/work-items/:id/viewers
 *   POST   /api/work-items/:id/viewers
 *   DELETE /api/work-items/:id/viewers/:userId
 */

import type { Express } from "express";
import { paramStr } from "../lib/req-params";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { logAuditFromReq } from "../audit-logger";

export function registerWorkItemsExtractedRoutes(app: Express): void {

  // ==================== TASKS (LEGACY READ) ====================

  app.get("/api/tasks", requireAuth, async (req, res) => {
    try {
      // Strip internal fields from task responses
      const stripTask = ({ sourceSheet, rowLocator, ...rest }: any) => rest;

      const { projectId } = req.query;
      if (projectId && typeof projectId === 'string') {
        const tasks = await storage.getTasksByProject(parseInt(projectId));
        return res.json(tasks.map(stripTask));
      }
      const tasks = await storage.getAllTasks();

      const user = (req as any).user;
      const role = user?.role || "";
      const FULL_ACCESS_ROLES = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "ENGINEERING_MANAGER", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER"];
      if (FULL_ACCESS_ROLES.includes(role)) {
        return res.json(tasks.map(stripTask));
      }

      const userId = user?.id || user?.userId;
      const userName = (user?.name || "").toLowerCase();
      const scopedTasks = tasks.filter((t: any) => {
        if (t.ownerUserId === userId || t.createdBy === userId) return true;
        const assignees = (t.assignees || "").toLowerCase();
        if (userName && assignees.includes(userName)) return true;
        const assigneeIds = t.assigneeUserIds || [];
        if (Array.isArray(assigneeIds) && assigneeIds.includes(userId)) return true;
        return false;
      });
      res.json(scopedTasks.map(stripTask));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks", message: "Failed to fetch tasks" });
    }
  });

  // ==================== WORK ITEMS ADMIN ====================

  app.post("/api/work-items/delete", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids[] required" });
      }
      const userId = (req as any).user?.id || (req as any).jwtPayload?.userId || null;
      const now = new Date().toISOString();
      for (const id of ids) {
        await db.execute(sql`UPDATE work_items SET deleted_at = ${now} WHERE id = ${id} AND deleted_at IS NULL`);
      }
      logAuditFromReq(req, { entityType: "work_item", action: "soft_delete", changesJson: { description: `${ids.length} work item(s) soft-deleted`, ids, deletedBy: userId } });
      res.json({ message: `Deleted ${ids.length} work item(s)`, undoAvailable: true, ids });
    } catch (error: any) {
      console.error("[WorkItemsDelete] Error:", error);
      res.status(500).json({ error: "Failed to delete work items" });
    }

  });

  app.post("/api/work-items/restore", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids[] required" });
      }
      for (const id of ids) {
        await db.execute(sql`UPDATE work_items SET deleted_at = NULL WHERE id = ${id}`);
      }
      logAuditFromReq(req, { entityType: "work_item", action: "restore", changesJson: { description: `${ids.length} work item(s) restored`, ids } });
      res.json({ message: `Restored ${ids.length} work item(s)` });
    } catch (error: any) {
      console.error("[WorkItemsRestore] Error:", error);
      res.status(500).json({ error: "Failed to restore work items" });
    }

  });

  app.get("/api/work-items/deleted", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT wi.id, wi.title, wi.status, wi.deleted_at, wi.project_id,
               pi.project_name
        FROM work_items wi
        LEFT JOIN project_info pi ON wi.project_id = pi.id
        WHERE wi.deleted_at IS NOT NULL
        ORDER BY wi.deleted_at DESC
        LIMIT 200
      `);
      const results = Array.isArray(rows) ? rows : (rows.rows || []);
      res.json(results);
    } catch (error: any) {
      console.error("[WorkItemsDeleted] Error:", error);
      res.status(500).json({ error: "Failed to list deleted work items" });
    }
  });

  // ==================== WORK ITEM VIEWERS ====================

  app.get("/api/work-items/:id/viewers", requireAuth, async (req, res) => {
    try {
      const workItemId = parseInt(paramStr(req.params.id));
      if (isNaN(workItemId)) return res.status(400).json({ error: "Invalid work item id" });
      const rows = await db.execute(sql`
        SELECT wia.id, wia.work_item_id, wia.user_id, wia.role, wia.created_at,
               u.name as user_name, u.username, u.role as user_role
        FROM work_item_assignments wia
        LEFT JOIN users u ON wia.user_id = u.id
        WHERE wia.work_item_id = ${workItemId} AND wia.role = 'VIEWER'
      `);
      const results = Array.isArray(rows) ? rows : (rows.rows || []);
      res.json(results);
    } catch (error: any) {
      console.error("[WorkItemViewers] Error:", error);
      res.status(500).json({ error: "Failed to list viewers" });
    }
  });

  app.post("/api/work-items/:id/viewers", requireAuth, async (req, res) => {
    try {
      const workItemId = parseInt(paramStr(req.params.id));
      const { userId: viewerUserId } = req.body;
      if (isNaN(workItemId)) return res.status(400).json({ error: "Invalid work item id" });
      if (!viewerUserId || typeof viewerUserId !== "number") return res.status(400).json({ error: "userId is required" });

      const existing = await db.execute(sql`
        SELECT id FROM work_item_assignments WHERE work_item_id = ${workItemId} AND user_id = ${viewerUserId} AND role = 'VIEWER'
      `).then((r: any) => Array.isArray(r) ? r : (r.rows || []));

      if (existing.length > 0) {
        return res.json({ message: "User is already a viewer", alreadyExists: true });
      }

      await db.execute(sql`
        INSERT INTO work_item_assignments (work_item_id, user_id, role, created_at)
        VALUES (${workItemId}, ${viewerUserId}, 'VIEWER', NOW())
      `);

      logAuditFromReq(req, {
        entityType: "work_item_assignment",
        entityId: String(workItemId),
        action: "add_viewer",
        changesJson: { workItemId, viewerUserId },
      });

      res.json({ success: true, workItemId, viewerUserId });
    } catch (error: any) {
      console.error("[WorkItemViewers] Add error:", error);
      res.status(500).json({ error: "Failed to add viewer" });
    }
  });

  app.delete("/api/work-items/:id/viewers/:userId", requireAuth, async (req, res) => {
    try {
      const workItemId = parseInt(paramStr(req.params.id));
      const viewerUserId = parseInt(paramStr(req.params.userId));
      if (isNaN(workItemId) || isNaN(viewerUserId)) return res.status(400).json({ error: "Invalid parameters" });

      await db.execute(sql`
        DELETE FROM work_item_assignments
        WHERE work_item_id = ${workItemId} AND user_id = ${viewerUserId} AND role = 'VIEWER'
      `);

      logAuditFromReq(req, {
        entityType: "work_item_assignment",
        entityId: String(workItemId),
        action: "remove_viewer",
        changesJson: { workItemId, viewerUserId },
      });

      res.json({ success: true, workItemId, viewerUserId });
    } catch (error: any) {
      console.error("[WorkItemViewers] Remove error:", error);
      res.status(500).json({ error: "Failed to remove viewer" });
    }
  });
}

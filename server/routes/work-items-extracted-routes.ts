/**
 * Work Items Routes — Extracted from server/routes.ts (Phase 4a)
 *
 * 6 handlers:
 *   POST   /api/work-items/delete
 *   POST   /api/work-items/restore
 *   GET    /api/work-items/deleted
 *   GET    /api/work-items/:id/viewers
 *   POST   /api/work-items/:id/viewers
 *   DELETE /api/work-items/:id/viewers/:userId
 */

import type { Express } from "express";
import { paramStr, parseIntParam } from "../lib/req-params";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { logAuditFromReq } from "../audit-logger";

export function registerWorkItemsExtractedRoutes(app: Express): void {

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
      const workItemId = parseIntParam(req.params.id);
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
      const workItemId = parseIntParam(req.params.id);
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
      const workItemId = parseIntParam(req.params.id);
      const viewerUserId = parseIntParam(req.params.userId);
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

// ============================================================
// PROJECT ACCESS ROUTES — Project-level access control (Prompt 6)
// ============================================================

import type { Express } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { jwtAuth, requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";

export function registerProjectAccessRoutes(app: Express) {

// ── List project team ──────────────────────────────────────

app.get("/api/projects/:id/access", jwtAuth, requireAuth, requirePermission("project_access_mgmt", "view"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);

    const accessRecords = await db
      .select({
        id: schema.projectAccess.id,
        projectId: schema.projectAccess.projectId,
        userId: schema.projectAccess.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userRole: schema.users.role,
        accessLevel: schema.projectAccess.accessLevel,
        roleOnProject: schema.projectAccess.roleOnProject,
        stagesVisible: schema.projectAccess.stagesVisible,
        canEdit: schema.projectAccess.canEdit,
        canApprove: schema.projectAccess.canApprove,
        grantedAt: schema.projectAccess.grantedAt,
        expiresAt: schema.projectAccess.expiresAt,
        notes: schema.projectAccess.notes,
      })
      .from(schema.projectAccess)
      .innerJoin(schema.users, eq(schema.users.id, schema.projectAccess.userId))
      .where(eq(schema.projectAccess.projectId, projectId))
      .orderBy(schema.projectAccess.roleOnProject);

    res.json({ team: accessRecords });
  } catch (err: any) {
    console.error("Project access list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Add user to project ────────────────────────────────────

app.post("/api/projects/:id/access", jwtAuth, requireAuth, requirePermission("project_access_mgmt", "edit"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const grantedBy = (req as any).user?.id;
    const { userId, accessLevel, roleOnProject, stagesVisible, canEdit, canApprove, notes } = req.body;

    const result = await db.insert(schema.projectAccess).values({
      projectId,
      userId,
      accessLevel: accessLevel || "contributor",
      roleOnProject: roleOnProject || "pm",
      stagesVisible: stagesVisible || [],
      canEdit: canEdit ?? false,
      canApprove: canApprove ?? false,
      grantedByUserId: grantedBy,
      notes,
    }).returning();

    res.json({ access: result[0] });
  } catch (err: any) {
    console.error("Project access create error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Update project access ──────────────────────────────────

app.put("/api/projects/:id/access/:accessId", jwtAuth, requireAuth, requirePermission("project_access_mgmt", "edit"), async (req, res) => {
  try {
    const accessId = Number(req.params.accessId);
    const { accessLevel, roleOnProject, stagesVisible, canEdit, canApprove, expiresAt, notes } = req.body;

    await db.update(schema.projectAccess)
      .set({
        accessLevel: accessLevel ?? undefined,
        roleOnProject: roleOnProject ?? undefined,
        stagesVisible: stagesVisible ?? undefined,
        canEdit: canEdit ?? undefined,
        canApprove: canApprove ?? undefined,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        notes: notes ?? undefined,
      })
      .where(eq(schema.projectAccess.id, accessId));

    res.json({ success: true });
  } catch (err: any) {
    console.error("Project access update error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Remove project access ──────────────────────────────────

app.delete("/api/projects/:id/access/:accessId", jwtAuth, requireAuth, requirePermission("project_access_mgmt", "delete"), async (req, res) => {
  try {
    const accessId = Number(req.params.accessId);
    await db.update(schema.projectAccess).set({ deletedAt: new Date(), deletedBy: (req as any).user?.id }).where(eq(schema.projectAccess.id, accessId)).returning();
    res.json({ success: true });
  } catch (err: any) {
    console.error("Project access delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk assign from template ──────────────────────────────

app.post("/api/projects/:id/access/bulk", jwtAuth, requireAuth, requirePermission("project_access_mgmt", "edit"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const grantedBy = (req as any).user?.id;
    const { assignments } = req.body;
    // assignments: Array<{ userId, accessLevel, roleOnProject, stagesVisible, canEdit, canApprove }>

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: "No assignments provided" });
    }

    const values = assignments.map((a: any) => ({
      projectId,
      userId: a.userId,
      accessLevel: a.accessLevel || "contributor",
      roleOnProject: a.roleOnProject || "pm",
      stagesVisible: a.stagesVisible || [],
      canEdit: a.canEdit ?? false,
      canApprove: a.canApprove ?? false,
      grantedByUserId: grantedBy,
    }));

    const result = await db.insert(schema.projectAccess).values(values).returning();
    res.json({ created: result.length });
  } catch (err: any) {
    console.error("Project access bulk error:", err);
    res.status(500).json({ error: err.message });
  }
});

} // end registerProjectAccessRoutes

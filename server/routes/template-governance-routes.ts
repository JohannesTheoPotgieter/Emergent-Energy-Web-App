// ============================================================
// TEMPLATE GOVERNANCE ROUTES — Versioning, overrides, audit trail
// ============================================================

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { jwtAuth, requireAuth } from "../auth-context";
import { requireRole } from "../middleware/requireRole";
import { logAuditFromReq } from "../audit-logger";
import * as schema from "@shared/schema";
import { TEMPLATE_TYPES, templateOverrides } from "@shared/schema/template-overrides";
import { diffTemplateVsOpenStages, applyTemplateSync } from "../services/stage-lifecycle-service";

const COO_ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];

// Hard role gate for template-governance writes — these handlers
// publish stage-checklist versions and per-project overrides that
// affect every project's gate evaluation. Without this gate (added in
// response to security review finding #2), any authenticated user
// could create override rows or version templates. Reads stay
// requireAuth-only because the data is operational and used by the
// stage-gate UI from non-admin roles.
const TEMPLATE_WRITE_ROLES = COO_ADMIN_ROLES;

function getUser(req: Request): { id: number; name: string; role: string } {
  const u = (req as any).user;
  return { id: u?.id || u?.userId, name: u?.name || "unknown", role: u?.role || "unknown" };
}

function isAdmin(role: string): boolean {
  return COO_ADMIN_ROLES.includes(role);
}

export function registerTemplateGovernanceRoutes(app: Express) {

// ── Stage Checklist Templates ─────────────────────────────

// GET /api/templates/stage-checklist — list all current stage checklist templates
app.get("/api/templates/stage-checklist", jwtAuth, requireAuth, async (req: Request, res: Response) => {
  try {
    const templates = await db
      .select()
      .from(schema.stageChecklistTemplates)
      .where(
        and(
          eq(schema.stageChecklistTemplates.isCurrentVersion, true),
          isNull(schema.stageChecklistTemplates.deletedAt),
        ),
      )
      .orderBy(schema.stageChecklistTemplates.stageCode, schema.stageChecklistTemplates.sortOrder);

    res.json({ templates });
  } catch (err: unknown) {
    console.error("List stage checklist templates error:", err);
    res.status(500).json({ error: "Failed to list stage checklist templates" });
  }
});

// GET /api/templates/stage-checklist/:id/versions — version history for a template item
app.get("/api/templates/stage-checklist/:id/versions", jwtAuth, requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template id" });

    // First fetch the template to get its itemCode (versions share the same itemCode + stageCode)
    const [template] = await db
      .select()
      .from(schema.stageChecklistTemplates)
      .where(eq(schema.stageChecklistTemplates.id, id));

    if (!template) return res.status(404).json({ error: "Template not found" });

    const versions = await db
      .select()
      .from(schema.stageChecklistTemplates)
      .where(
        and(
          eq(schema.stageChecklistTemplates.itemCode, template.itemCode),
          eq(schema.stageChecklistTemplates.stageCode, template.stageCode),
          isNull(schema.stageChecklistTemplates.deletedAt),
        ),
      )
      .orderBy(desc(schema.stageChecklistTemplates.version));

    res.json({ versions });
  } catch (err: unknown) {
    console.error("Template version history error:", err);
    res.status(500).json({ error: "Failed to fetch template version history" });
  }
});

// POST /api/templates/stage-checklist/:id/version — create a new version (admin only)
app.post("/api/templates/stage-checklist/:id/version", jwtAuth, requireAuth, requireRole(TEMPLATE_WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!isAdmin(user.role)) {
      return res.status(403).json({ error: "Admin role required to create template versions" });
    }

    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template id" });

    const [existing] = await db
      .select()
      .from(schema.stageChecklistTemplates)
      .where(eq(schema.stageChecklistTemplates.id, id));

    if (!existing) return res.status(404).json({ error: "Template not found" });

    const { itemName, blocksGate, isRequired, sortOrder, editReason } = req.body;
    if (!editReason) return res.status(400).json({ error: "editReason is required" });

    // Mark old version as not current
    await db
      .update(schema.stageChecklistTemplates)
      .set({ isCurrentVersion: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.stageChecklistTemplates.itemCode, existing.itemCode),
          eq(schema.stageChecklistTemplates.stageCode, existing.stageCode),
          eq(schema.stageChecklistTemplates.isCurrentVersion, true),
        ),
      );

    // Insert new version
    const [newVersion] = await db
      .insert(schema.stageChecklistTemplates)
      .values({
        stageCode: existing.stageCode,
        department: existing.department,
        itemName: itemName ?? existing.itemName,
        itemCode: existing.itemCode,
        blocksGate: blocksGate ?? existing.blocksGate,
        isRequired: isRequired ?? existing.isRequired,
        sortOrder: sortOrder ?? existing.sortOrder,
        isActive: existing.isActive,
        version: existing.version + 1,
        isCurrentVersion: true,
        isSystemDefault: false,
        editedBy: user.id,
        editedAt: new Date(),
        editReason,
      })
      .returning();

    await logAuditFromReq(req, {
      entityType: "stage_checklist_template",
      entityId: String(newVersion.id),
      action: "template_version_created",
      changesJson: {
        previousVersionId: existing.id,
        previousVersion: existing.version,
        newVersion: newVersion.version,
        editReason,
      },
    });

    res.json({ template: newVersion });
  } catch (err: unknown) {
    console.error("Create template version error:", err);
    res.status(500).json({ error: "Failed to create template version" });
  }
});

// ── Template Overrides ────────────────────────────────────

// POST /api/templates/overrides — create a project-level template override
app.post("/api/templates/overrides", jwtAuth, requireAuth, requireRole(TEMPLATE_WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!isAdmin(user.role)) {
      return res.status(403).json({ error: "Admin role required to create template overrides" });
    }

    const { templateType, sourceTemplateId, projectId, overrideData, overrideReason } = req.body;

    if (!templateType || !sourceTemplateId || !overrideData || !overrideReason) {
      return res.status(400).json({
        error: "templateType, sourceTemplateId, overrideData, and overrideReason are required",
      });
    }

    if (!TEMPLATE_TYPES.includes(templateType)) {
      return res.status(400).json({ error: `Invalid templateType. Must be one of: ${TEMPLATE_TYPES.join(", ")}` });
    }

    const [override] = await db
      .insert(templateOverrides)
      .values({
        templateType,
        sourceTemplateId,
        projectId: projectId ?? null,
        overrideData,
        overrideReason,
        overriddenBy: user.id,
        isActive: true,
      })
      .returning();

    await logAuditFromReq(req, {
      entityType: "template_override",
      entityId: String(override.id),
      action: "template_override_created",
      changesJson: {
        templateType,
        sourceTemplateId,
        projectId: projectId ?? null,
        overrideReason,
      },
    });

    res.json({ override });
  } catch (err: unknown) {
    console.error("Create template override error:", err);
    res.status(500).json({ error: "Failed to create template override" });
  }
});

// GET /api/templates/overrides/:projectId — get overrides for a project
app.get("/api/templates/overrides/:projectId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.projectId);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

    const overrides = await db
      .select()
      .from(templateOverrides)
      .where(
        and(
          eq(templateOverrides.projectId, projectId),
          eq(templateOverrides.isActive, true),
          isNull(templateOverrides.deletedAt),
        ),
      )
      .orderBy(desc(templateOverrides.createdAt));

    res.json({ overrides });
  } catch (err: unknown) {
    console.error("Get template overrides error:", err);
    res.status(500).json({ error: "Failed to fetch template overrides" });
  }
});

// DELETE /api/templates/overrides/:id — deactivate an override (soft-delete)
app.delete("/api/templates/overrides/:id", jwtAuth, requireAuth, requireRole(TEMPLATE_WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!isAdmin(user.role)) {
      return res.status(403).json({ error: "Admin role required to deactivate template overrides" });
    }

    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid override id" });

    const [existing] = await db
      .select()
      .from(templateOverrides)
      .where(eq(templateOverrides.id, id));

    if (!existing) return res.status(404).json({ error: "Override not found" });
    if (existing.deletedAt) return res.status(400).json({ error: "Override already deactivated" });

    await db
      .update(templateOverrides)
      .set({
        isActive: false,
        deletedAt: new Date(),
        deletedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(templateOverrides.id, id));

    await logAuditFromReq(req, {
      entityType: "template_override",
      entityId: String(id),
      action: "template_override_deactivated",
      changesJson: {
        templateType: existing.templateType,
        sourceTemplateId: existing.sourceTemplateId,
        projectId: existing.projectId,
      },
    });

    res.json({ success: true });
  } catch (err: unknown) {
    console.error("Deactivate template override error:", err);
    res.status(500).json({ error: "Failed to deactivate template override" });
  }
});

// GET /api/templates/overrides/:id/status — check override status
app.get("/api/templates/overrides/:id/status", jwtAuth, requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid override id" });

    // Check if there is an active override for this source template
    const [override] = await db
      .select()
      .from(templateOverrides)
      .where(
        and(
          eq(templateOverrides.id, id),
          isNull(templateOverrides.deletedAt),
        ),
      );

    if (!override) return res.status(404).json({ error: "Override not found" });

    // Determine status based on override properties
    let status: "default" | "admin-modified" | "project-override";

    if (override.projectId) {
      status = "project-override";
    } else if (override.isActive) {
      status = "admin-modified";
    } else {
      status = "default";
    }

    res.json({
      id: override.id,
      status,
      templateType: override.templateType,
      sourceTemplateId: override.sourceTemplateId,
      projectId: override.projectId,
      isActive: override.isActive,
      overriddenAt: override.overriddenAt,
    });
  } catch (err: unknown) {
    console.error("Override status check error:", err);
    res.status(500).json({ error: "Failed to check override status" });
  }
});

// ── §6b: Sync current template version onto existing open stages ──
//
// Admin flow:
//   1. Edit a template item (POST /version above) — creates version N+1.
//   2. GET /sync-preview/:stageCode  → dry-run diff per project.
//   3. POST /sync/:stageCode { reason } → apply with audit trail.
// Closed stages (approved / progressed / exception_approved) are
// skipped; their snapshots are immutable per §6.

app.get(
  "/api/templates/stage-checklist/:stageCode/sync-preview",
  jwtAuth,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isAdmin(user.role)) {
        return res.status(403).json({ error: "Admin role required to preview a template sync" });
      }
      const stageCode = String(req.params.stageCode);
      const plans = await diffTemplateVsOpenStages(stageCode);
      const summary = plans.reduce(
        (acc, p) => {
          if (p.skipped) acc.projectsSkipped += 1;
          else {
            acc.added += p.toAdd.length;
            acc.updated += p.toUpdate.length;
            acc.removed += p.toRemove.length;
            if (p.toAdd.length + p.toUpdate.length + p.toRemove.length > 0) acc.projectsWithChanges += 1;
          }
          return acc;
        },
        { projectsWithChanges: 0, projectsSkipped: 0, added: 0, updated: 0, removed: 0 },
      );
      res.json({ stageCode, summary, plans });
    } catch (err: unknown) {
      console.error("Template sync preview error:", err);
      res.status(500).json({ error: "Failed to preview template sync" });
    }
  },
);

app.post(
  "/api/templates/stage-checklist/:stageCode/sync",
  jwtAuth,
  requireAuth,
  requireRole(TEMPLATE_WRITE_ROLES),
  async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      if (!isAdmin(user.role)) {
        return res.status(403).json({ error: "Admin role required to apply a template sync" });
      }
      const stageCode = String(req.params.stageCode);
      const reason: string | undefined = req.body?.reason;
      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({ error: "reason is required (min 10 characters)" });
      }
      const result = await applyTemplateSync({
        stageCode,
        actorUserId: user.id,
        actorRole: user.role,
        reason,
      });
      await logAuditFromReq(req, {
        entityType: "stage_checklist_template",
        entityId: stageCode,
        action: "template_sync_applied",
        changesJson: { ...result, reason: reason.trim() },
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Template sync apply error:", err);
      res.status(400).json({ error: msg });
    }
  },
);

} // end registerTemplateGovernanceRoutes

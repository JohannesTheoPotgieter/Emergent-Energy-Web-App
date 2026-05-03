// ============================================================
// STAGE ADMIN ROUTES — Stage definitions, templates, config (Prompt 6)
// ============================================================

import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { jwtAuth, requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";

export function registerStageAdminRoutes(app: Express) {

// ── Stage Definitions ──────────────────────────────────────

app.get("/api/admin/stage-definitions", jwtAuth, requireAuth, requirePermission("stage_admin", "view"), async (_req, res) => {
  try {
    const definitions = await db.select().from(schema.stageDefinitions).orderBy(schema.stageDefinitions.stageSequence);
    res.json({ definitions });
  } catch (err: any) {
    console.error("Stage definitions error:", err);
    throw err;
  }
});

app.post("/api/admin/stage-definitions", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const {
      stageCode,
      stageName,
      stageSequence,
      description,
      defaultOwnerRole,
      defaultApproverRole,
      isActive = true,
    } = req.body || {};
    if (!stageCode || !stageName || !Number.isFinite(Number(stageSequence))) {
      return res.status(400).json({ error: "stageCode, stageName and stageSequence are required" });
    }
    const [created] = await db.insert(schema.stageDefinitions).values({
      stageCode: String(stageCode).trim(),
      stageName: String(stageName).trim(),
      stageSequence: Number(stageSequence),
      description: description ?? null,
      defaultOwnerRole: defaultOwnerRole ?? null,
      defaultApproverRole: defaultApproverRole ?? null,
      isActive: !!isActive,
    }).returning();
    res.status(201).json({ definition: created });
  } catch (err: any) {
    console.error("Stage definition create error:", err);
    throw err;
  }
});

app.put("/api/admin/stage-definitions/:id", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { stageName, description, defaultOwnerRole, defaultApproverRole, isActive } = req.body;

    await db.update(schema.stageDefinitions)
      .set({
        stageName: stageName ?? undefined,
        description: description ?? undefined,
        defaultOwnerRole: defaultOwnerRole ?? undefined,
        defaultApproverRole: defaultApproverRole ?? undefined,
        isActive: isActive ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.stageDefinitions.id, id));

    res.json({ success: true });
  } catch (err: any) {
    console.error("Stage definition update error:", err);
    throw err;
  }
});
app.patch("/api/admin/stage-definitions/:id", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { stageName, description, defaultOwnerRole, defaultApproverRole, isActive, stageSequence } = req.body;

    await db.update(schema.stageDefinitions)
      .set({
        stageName: stageName ?? undefined,
        description: description ?? undefined,
        defaultOwnerRole: defaultOwnerRole ?? undefined,
        defaultApproverRole: defaultApproverRole ?? undefined,
        stageSequence: stageSequence ?? undefined,
        isActive: isActive ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.stageDefinitions.id, id));

    res.json({ success: true });
  } catch (err: any) {
    console.error("Stage definition patch error:", err);
    throw err;
  }
});

app.post("/api/admin/stage-definitions/reorder", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: "order array is required" });
    }
    for (const row of order) {
      if (!row || !Number.isFinite(Number(row.id)) || !Number.isFinite(Number(row.stageSequence))) {
        return res.status(400).json({ error: "order rows must include numeric id and stageSequence" });
      }
      await db.update(schema.stageDefinitions)
        .set({ stageSequence: Number(row.stageSequence), updatedAt: new Date() })
        .where(eq(schema.stageDefinitions.id, Number(row.id)));
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("Stage definition reorder error:", err);
    throw err;
  }
});

app.delete("/api/admin/stage-definitions/:id", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(schema.stageDefinitions)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.stageDefinitions.id, id));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Stage definition delete error:", err);
    throw err;
  }
});

// ── Stage Checklist Templates ──────────────────────────────

app.get("/api/admin/stage-checklist-templates", jwtAuth, requireAuth, requirePermission("stage_admin", "view"), async (req, res) => {
  try {
    const stageCode = req.query.stageCode as string | undefined;
    let query = db.select().from(schema.stageChecklistTemplates);
    if (stageCode) {
      query = query.where(eq(schema.stageChecklistTemplates.stageCode, stageCode)) as any;
    }
    const templates = await (query as any).orderBy(schema.stageChecklistTemplates.sortOrder);
    res.json({ templates });
  } catch (err: any) {
    console.error("Checklist templates error:", err);
    throw err;
  }
});

app.post("/api/admin/stage-checklist-templates", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const { stageCode, department, itemName, itemCode, blocksGate, isRequired, sortOrder } = req.body;
    const result = await db.insert(schema.stageChecklistTemplates).values({
      stageCode, department, itemName, itemCode,
      blocksGate: blocksGate ?? false,
      isRequired: isRequired ?? true,
      sortOrder: sortOrder ?? 0,
    }).returning();
    res.json({ template: result[0] });
  } catch (err: any) {
    console.error("Checklist template create error:", err);
    throw err;
  }
});

app.put("/api/admin/stage-checklist-templates/:id", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { itemName, blocksGate, isRequired, sortOrder, isActive } = req.body;

    await db.update(schema.stageChecklistTemplates)
      .set({
        itemName: itemName ?? undefined,
        blocksGate: blocksGate ?? undefined,
        isRequired: isRequired ?? undefined,
        sortOrder: sortOrder ?? undefined,
        isActive: isActive ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.stageChecklistTemplates.id, id));

    res.json({ success: true });
  } catch (err: any) {
    console.error("Checklist template update error:", err);
    throw err;
  }
});
app.patch("/api/admin/stage-checklist-templates/:id", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { itemName, blocksGate, isRequired, sortOrder, isActive, department } = req.body;
    await db.update(schema.stageChecklistTemplates)
      .set({
        itemName: itemName ?? undefined,
        blocksGate: blocksGate ?? undefined,
        isRequired: isRequired ?? undefined,
        sortOrder: sortOrder ?? undefined,
        isActive: isActive ?? undefined,
        department: department ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.stageChecklistTemplates.id, id));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Checklist template patch error:", err);
    throw err;
  }
});

app.delete("/api/admin/stage-checklist-templates/:id", jwtAuth, requireAuth, requirePermission("stage_admin", "edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(schema.stageChecklistTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.stageChecklistTemplates.id, id));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Checklist template delete error:", err);
    throw err;
  }
});

// ── Exception Thresholds (admin config) ────────────────────

app.get("/api/admin/exception-thresholds", jwtAuth, requireAuth, requirePermission("stage_admin", "view"), async (_req, res) => {
  try {
    // Return configured thresholds — stored as app config or defaults
    res.json({
      thresholds: {
        autoEscalationDays: 3,
        escalationTarget: "COO_ADMIN",
        riskLevels: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        approverRoles: ["COO_ADMIN", "CEO_ADMIN"],
      },
    });
  } catch (err: any) {
    console.error("Exception thresholds error:", err);
    throw err;
  }
});

// ── Gate Configuration ─────────────────────────────────────

app.get("/api/admin/gate-config", jwtAuth, requireAuth, requirePermission("stage_admin", "view"), async (_req, res) => {
  try {
    res.json({
      config: {
        slaTimers: {
          omReviewDays: 7,
          clientHandoverDays: 14,
          exceptionEscalationDays: 3,
          weeklyUpdateOverdueDays: 7,
          postHandoverReviewOverdueDays: 14,
        },
        deliverableTracks: [
          { code: "cost_proposal_signed", label: "Cost Proposal Signed", isRequired: true },
          { code: "epc_signed", label: "EPC Signed", isRequired: true },
          { code: "funding_signed", label: "Funding Contract Signed", isRequired: true },
          { code: "om_signed", label: "O&M Signed", isRequired: false },
        ],
      },
    });
  } catch (err: any) {
    console.error("Gate config error:", err);
    throw err;
  }
});

} // end registerStageAdminRoutes

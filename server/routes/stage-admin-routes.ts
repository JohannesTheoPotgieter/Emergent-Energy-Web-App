// ============================================================
// STAGE ADMIN ROUTES — Stage definitions, templates, config (Prompt 6)
// ============================================================

import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";

export function registerStageAdminRoutes(app: Express) {

// ── Stage Definitions ──────────────────────────────────────

app.get("/api/admin/stage-definitions", async (_req, res) => {
  try {
    const definitions = await db.select().from(schema.stageDefinitions).orderBy(schema.stageDefinitions.stageSequence);
    res.json({ definitions });
  } catch (err: any) {
    console.error("Stage definitions error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/stage-definitions/:id", async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ── Stage Checklist Templates ──────────────────────────────

app.get("/api/admin/stage-checklist-templates", async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/stage-checklist-templates", async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/stage-checklist-templates/:id", async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/stage-checklist-templates/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(schema.stageChecklistTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.stageChecklistTemplates.id, id));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Checklist template delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Exception Thresholds (admin config) ────────────────────

app.get("/api/admin/exception-thresholds", async (_req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ── Gate Configuration ─────────────────────────────────────

app.get("/api/admin/gate-config", async (_req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

} // end registerStageAdminRoutes

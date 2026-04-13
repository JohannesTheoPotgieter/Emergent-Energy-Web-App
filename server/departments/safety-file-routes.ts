/**
 * B7 (audit closeout) — Safety File routes.
 *
 * Permission model (mirrors B3 HSE incidents):
 *   - POST /api/projects/:projectId/safety-file/items
 *       any authenticated user can create an item
 *   - PATCH /api/safety-file-items/:id
 *       any authenticated user can edit descriptive fields
 *       ONLY HSE-approving roles (HSE_MANAGER, COO_ADMIN, CEO_ADMIN) can
 *       change compliance_status. Same gate pattern as B3.
 *   - DELETE /api/safety-file-items/:id
 *       any authenticated user can soft-delete (mark deleted_at)
 *   - GET endpoints require auth only
 */

import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { parseBody } from "../lib/input-validation";
import { eq, and, isNull } from "drizzle-orm";
import { safetyFileItems, insertSafetyFileItemSchema } from "@shared/schema/hse";
import {
  getSafetyFileCompleteness,
  getOverdueSafetyFileItems,
  SAFETY_FILE_APPROVER_ROLES,
} from "../services/safety-file-service";
import { logAuditFromReq } from "../audit-logger";

const router = Router();

/**
 * Check whether the PATCH body includes a compliance_status change and,
 * if so, whether the caller is allowed to make it. Returns null if the
 * update is allowed; otherwise returns a 403 payload the caller should
 * return to the client.
 */
async function approveGateForSafetyFileStatus(
  req: Request,
  res: Response,
  itemId: number,
): Promise<boolean> {
  if (!("complianceStatus" in req.body) && !("compliance_status" in req.body)) {
    return true;
  }
  const newStatus = (req.body.complianceStatus ?? req.body.compliance_status) as string;
  const [current] = await db
    .select({ status: safetyFileItems.complianceStatus })
    .from(safetyFileItems)
    .where(eq(safetyFileItems.id, itemId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "safety_file_item_not_found" });
    return false;
  }
  if (current.status === newStatus) return true;

  const role = String((req as any).user?.role ?? "");
  if (!SAFETY_FILE_APPROVER_ROLES.has(role)) {
    res.status(403).json({
      error: "forbidden",
      entity: "safety_file",
      action: "approve",
      reason:
        "Only HSE Manager, COO, or CEO can change a Safety File item's compliance status.",
      eligibleRoles: Array.from(SAFETY_FILE_APPROVER_ROLES),
      currentStatus: current.status,
      attemptedStatus: newStatus,
    });
    return false;
  }
  return true;
}

// ===================== LIST + COMPLETENESS =====================

router.get("/api/projects/:projectId/safety-file", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.projectId);
    if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

    const completeness = await getSafetyFileCompleteness(projectId);
    res.json(completeness);
  } catch (err) {
    console.error("[SafetyFile] Failed to load file:", err);
    res.status(500).json({ error: "Failed to load safety file" });
  }
});

// Dashboard query: overdue items across all projects.
router.get("/api/safety-file/overdue", requireAuth, async (req: Request, res: Response) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 500;
    const items = await getOverdueSafetyFileItems({ limit });
    res.json({ count: items.length, items });
  } catch (err) {
    console.error("[SafetyFile] Failed to load overdue items:", err);
    res.status(500).json({ error: "Failed to load overdue safety file items" });
  }
});

// ===================== CREATE =====================

router.post("/api/projects/:projectId/safety-file/items", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.projectId);
    if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

    // Parse body with projectId injected so Zod validation catches bad input.
    const bodyWithProject = { ...req.body, projectId, createdByUserId: (req as any).user?.id ?? null };
    const [parsed, validationError] = parseBody(bodyWithProject, insertSafetyFileItemSchema);
    if (validationError) return res.status(400).json(validationError);

    const [row] = await db.insert(safetyFileItems).values(parsed).returning();

    logAuditFromReq(req, {
      entityType: "safety_file_item",
      entityId: String(row.id),
      action: "safety_file.item_created",
      changesJson: {
        projectId,
        itemCode: row.itemCode,
        itemName: row.itemName,
        category: row.category,
        dueDate: row.dueDate,
      },
    });

    res.status(201).json(row);
  } catch (err) {
    console.error("[SafetyFile] Failed to create item:", err);
    res.status(500).json({ error: "Failed to create safety file item" });
  }
});

// ===================== UPDATE =====================

router.patch("/api/safety-file-items/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    // B7: gate compliance_status transitions behind HSE approver roles.
    const allowed = await approveGateForSafetyFileStatus(req, res, id);
    if (!allowed) return;

    // Auto-populate approval fields when status moves to approved.
    const updateData: Record<string, any> = { ...req.body, updatedAt: new Date() };
    const newStatus = updateData.complianceStatus ?? updateData.compliance_status;
    const userId = (req as any).user?.id ?? null;
    if (newStatus === "approved") {
      updateData.approvedAt = new Date();
      updateData.approvedByUserId = userId;
      updateData.rejectedReason = null;
    }
    if (newStatus === "rejected") {
      updateData.approvedAt = null;
      updateData.approvedByUserId = null;
    }
    if (updateData.sharepoint_ref && !updateData.sharepointRef) {
      updateData.sharepointRef = updateData.sharepoint_ref;
      delete updateData.sharepoint_ref;
    }
    if (updateData.compliance_status && !updateData.complianceStatus) {
      updateData.complianceStatus = updateData.compliance_status;
      delete updateData.compliance_status;
    }

    const [row] = await db
      .update(safetyFileItems)
      .set(updateData)
      .where(eq(safetyFileItems.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: "safety_file_item_not_found" });

    logAuditFromReq(req, {
      entityType: "safety_file_item",
      entityId: String(id),
      action: newStatus ? `safety_file.status_changed.${newStatus}` : "safety_file.item_updated",
      changesJson: { updates: req.body },
    });

    res.json(row);
  } catch (err) {
    console.error("[SafetyFile] Failed to update item:", err);
    res.status(500).json({ error: "Failed to update safety file item" });
  }
});

// ===================== SOFT DELETE =====================

router.delete("/api/safety-file-items/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .update(safetyFileItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(safetyFileItems.id, id), isNull(safetyFileItems.deletedAt)))
      .returning();

    if (!row) return res.status(404).json({ error: "Safety file item not found" });

    logAuditFromReq(req, {
      entityType: "safety_file_item",
      entityId: String(id),
      action: "safety_file.item_deleted",
      changesJson: { itemCode: row.itemCode },
    });

    res.json(row);
  } catch (err) {
    console.error("[SafetyFile] Failed to delete item:", err);
    res.status(500).json({ error: "Failed to delete safety file item" });
  }
});

export function registerSafetyFileRoutes(app: Express) {
  app.use(router);
}

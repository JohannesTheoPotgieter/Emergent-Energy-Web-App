/**
 * B7 (audit closeout) — Safety File routes.
 *
 * Permission model: every mutating endpoint now goes through the canonical
 * `hse_compliance` entity in the permission registry (create/edit/delete).
 * The compliance_status field still flows through the approve-permission
 * gate (HSE_MANAGER / COO_ADMIN / CEO_ADMIN per
 * `hse_compliance.approve_roles`) so the editor/approver split stays in
 * effect — but baseline writes are now properly gated rather than open to
 * any authenticated user.
 *
 * Body validation: PATCH bodies are whitelisted via Zod. Snake_case ↔
 * camelCase legacy bridging happens BEFORE Zod parsing so the schema sees
 * one canonical shape.
 *
 * Soft-delete: PATCH/DELETE filter `isNull(deletedAt)`.
 */

import { Router, type Express, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "./shared-middleware";
import { requirePermission, evaluatePermissionForRequest } from "../permission-middleware";
import { db } from "../db";
import { parseBody } from "../lib/input-validation";
import { eq, and, isNull } from "drizzle-orm";
import { safetyFileItems, SAFETY_FILE_COMPLIANCE_STATUSES } from "@shared/schema/hse";
import {
  getSafetyFileCompleteness,
  getOverdueSafetyFileItems,
} from "../services/safety-file-service";
import { logAuditFromReq } from "../audit-logger";
import { getEffectiveUser } from "../auth-context";

const router = Router();

const SAFETY_FILE_CATEGORIES = [
  "statutory",
  "registers",
  "appointments",
  "method_statements",
  "emergency",
  "other",
] as const;

const createSafetyFileItemSchema = z
  .object({
    itemCode: z.string().min(1).max(100),
    itemName: z.string().min(1).max(500),
    category: z.enum(SAFETY_FILE_CATEGORIES).optional(),
    required: z.boolean().optional(),
    dueDate: z.string().nullable().optional(),
    sharepointRef: z.string().max(2048).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();

const updateSafetyFileItemSchema = z
  .object({
    itemName: z.string().min(1).max(500).optional(),
    category: z.enum(SAFETY_FILE_CATEGORIES).optional(),
    required: z.boolean().optional(),
    dueDate: z.string().nullable().optional(),
    sharepointRef: z.string().max(2048).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    uploadedAt: z.union([z.string(), z.date()]).nullable().optional(),
    complianceStatus: z.enum(SAFETY_FILE_COMPLIANCE_STATUSES).optional(),
    rejectedReason: z.string().max(5000).nullable().optional(),
  })
  .strict();

/**
 * Normalise legacy snake_case → camelCase BEFORE Zod parsing so the schema
 * has one canonical shape. Returns a fresh object — never mutates the
 * caller's body.
 */
function bridgeLegacyBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  if (out.sharepoint_ref !== undefined && out.sharepointRef === undefined) {
    out.sharepointRef = out.sharepoint_ref;
  }
  delete out.sharepoint_ref;
  if (out.compliance_status !== undefined && out.complianceStatus === undefined) {
    out.complianceStatus = out.compliance_status;
  }
  delete out.compliance_status;
  if (out.rejected_reason !== undefined && out.rejectedReason === undefined) {
    out.rejectedReason = out.rejected_reason;
  }
  delete out.rejected_reason;
  return out;
}

/**
 * If the PATCH changes `complianceStatus`, require `hse_compliance:approve`.
 * Otherwise pass through. Reads use the normalized role from the canonical
 * permission resolver — handles lens-impersonation and role aliases.
 */
async function approveGateForSafetyFileStatus(
  req: Request,
  res: Response,
  itemId: number,
): Promise<boolean> {
  if (!("complianceStatus" in req.body)) return true;
  const newStatus = req.body.complianceStatus as string;
  const [current] = await db
    .select({ status: safetyFileItems.complianceStatus })
    .from(safetyFileItems)
    .where(and(eq(safetyFileItems.id, itemId), isNull(safetyFileItems.deletedAt)))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "safety_file_item_not_found" });
    return false;
  }
  if (current.status === newStatus) return true;

  const approval = await evaluatePermissionForRequest(req, "hse_compliance", "approve");
  if (!approval.allowed) {
    res.status(403).json({
      error: "forbidden",
      entity: "hse_compliance",
      action: "approve",
      reason: "Only HSE Manager, COO, or CEO can change a Safety File item's compliance status.",
      currentStatus: current.status,
      attemptedStatus: newStatus,
    });
    return false;
  }
  return true;
}

// ===================== LIST + COMPLETENESS =====================

router.get(
  "/api/projects/:projectId/safety-file",
  requireAuth,
  requirePermission("hse_compliance", "view"),
  async (req: Request, res: Response) => {
    try {
      const projectId = Number(req.params.projectId);
      if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
      const completeness = await getSafetyFileCompleteness(projectId);
      res.json(completeness);
    } catch (err) {
      console.error("[SafetyFile] Failed to load file:", err);
      res.status(500).json({ error: "Failed to load safety file" });
    }
  },
);

router.get(
  "/api/safety-file/overdue",
  requireAuth,
  requirePermission("hse_compliance", "view"),
  async (req: Request, res: Response) => {
    try {
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 500;
      const items = await getOverdueSafetyFileItems({ limit });
      res.json({ count: items.length, items });
    } catch (err) {
      console.error("[SafetyFile] Failed to load overdue items:", err);
      res.status(500).json({ error: "Failed to load overdue safety file items" });
    }
  },
);

// ===================== CREATE =====================

router.post(
  "/api/projects/:projectId/safety-file/items",
  requireAuth,
  requirePermission("hse_compliance", "create"),
  async (req: Request, res: Response) => {
    try {
      const projectId = Number(req.params.projectId);
      if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const [parsed, validationError] = parseBody(bridgeLegacyBody(req.body), createSafetyFileItemSchema);
      if (validationError) return res.status(400).json(validationError);

      const createdByUserId = getEffectiveUser(req)?.id ?? null;
      const [row] = await db
        .insert(safetyFileItems)
        .values({ ...parsed, projectId, createdByUserId })
        .returning();

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
  },
);

// ===================== UPDATE =====================

router.patch(
  "/api/safety-file-items/:id",
  requireAuth,
  requirePermission("hse_compliance", "edit"),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [parsed, validationError] = parseBody(bridgeLegacyBody(req.body), updateSafetyFileItemSchema);
      if (validationError) return res.status(400).json(validationError);
      req.body = parsed;

      const allowed = await approveGateForSafetyFileStatus(req, res, id);
      if (!allowed) return;

      const userId = getEffectiveUser(req)?.id ?? null;
      const updateData: Record<string, unknown> = { ...parsed, updatedAt: new Date() };
      const newStatus = parsed.complianceStatus;
      if (newStatus === "approved") {
        updateData.approvedAt = new Date();
        updateData.approvedByUserId = userId;
        updateData.rejectedReason = null;
      }
      if (newStatus === "rejected") {
        updateData.approvedAt = null;
        updateData.approvedByUserId = null;
      }

      const [row] = await db
        .update(safetyFileItems)
        .set(updateData)
        .where(and(eq(safetyFileItems.id, id), isNull(safetyFileItems.deletedAt)))
        .returning();

      if (!row) return res.status(404).json({ error: "safety_file_item_not_found" });

      logAuditFromReq(req, {
        entityType: "safety_file_item",
        entityId: String(id),
        action: newStatus ? `safety_file.status_changed.${newStatus}` : "safety_file.item_updated",
        changesJson: { updates: parsed },
      });

      res.json(row);
    } catch (err) {
      console.error("[SafetyFile] Failed to update item:", err);
      res.status(500).json({ error: "Failed to update safety file item" });
    }
  },
);

// ===================== SOFT DELETE =====================

router.delete(
  "/api/safety-file-items/:id",
  requireAuth,
  requirePermission("hse_compliance", "delete"),
  async (req: Request, res: Response) => {
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
  },
);

export function registerSafetyFileRoutes(app: Express) {
  app.use(router);
}

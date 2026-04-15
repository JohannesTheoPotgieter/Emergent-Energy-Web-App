/**
 * Engineering drawing register routes — CRUD for drawings and revisions
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { parseBody } from "../lib/input-validation";
import { eq, desc, and, isNull } from "drizzle-orm";
import {
  drawingRegister,
  drawingRevisions,
  insertDrawingRegisterSchema,
  DRAWING_STATUSES,
  DRAWING_STATUS_TRANSITIONS,
  type DrawingStatus,
} from "@shared/schema/engineering";
import { logAuditFromReq } from "../audit-logger";
import { getEffectiveUser } from "../auth-context";

const ENGINEER_ROLES = new Set<string>([
  "ENGINEER",
  "ENGINEERING_MANAGER",
  "COO_ADMIN",
  "CEO_ADMIN",
  "PROGRAM_MANAGER",
]);

// Fields on drawing_register that are safe for a general PATCH to touch.
// Status transitions and IFC/as-built timestamps are NOT in this list —
// they must go through the dedicated audit-aware branch below.
const PATCHABLE_FIELDS = new Set<string>([
  "drawingNumber",
  "title",
  "discipline",
  "currentRevision",
  "revisionDate",
  "authorUserId",
  "reviewerUserId",
  "approverUserId",
  "sharepointLink",
  "sheetSize",
  "notes",
]);

const router = Router();

router.get("/api/drawings", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(drawingRegister.deletedAt)];
    if (projectId) conditions.push(eq(drawingRegister.projectId, projectId));

    const rows = await db
      .select()
      .from(drawingRegister)
      .where(and(...conditions))
      .orderBy(desc(drawingRegister.updatedAt));

    res.json(rows);
  } catch (err) {
    console.error("[Drawings] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch drawings" });
  }
});

router.post("/api/drawings", requireAuth, async (req: Request, res: Response) => {
  try {
    const [parsed, validationError] = parseBody(req.body, insertDrawingRegisterSchema);
    if (validationError) return res.status(400).json(validationError);
    const [row] = await db.insert(drawingRegister).values(parsed).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[Drawings] Failed to create:", err);
    res.status(500).json({ error: "Failed to create drawing" });
  }
});

router.patch("/api/drawings/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const user = getEffectiveUser(req);

    const [existing] = await db.select().from(drawingRegister).where(eq(drawingRegister.id, id));
    if (!existing) return res.status(404).json({ error: "Drawing not found" });

    // Only include whitelisted fields in the generic update — prevents the
    // old "PATCH any column" behaviour that allowed clients to silently set
    // drawings to `ifc` without audit.
    const updates: Record<string, unknown> = {};
    for (const key of Object.keys(req.body || {})) {
      if (PATCHABLE_FIELDS.has(key)) {
        updates[key] = (req.body as any)[key];
      }
    }

    // Handle status transition separately, with an explicit rule engine.
    const incomingStatus = (req.body?.status ?? undefined) as string | undefined;
    if (incomingStatus !== undefined && incomingStatus !== existing.status) {
      if (!(DRAWING_STATUSES as readonly string[]).includes(incomingStatus)) {
        return res.status(400).json({
          error: "invalid_status",
          message: `Unknown drawing status "${incomingStatus}". Allowed: ${DRAWING_STATUSES.join(", ")}`,
        });
      }
      const from = (existing.status ?? "draft") as DrawingStatus;
      const to = incomingStatus as DrawingStatus;
      const allowedNext = DRAWING_STATUS_TRANSITIONS[from] ?? [];
      if (!allowedNext.includes(to)) {
        return res.status(409).json({
          error: "invalid_transition",
          message: `Drawing cannot go from "${from}" to "${to}". Allowed next: ${allowedNext.join(", ") || "(none)"}`,
          from,
          to,
          allowedNext,
        });
      }
      // "ifc" and "as_built" are controlled releases — gate by role.
      if ((to === "ifc" || to === "as_built") && !(user && ENGINEER_ROLES.has(user.role))) {
        return res.status(403).json({
          error: "forbidden",
          message: `Only engineers or COO can transition a drawing to "${to}"`,
        });
      }
      updates.status = to;
      if (to === "ifc") {
        updates.issuedForConstructionAt = new Date();
        updates.issuedForConstructionBy = user?.id ?? null;
      }
      if (to === "as_built") {
        updates.asBuiltAt = new Date();
        updates.asBuiltBy = user?.id ?? null;
      }
      logAuditFromReq(req, {
        entityType: "drawing_register",
        entityId: String(id),
        action: to === "ifc" ? "issue_for_construction" : to === "as_built" ? "mark_as_built" : "status_change",
        changesJson: {
          description: `Drawing status ${from} → ${to}`,
          drawingNumber: existing.drawingNumber,
          from,
          to,
        },
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    updates.updatedAt = new Date();
    const [row] = await db
      .update(drawingRegister)
      .set(updates)
      .where(eq(drawingRegister.id, id))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[Drawings] Failed to update:", err);
    res.status(500).json({ error: "Failed to update drawing" });
  }
});

// Revisions
router.get("/api/drawings/:drawingId/revisions", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(drawingRevisions)
      .where(eq(drawingRevisions.drawingId, Number(req.params.drawingId)))
      .orderBy(desc(drawingRevisions.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("[Drawings] Failed to fetch revisions:", err);
    res.status(500).json({ error: "Failed to fetch revisions" });
  }
});

router.post("/api/drawings/:drawingId/revisions", requireAuth, async (req: Request, res: Response) => {
  try {
    const drawingId = Number(req.params.drawingId);
    const [rev] = await db.insert(drawingRevisions).values({ ...req.body, drawingId }).returning();

    // Update the drawing's current revision
    await db.update(drawingRegister).set({
      currentRevision: rev.revision,
      revisionDate: rev.revisionDate,
      updatedAt: new Date(),
    }).where(eq(drawingRegister.id, drawingId));

    res.status(201).json(rev);
  } catch (err) {
    console.error("[Drawings] Failed to create revision:", err);
    res.status(500).json({ error: "Failed to create revision" });
  }
});

export function registerDrawingRegisterRoutes(app: Express) {
  app.use(router);
}

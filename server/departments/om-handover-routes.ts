/**
 * B8 (audit closeout) — O&M handover routes.
 *
 * Endpoints:
 *   GET  /api/projects/:projectId/om-handover
 *        Returns the O&M handover record + readiness snapshot.
 *   POST /api/projects/:projectId/om-handover
 *        Upsert the record. Any authenticated user.
 *   PATCH /api/om-handovers/:id
 *        Update descriptive fields + checklist booleans. Any
 *        authenticated user. Cannot change status to 'completed' via
 *        this endpoint — use mark-complete.
 *   POST /api/om-handovers/:id/mark-complete
 *        Mark the handover complete. Gated to
 *        OM_HANDOVER_COMPLETE_ROLES (COO_ADMIN, CEO_ADMIN,
 *        PROGRAM_MANAGER, CONSTRUCTION_MANAGER).
 *   GET  /api/om-handover/dashboard?daysAhead=30
 *        "Close to handover" dashboard with upcoming, overdue, and
 *        recently completed buckets. Default window 30 days.
 */

import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "./shared-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  acceptOmHandover,
  computeOmHandoverReadiness,
  getOmHandoverByProjectId,
  getOmHandoverDashboard,
  markOmHandoverComplete,
  upsertOmHandover,
  OM_HANDOVER_COMPLETE_ROLES,
  OM_HANDOVER_DASHBOARD_DEFAULT_DAYS,
} from "../services/om-handover-service";

const router = Router();

function requireOmHandoverCompleteRole(req: Request, res: Response, next: NextFunction) {
  const role = String((req as any).user?.role ?? "");
  if (OM_HANDOVER_COMPLETE_ROLES.has(role)) return next();
  return res.status(403).json({
    error: "forbidden",
    reason:
      "Only Program Manager, Construction Manager, COO, or CEO can mark an O&M handover complete. Everyone else can update the checklist and prepare the handover.",
    eligibleRoles: Array.from(OM_HANDOVER_COMPLETE_ROLES),
  });
}

// ===================== READ =====================

router.get("/api/projects/:projectId/om-handover", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.projectId);
    if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
    const row = await getOmHandoverByProjectId(projectId);
    const readiness = computeOmHandoverReadiness(row);
    res.json({ projectId, handover: row, readiness });
  } catch (err) {
    console.error("[OmHandover] Failed to load:", err);
    res.status(500).json({ error: "Failed to load O&M handover" });
  }
});

// ===================== DASHBOARD =====================

router.get("/api/om-handover/dashboard", requireAuth, async (req: Request, res: Response) => {
  try {
    const daysRaw = Number(req.query.daysAhead);
    const daysAhead =
      Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365
        ? daysRaw
        : OM_HANDOVER_DASHBOARD_DEFAULT_DAYS;
    const dashboard = await getOmHandoverDashboard({ daysAhead });
    res.json(dashboard);
  } catch (err) {
    console.error("[OmHandover] Failed to load dashboard:", err);
    res.status(500).json({ error: "Failed to load O&M handover dashboard" });
  }
});

// ===================== UPSERT =====================

router.post("/api/projects/:projectId/om-handover", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.projectId);
    if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

    // Reject status=completed via upsert — must go through mark-complete.
    if (req.body?.status === "completed") {
      return res.status(400).json({
        error: "use_mark_complete_endpoint",
        message: "Use POST /api/om-handovers/:id/mark-complete to mark complete. It records who signed off for audit.",
      });
    }

    const row = await upsertOmHandover({
      projectId,
      fields: { ...req.body, projectId } as any,
    });

    logAuditFromReq(req, {
      entityType: "om_handover",
      entityId: String(row.id),
      action: "om_handover.upserted",
      changesJson: { projectId, status: row.status, plannedHandoverDate: row.plannedHandoverDate },
    });

    res.status(201).json({ handover: row, readiness: computeOmHandoverReadiness(row) });
  } catch (err) {
    console.error("[OmHandover] Failed to upsert:", err);
    res.status(500).json({ error: "Failed to save O&M handover" });
  }
});

// ===================== UPDATE =====================

router.patch("/api/om-handovers/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    if (req.body?.status === "completed") {
      return res.status(400).json({
        error: "use_mark_complete_endpoint",
        message: "Use POST /api/om-handovers/:id/mark-complete to mark complete. It records who signed off for audit.",
      });
    }

    // We do an upsert via service — find the project_id from the row.
    const { omHandovers } = await import("@shared/schema");
    const { db } = await import("../db");
    const { eq, and, isNull } = await import("drizzle-orm");

    const [existing] = await db
      .select()
      .from(omHandovers)
      .where(and(eq(omHandovers.id, id), isNull(omHandovers.deletedAt)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "om_handover_not_found" });

    const [updated] = await db
      .update(omHandovers)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(omHandovers.id, id))
      .returning();

    logAuditFromReq(req, {
      entityType: "om_handover",
      entityId: String(id),
      action: "om_handover.updated",
      changesJson: { updates: req.body },
    });

    res.json({ handover: updated, readiness: computeOmHandoverReadiness(updated as any) });
  } catch (err) {
    console.error("[OmHandover] Failed to update:", err);
    res.status(500).json({ error: "Failed to update O&M handover" });
  }
});

// ===================== MARK COMPLETE =====================

router.post(
  "/api/om-handovers/:id/mark-complete",
  requireAuth,
  requireOmHandoverCompleteRole,
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const user = (req as any).user;
      const updated = await markOmHandoverComplete({
        id,
        userId: user?.id ?? null,
        userRole: user?.role ?? null,
      });
      if (!updated) return res.status(404).json({ error: "om_handover_not_found" });

      logAuditFromReq(req, {
        entityType: "om_handover",
        entityId: String(id),
        action: "om_handover.marked_complete",
        changesJson: {
          status: updated.status,
          actualHandoverDate: updated.actualHandoverDate,
          markedCompleteByUserId: updated.markedCompleteByUserId,
          markedCompleteByRole: updated.markedCompleteByRole,
        },
      });

      res.json({ handover: updated, readiness: computeOmHandoverReadiness(updated) });
    } catch (err) {
      console.error("[OmHandover] Failed to mark complete:", err);
      res.status(500).json({ error: "Failed to mark O&M handover complete" });
    }
  },
);

// ===================== ACCEPT =====================
//
// Receiving-party acceptance per Six Rule #6 ("handovers are signed,
// not assumed"). Distinct from mark-complete: this records the receiving
// PM/operator confirming the O&M pack is good, populating
// acceptedByUserId + acceptedAt. The mark-complete endpoint then records
// the construction-side sign-off.
//
// Any authenticated user can accept; the schema enforces the identity
// of who accepted via the JWT-resolved user. The audit log captures
// the actor + role + timestamp.

router.post(
  "/api/om-handovers/:id/accept",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const notes = typeof req.body?.notes === "string" ? req.body.notes : null;

      const updated = await acceptOmHandover({
        id,
        userId: Number(user.id),
        userRole: user?.role ?? null,
        notes,
      });
      if (!updated) return res.status(404).json({ error: "om_handover_not_found" });

      logAuditFromReq(req, {
        entityType: "om_handover",
        entityId: String(id),
        action: "om_handover.accepted",
        changesJson: {
          acceptedByUserId: updated.acceptedByUserId,
          acceptedAt: updated.acceptedAt,
        },
      });

      res.json({ handover: updated, readiness: computeOmHandoverReadiness(updated as any) });
    } catch (err) {
      console.error("[OmHandover] Failed to accept:", err);
      res.status(500).json({ error: "Failed to accept O&M handover" });
    }
  },
);

export function registerOmHandoverRoutes(app: Express) {
  app.use(router);
}

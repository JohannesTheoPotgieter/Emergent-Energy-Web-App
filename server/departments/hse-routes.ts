/**
 * C3: HSE module routes
 * CRUD for hse_incidents and corrective_actions
 *
 * B3 (audit closeout) — Create vs Approve permission split:
 *   - Any authenticated user can CREATE an incident or corrective action.
 *     This is intentional: site workers, PMs, and engineers should all
 *     be able to log safety events the moment they happen.
 *   - Only HSE-approved roles (HSE_MANAGER, COO_ADMIN, CEO_ADMIN per the
 *     hse.approve_roles entry in shared/schema/users.ts) can CHANGE THE
 *     STATUS of an existing record (e.g. open -> investigating -> closed,
 *     or a corrective action -> completed -> verified).
 *   - All other field edits (description, location, root_cause, immediate
 *     actions, evidence link, assignee, due date, etc.) remain open to
 *     any authenticated user, so anyone can continue to enrich a record
 *     with context after it is created.
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { evaluatePermissionForRequest } from "../permission-middleware";
import { db } from "../db";
import { parseBody } from "../lib/input-validation";
import { eq, desc, and, isNull } from "drizzle-orm";
import { DEFAULT_QUERY_LIMIT } from "../lib/safe-query";
import { hseIncidents, correctiveActions, insertHseIncidentSchema, insertCorrectiveActionSchema } from "@shared/schema/hse";

const router = Router();

/**
 * Returns true if the incoming PATCH body attempts to change `status`
 * from the current persisted value. Approvers are still allowed to send
 * a status that matches the current one (it's a no-op) without being
 * gated.
 */
async function approveGateForIncidentStatus(req: Request, res: Response, incidentId: number): Promise<boolean> {
  if (!("status" in req.body)) return true;
  const newStatus = req.body.status;
  const [current] = await db
    .select({ status: hseIncidents.status })
    .from(hseIncidents)
    .where(eq(hseIncidents.id, incidentId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "hse_incident_not_found" });
    return false;
  }
  if (current.status === newStatus) return true;

  // Prompt 0.5 follow-up: use the specific hse_incidents entity so the
  // role matrix (CONSTRUCTION_MANAGER approve permission added in commit
  // 260cee8) actually takes effect at request time. Previously this
  // gated on the broader "hse" entity, leaving hse_incidents.approve_roles
  // dead.
  const approval = await evaluatePermissionForRequest(req, "hse_incidents", "approve");
  if (!approval.allowed) {
    res.status(403).json({
      error: "forbidden",
      entity: "hse_incidents",
      action: "approve",
      reason: "Only HSE Manager, Construction Manager, COO, or CEO can change an HSE incident's status.",
      currentStatus: current.status,
      attemptedStatus: newStatus,
    });
    return false;
  }
  return true;
}

async function approveGateForCorrectiveActionStatus(req: Request, res: Response, actionId: number): Promise<boolean> {
  if (!("status" in req.body)) return true;
  const newStatus = req.body.status;
  const [current] = await db
    .select({ status: correctiveActions.status })
    .from(correctiveActions)
    .where(eq(correctiveActions.id, actionId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "corrective_action_not_found" });
    return false;
  }
  if (current.status === newStatus) return true;

  const approval = await evaluatePermissionForRequest(req, "hse", "approve");
  if (!approval.allowed) {
    res.status(403).json({
      error: "forbidden",
      entity: "hse",
      action: "approve",
      reason: "Only HSE Manager, COO, or CEO can change a corrective action's status.",
      currentStatus: current.status,
      attemptedStatus: newStatus,
    });
    return false;
  }
  return true;
}

// ===================== HSE INCIDENTS =====================

router.get("/api/hse/incidents", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const conditions = [isNull(hseIncidents.deletedAt)];
    if (projectId) conditions.push(eq(hseIncidents.projectId, projectId));

    const rows = await db
      .select()
      .from(hseIncidents)
      .where(and(...conditions))
      .orderBy(desc(hseIncidents.incidentDate))
      .limit(DEFAULT_QUERY_LIMIT);

    res.json(rows);
  } catch (err) {
    console.error("[HSE] Failed to fetch incidents:", err);
    res.status(500).json({ error: "Failed to fetch HSE incidents" });
  }
});

router.post("/api/hse/incidents", requireAuth, async (req: Request, res: Response) => {
  try {
    const [parsed, validationError] = parseBody(req.body, insertHseIncidentSchema);
    if (validationError) return res.status(400).json(validationError);
    const [row] = await db.insert(hseIncidents).values(parsed).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[HSE] Failed to create incident:", err);
    res.status(500).json({ error: "Failed to create HSE incident" });
  }
});

router.patch("/api/hse/incidents/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    // B3: gate status transitions behind hse.approve permission.
    const allowed = await approveGateForIncidentStatus(req, res, id);
    if (!allowed) return;

    const [row] = await db
      .update(hseIncidents)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(hseIncidents.id, id))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[HSE] Failed to update incident:", err);
    res.status(500).json({ error: "Failed to update HSE incident" });
  }
});

router.delete("/api/hse/incidents/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(hseIncidents)
      .set({ deletedAt: new Date() })
      .where(eq(hseIncidents.id, Number(req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "HSE incident not found" });
    res.json(row);
  } catch (err) {
    console.error("[HSE] Failed to delete incident:", err);
    res.status(500).json({ error: "Failed to delete HSE incident" });
  }
});

// ===================== CORRECTIVE ACTIONS =====================

router.get("/api/hse/corrective-actions", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const sourceType = req.query.sourceType as string | undefined;
    const conditions = [isNull(correctiveActions.deletedAt)];
    if (projectId) conditions.push(eq(correctiveActions.projectId, projectId));
    if (sourceType) conditions.push(eq(correctiveActions.sourceType, sourceType));

    const rows = await db
      .select()
      .from(correctiveActions)
      .where(and(...conditions))
      .orderBy(desc(correctiveActions.createdAt))
      .limit(DEFAULT_QUERY_LIMIT);

    res.json(rows);
  } catch (err) {
    console.error("[HSE] Failed to fetch corrective actions:", err);
    res.status(500).json({ error: "Failed to fetch corrective actions" });
  }
});

router.post("/api/hse/corrective-actions", requireAuth, async (req: Request, res: Response) => {
  try {
    const [parsed, validationError] = parseBody(req.body, insertCorrectiveActionSchema);
    if (validationError) return res.status(400).json(validationError);
    const [row] = await db.insert(correctiveActions).values(parsed).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[HSE] Failed to create corrective action:", err);
    res.status(500).json({ error: "Failed to create corrective action" });
  }
});

router.patch("/api/hse/corrective-actions/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    // B3: gate status transitions behind hse.approve permission.
    const allowed = await approveGateForCorrectiveActionStatus(req, res, id);
    if (!allowed) return;

    const [row] = await db
      .update(correctiveActions)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(correctiveActions.id, id))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[HSE] Failed to update corrective action:", err);
    res.status(500).json({ error: "Failed to update corrective action" });
  }
});

router.delete("/api/hse/corrective-actions/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(correctiveActions)
      .set({ deletedAt: new Date() })
      .where(eq(correctiveActions.id, Number(req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Corrective action not found" });
    res.json(row);
  } catch (err) {
    console.error("[HSE] Failed to delete corrective action:", err);
    res.status(500).json({ error: "Failed to delete corrective action" });
  }
});

export function registerHseRoutes(app: Express) {
  app.use(router);
}

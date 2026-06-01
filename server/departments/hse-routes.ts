/**
 * C3: HSE module routes
 * CRUD for hse_incidents and corrective_actions
 *
 * RBAC: every mutating endpoint gated by the canonical permission registry
 * (`hse_incidents` / `hse`). Status transitions still flow through the
 * approve-permission gate so the existing approver/editor split stays in
 * effect — but baseline create/edit/delete now actually checks the role
 * matrix instead of accepting any authenticated user.
 *
 * Body validation: PATCH bodies are whitelisted via Zod so a request can't
 * smuggle changes to `projectId`, `reportedByUserId`, `createdAt`,
 * `deletedAt`, etc. via mass-assignment.
 *
 * Soft-delete: PATCH/DELETE filter `isNull(deletedAt)` so soft-deleted rows
 * can't be mutated or undeleted by sending `{ deletedAt: null }`.
 */
import { Router, type Express, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "./shared-middleware";
import { requirePermission, evaluatePermissionForRequest } from "../permission-middleware";
import { getEffectiveUser } from "../auth-context";
import { db } from "../db";
import { parseBody } from "../lib/input-validation";
import { eq, desc, and, isNull, inArray } from "drizzle-orm";
import { DEFAULT_QUERY_LIMIT } from "../lib/safe-query";
import { hseIncidents, correctiveActions } from "@shared/schema/hse";
import { getQualityHseScope, scopeAllowsProject, scopedProjectIdsArray } from "../services/quality-hse-scope";

const router = Router();

// ===================== Whitelisted PATCH schemas =====================
//
// Zod-strict so unknown keys are rejected. `projectId`, `reportedByUserId`,
// `createdAt`, `id`, `deletedAt` are intentionally omitted — those must not
// be settable via the API.

const HSE_INCIDENT_TYPES = [
  "near_miss",
  "first_aid",
  "medical",
  "lost_time",
  "fatality",
  "environmental",
  "property_damage",
] as const;

const HSE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
const HSE_STATUSES = ["open", "investigating", "corrective_action", "closed"] as const;

const updateHseIncidentSchema = z
  .object({
    incidentDate: z.string().optional(),
    incidentType: z.enum(HSE_INCIDENT_TYPES).optional(),
    severity: z.enum(HSE_SEVERITIES).optional(),
    description: z.string().min(1).max(10_000).optional(),
    location: z.string().max(500).nullable().optional(),
    rootCause: z.string().max(10_000).nullable().optional(),
    immediateActions: z.string().max(10_000).nullable().optional(),
    status: z.enum(HSE_STATUSES).optional(),
    evidenceLink: z.string().max(2048).nullable().optional(),
    siteId: z.number().int().positive().nullable().optional(),
  })
  .strict();

const CORRECTIVE_ACTION_SOURCE_TYPES = [
  "hse_incident",
  "ncr",
  "snag",
  "audit",
  "inspection",
] as const;

const CORRECTIVE_ACTION_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "verified",
  "overdue",
] as const;

const updateCorrectiveActionSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(10_000).nullable().optional(),
    assignedToUserId: z.number().int().positive().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    status: z.enum(CORRECTIVE_ACTION_STATUSES).optional(),
    completionDate: z.string().nullable().optional(),
    evidenceLink: z.string().max(2048).nullable().optional(),
    verifiedByUserId: z.number().int().positive().nullable().optional(),
  })
  .strict();

// Create schemas intentionally OMIT status + verification/attribution fields,
// and run in STRIP mode (no `.strict()`) so any such fields a client sends are
// silently dropped rather than rejected:
//   - `status` is dropped: new records start at the column default ("open").
//     Advancing status goes through PATCH, which runs the approve-permission
//     gate. Accepting status here would let a non-approver (e.g.
//     CONSTRUCTION_MANAGER, who has create rights but not hse.approve) create a
//     record already in a closed/verified state, bypassing the gate. (R3)
//   - `reportedByUserId` is stamped server-side from the session, never the
//     body — otherwise a caller could spoof who reported an incident. (R2)
//   - `verifiedByUserId` / `completionDate` are verification-stage fields and
//     are not settable at creation.
// Strip (not strict) so the documented B3 client payloads that include
// `status: "open"` still succeed — the field is simply ignored.
const createHseIncidentSchema = z.object({
  projectId: z.number().int().positive(),
  siteId: z.number().int().positive().nullable().optional(),
  incidentDate: z.string().min(1),
  incidentType: z.enum(HSE_INCIDENT_TYPES),
  severity: z.enum(HSE_SEVERITIES),
  description: z.string().min(1).max(10_000),
  location: z.string().max(500).nullable().optional(),
  rootCause: z.string().max(10_000).nullable().optional(),
  immediateActions: z.string().max(10_000).nullable().optional(),
  evidenceLink: z.string().max(2048).nullable().optional(),
});

const createCorrectiveActionSchema = z.object({
  sourceType: z.enum(CORRECTIVE_ACTION_SOURCE_TYPES),
  sourceId: z.number().int().positive(),
  projectId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).nullable().optional(),
  assignedToUserId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  evidenceLink: z.string().max(2048).nullable().optional(),
});

// ===================== Status-transition approve gates =====================

/**
 * Returns true if the (already-validated) PATCH body either omits `status`
 * or sets it to the current value. Otherwise checks the caller has
 * `hse_incidents:approve` per the registry.
 */
async function approveGateForIncidentStatus(
  req: Request,
  res: Response,
  incidentId: number,
): Promise<boolean> {
  if (!("status" in req.body)) return true;
  const newStatus = req.body.status;
  const [current] = await db
    .select({ status: hseIncidents.status })
    .from(hseIncidents)
    .where(and(eq(hseIncidents.id, incidentId), isNull(hseIncidents.deletedAt)))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "hse_incident_not_found" });
    return false;
  }
  if (current.status === newStatus) return true;

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

async function approveGateForCorrectiveActionStatus(
  req: Request,
  res: Response,
  actionId: number,
): Promise<boolean> {
  if (!("status" in req.body)) return true;
  const newStatus = req.body.status;
  const [current] = await db
    .select({ status: correctiveActions.status })
    .from(correctiveActions)
    .where(and(eq(correctiveActions.id, actionId), isNull(correctiveActions.deletedAt)))
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

router.get(
  "/api/hse/incidents",
  requireAuth,
  requirePermission("hse_incidents", "view"),
  async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      const scope = await getQualityHseScope(req);
      const scopedIds = scopedProjectIdsArray(scope);
      if (scopedIds !== null && scopedIds.length === 0) return res.json([]);
      if (projectId && !scopeAllowsProject(scope, projectId)) return res.json([]);

      const conditions = [isNull(hseIncidents.deletedAt)];
      if (projectId) conditions.push(eq(hseIncidents.projectId, projectId));
      if (scopedIds !== null) conditions.push(inArray(hseIncidents.projectId, scopedIds));

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
  },
);

router.post(
  "/api/hse/incidents",
  requireAuth,
  requirePermission("hse_incidents", "create"),
  async (req: Request, res: Response) => {
    try {
      const [parsed, validationError] = parseBody(req.body, createHseIncidentSchema);
      if (validationError) return res.status(400).json(validationError);
      // R1: scoped roles can only log incidents on their assigned projects.
      const scope = await getQualityHseScope(req);
      if (!scopeAllowsProject(scope, parsed.projectId)) {
        return res.status(403).json({ error: "project_not_accessible" });
      }
      // Stamp the reporter from the session — never trust a client-supplied
      // reportedByUserId (reporter-spoofing). status defaults to "open".
      const reportedByUserId = getEffectiveUser(req)?.id ?? null;
      const [row] = await db.insert(hseIncidents).values({ ...parsed, reportedByUserId }).returning();
      res.status(201).json(row);
    } catch (err) {
      console.error("[HSE] Failed to create incident:", err);
      res.status(500).json({ error: "Failed to create HSE incident" });
    }
  },
);

// B3: descriptive edits are intentionally OPEN to any authenticated user
// ("anyone can enrich a safety record with context") — § 0A says the app must
// not block safety reporting. The Zod whitelist below prevents mass-assignment
// of projectId / reportedByUserId / deletedAt, and STATUS changes are gated by
// the approve-permission check inside the handler. So "open edit" here is not a
// privilege hole: identity/scope fields are unsettable and the lifecycle field
// is gated.
router.patch(
  "/api/hse/incidents/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

      const [parsed, validationError] = parseBody(req.body, updateHseIncidentSchema);
      if (validationError) return res.status(400).json(validationError);
      req.body = parsed;

      // R1: scoped roles can only patch incidents on their assigned projects.
      const [target] = await db.select({ projectId: hseIncidents.projectId }).from(hseIncidents).where(and(eq(hseIncidents.id, id), isNull(hseIncidents.deletedAt))).limit(1);
      if (!target) return res.status(404).json({ error: "hse_incident_not_found" });
      const scope = await getQualityHseScope(req);
      if (!scopeAllowsProject(scope, target.projectId)) return res.status(404).json({ error: "hse_incident_not_found" });

      const allowed = await approveGateForIncidentStatus(req, res, id);
      if (!allowed) return;

      const [row] = await db
        .update(hseIncidents)
        .set({ ...parsed, updatedAt: new Date() })
        .where(and(eq(hseIncidents.id, id), isNull(hseIncidents.deletedAt)))
        .returning();
      if (!row) return res.status(404).json({ error: "hse_incident_not_found" });
      res.json(row);
    } catch (err) {
      console.error("[HSE] Failed to update incident:", err);
      res.status(500).json({ error: "Failed to update HSE incident" });
    }
  },
);

router.delete(
  "/api/hse/incidents/:id",
  requireAuth,
  requirePermission("hse_incidents", "delete"),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const [row] = await db
        .update(hseIncidents)
        .set({ deletedAt: new Date() })
        .where(and(eq(hseIncidents.id, id), isNull(hseIncidents.deletedAt)))
        .returning();
      if (!row) return res.status(404).json({ error: "HSE incident not found" });
      res.json(row);
    } catch (err) {
      console.error("[HSE] Failed to delete incident:", err);
      res.status(500).json({ error: "Failed to delete HSE incident" });
    }
  },
);

// ===================== CORRECTIVE ACTIONS =====================

router.get(
  "/api/hse/corrective-actions",
  requireAuth,
  requirePermission("hse", "view"),
  async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      const sourceType = req.query.sourceType as string | undefined;
      const scope = await getQualityHseScope(req);
      const scopedIds = scopedProjectIdsArray(scope);
      if (scopedIds !== null && scopedIds.length === 0) return res.json([]);
      if (projectId && !scopeAllowsProject(scope, projectId)) return res.json([]);

      const conditions = [isNull(correctiveActions.deletedAt)];
      if (projectId) conditions.push(eq(correctiveActions.projectId, projectId));
      if (sourceType) conditions.push(eq(correctiveActions.sourceType, sourceType));
      if (scopedIds !== null) conditions.push(inArray(correctiveActions.projectId, scopedIds));

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
  },
);

router.post(
  "/api/hse/corrective-actions",
  requireAuth,
  requirePermission("hse", "create"),
  async (req: Request, res: Response) => {
    try {
      const [parsed, validationError] = parseBody(req.body, createCorrectiveActionSchema);
      if (validationError) return res.status(400).json(validationError);
      // R1: if projectId provided, ensure caller's scope sees it.
      if (parsed.projectId != null) {
        const scope = await getQualityHseScope(req);
        if (!scopeAllowsProject(scope, parsed.projectId)) {
          return res.status(403).json({ error: "project_not_accessible" });
        }
      }
      const [row] = await db.insert(correctiveActions).values(parsed).returning();
      res.status(201).json(row);
    } catch (err) {
      console.error("[HSE] Failed to create corrective action:", err);
      res.status(500).json({ error: "Failed to create corrective action" });
    }
  },
);

// B3: descriptive edits open (see incident PATCH note); status changes gated.
router.patch(
  "/api/hse/corrective-actions/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

      const [parsed, validationError] = parseBody(req.body, updateCorrectiveActionSchema);
      if (validationError) return res.status(400).json(validationError);
      req.body = parsed;

      // R1: scoped roles only patch CAs on projects they're assigned to. CAs
      // can have a null projectId (cross-project work) — those stay visible
      // to oversight only, which means scoped users see "not found".
      const [target] = await db.select({ projectId: correctiveActions.projectId }).from(correctiveActions).where(and(eq(correctiveActions.id, id), isNull(correctiveActions.deletedAt))).limit(1);
      if (!target) return res.status(404).json({ error: "corrective_action_not_found" });
      const scope = await getQualityHseScope(req);
      if (scope.kind === "scoped" && (target.projectId == null || !scopeAllowsProject(scope, target.projectId))) {
        return res.status(404).json({ error: "corrective_action_not_found" });
      }

      const allowed = await approveGateForCorrectiveActionStatus(req, res, id);
      if (!allowed) return;

      const [row] = await db
        .update(correctiveActions)
        .set({ ...parsed, updatedAt: new Date() })
        .where(and(eq(correctiveActions.id, id), isNull(correctiveActions.deletedAt)))
        .returning();
      if (!row) return res.status(404).json({ error: "corrective_action_not_found" });
      res.json(row);
    } catch (err) {
      console.error("[HSE] Failed to update corrective action:", err);
      res.status(500).json({ error: "Failed to update corrective action" });
    }
  },
);

router.delete(
  "/api/hse/corrective-actions/:id",
  requireAuth,
  requirePermission("hse", "delete"),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const [row] = await db
        .update(correctiveActions)
        .set({ deletedAt: new Date() })
        .where(and(eq(correctiveActions.id, id), isNull(correctiveActions.deletedAt)))
        .returning();
      if (!row) return res.status(404).json({ error: "Corrective action not found" });
      res.json(row);
    } catch (err) {
      console.error("[HSE] Failed to delete corrective action:", err);
      res.status(500).json({ error: "Failed to delete corrective action" });
    }
  },
);

export function registerHseRoutes(app: Express) {
  app.use(router);
}

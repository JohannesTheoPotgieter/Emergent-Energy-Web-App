// ============================================================
// STAGE LIFECYCLE ROUTES — API endpoints for gate-driven lifecycle
// ============================================================

import type { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import {
  initializeProjectStages,
  hydrateStageChecklist,
  transitionStageStatus,
  updateRequirementStatus,
  getProjectStageDashboard,
  addEvidence,
  getStageEvidence,
  getStageDecisions,
  advanceToStage,
  getStageGateHistory,
  computeCurrentStageGateReadiness,
  placeProjectOnHold,
  resumeProjectFromHold,
  markProjectDone,
} from "./services/stage-lifecycle-service";
import {
  createException,
  approveException,
  rejectException,
  closeException,
  getProjectExceptions,
} from "./services/stage-exception-service";
import {
  createDependency,
  resolveDependency,
  escalateDependency,
  getProjectDependencies,
} from "./services/stage-dependency-service";
import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  projectStageInstances,
  projectStageRequirements,
  projectStageDecisions,
  STAGE_STATUSES,
  type StageStatus,
} from "@shared/schema";
import { parseIntParam } from "./lib/req-params";
import { findEntityRegistry } from "@shared/permissions/registry";
import { evaluateStageAdvanceDecision } from "./lib/stage-advance-override-eval";
import { normalizeWithLegacy } from "@shared/utils/status-normalization";

// Bulk stage advance is a bypass. Protected EPC rules restrict it to
// COO_ADMIN with a written reason, regardless of broader stage_gate edit rights.
const STAGE_ADVANCE_DEFAULT_ROLES: ReadonlySet<string> = new Set([
  "COO_ADMIN",
]);
const STAGE_ADVANCE_OVERRIDE_ROLES: ReadonlySet<string> = new Set(
  findEntityRegistry("stage_gate")?.edit_roles ?? [],
);

function getUser(req: Request): { id: number; role: string } {
  const user = (req as any).user;
  return { id: user?.id, role: user?.role || "unknown" };
}

function p(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] : (v ?? '');
}

function parseProjectId(req: Request, res: Response): number | null {
  const id = parseIntParam(req.params.projectId);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid projectId" });
    return null;
  }
  return id;
}

export function registerStageLifecycleRoutes(app: Express): void {

  // ── Stage Instances ─────────────────────────────────────────

  // GET /api/projects/:projectId/stages — Full dashboard
  app.get(
    "/api/projects/:projectId/stages",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const dashboard = await getProjectStageDashboard(projectId);
        res.json(dashboard);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] get stages error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // GET /api/projects/:projectId/stages/:stageCode — Single stage detail
  app.get(
    "/api/projects/:projectId/stages/:stageCode",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stageCode = p(req.params.stageCode);

        const [instance] = await db
          .select()
          .from(projectStageInstances)
          .where(
            eq(projectStageInstances.projectId, projectId),
          );

        const matching = await db
          .select()
          .from(projectStageInstances)
          .where(eq(projectStageInstances.projectId, projectId));

        const stage = matching.find((s: any) => s.stageCode === stageCode);
        if (!stage) return res.status(404).json({ error: "Stage not found" });

        // Task #84: Run the auto-evaluator before reading the requirements
        // so the badges and effective statuses reflect the latest app data.
        // Hold/Done phases are skipped inside the service (no-op for terminal
        // phases). Failures here must never block the page load.
        try {
          const { evaluateAndPersistGateAuto } = await import(
            "./services/gate-auto-evaluator-service"
          );
          await evaluateAndPersistGateAuto(projectId, stageCode);
        } catch (err) {
          console.warn("[stage-lifecycle] auto-evaluator failed (non-fatal):", err);
        }

        const requirements = await db
          .select()
          .from(projectStageRequirements)
          .where(eq(projectStageRequirements.stageInstanceId, stage.id));

        const evidence = await getStageEvidence(projectId, stageCode);
        const exceptions = await getProjectExceptions(projectId, stageCode);
        const dependencies = await getProjectDependencies(projectId, stageCode);

        res.json({ stage, requirements, evidence, exceptions, dependencies });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] get stage detail error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stages/initialize
  app.post(
    "/api/projects/:projectId/stages/initialize",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stages = await initializeProjectStages(projectId);
        res.status(201).json({ stages });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] initialize error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/stages/:stageCode/status
  app.patch(
    "/api/projects/:projectId/stages/:stageCode/status",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const stageCode = p(req.params.stageCode);
        const { newStatus, reason, isOverride } = req.body;

        if (!newStatus) return res.status(400).json({ error: "newStatus is required" });
        const normalizedStatus = normalizeWithLegacy(String(newStatus));
        if (!(STAGE_STATUSES as readonly string[]).includes(normalizedStatus)) {
          return res.status(400).json({ error: `Invalid stage status: ${newStatus}` });
        }

        const stage = await transitionStageStatus({
          projectId,
          stageCode,
          newStatus: normalizedStatus as StageStatus,
          actorUserId: user.id,
          actorRole: user.role,
          reason,
          isOverride,
        });
        res.json({ stage });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] transition error:", msg);
        res.status(400).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stages/advance-to/:targetStageCode
  app.post(
    "/api/projects/:projectId/stages/advance-to/:targetStageCode",
    jwtAuth,
    requireAuth,
    requirePermission("stage_gate", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const decision = evaluateStageAdvanceDecision({
          userRole: user.role,
          rawReason: req.body?.reason,
          defaultRoles: STAGE_ADVANCE_DEFAULT_ROLES,
          overrideRoles: STAGE_ADVANCE_OVERRIDE_ROLES,
        });
        if (decision.kind === "reject") {
          return res.status(decision.status).json(decision.body);
        }
        const overrideApplied = decision.kind === "advance_with_override";
        const reason = overrideApplied
          ? `[OVERRIDE BY ${user.role}] ${decision.reason}`
          : decision.reason ?? undefined;

        const targetStageCode = p(req.params.targetStageCode);

        // Terminal stages must go through their dedicated endpoints so the
        // Hold/Done contract (preserve previous_phase, flip project_status,
        // log audit decision) is honoured. The generic advance-to path is
        // for sequential stages only.
        if (targetStageCode === "S_HOLD" || targetStageCode === "S_DONE") {
          return res.status(400).json({
            error: `Use POST /api/projects/${projectId}/stages/${
              targetStageCode === "S_HOLD" ? "hold" : "done"
            } for terminal-branch transitions`,
          });
        }

        const result = await advanceToStage({
          projectId,
          targetStageCode: targetStageCode as any,
          actorUserId: user.id,
          actorRole: user.role,
          reason,
        });
        res.json({
          ...result,
          ...(overrideApplied
            ? { override_applied: true, override_reason: decision.reason }
            : {}),
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] advance-to error:", msg);
        res.status(400).json({ error: msg });
      }
    },
  );

  // ── Terminal-branch transitions (Task #81) ──────────────────
  // Three dedicated endpoints implement the canonical 12-phase
  // model's terminal contract (10 sequential + Hold + Done).
  // Routing through the service handlers keeps three invariants:
  //   - Hold preserves current_stage_code on previous_phase so
  //     resume can drop the project back to where it left off.
  //   - Resume only succeeds when the project is on S_HOLD AND
  //     has a previous_phase.
  //   - Done is permanent (no resume) and flips status to closed.

  // POST /api/projects/:projectId/stages/hold
  app.post(
    "/api/projects/:projectId/stages/hold",
    jwtAuth,
    requireAuth,
    requirePermission("stage_gate", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
        if (!ADMIN_ROLES.includes(user.role)) {
          return res.status(403).json({ error: "Only admin roles can place a project on hold" });
        }
        const {
          reason,
          ownerUserId,
          reviewDate,
          dependency,
          decisionOwnerUserId,
          evidenceLink,
          overrideReason,
        } = req.body || {};

        // § 4A six-field rule. Capture the metadata; the service computes
        // which fields were missing so the response can surface them to
        // the UI. When fields are missing the caller must provide an
        // overrideReason per the § 0A override pattern; otherwise the
        // service still records the row but flags the gaps.
        const result = await placeProjectOnHold({
          projectId,
          actorUserId: user.id,
          reason,
          metadata: {
            ownerUserId: typeof ownerUserId === "number" ? ownerUserId : null,
            reviewDate: typeof reviewDate === "string" ? reviewDate : null,
            dependency: typeof dependency === "string" ? dependency : null,
            decisionOwnerUserId: typeof decisionOwnerUserId === "number" ? decisionOwnerUserId : null,
            evidenceLink: typeof evidenceLink === "string" ? evidenceLink : null,
            overrideReason: typeof overrideReason === "string" ? overrideReason : null,
            actorRole: user.role ?? null,
          },
        });

        // Soft enforcement: when one or more of the six fields is missing
        // AND no overrideReason was supplied, return the gaps so the UI
        // can prompt. The hold is still recorded (override principle —
        // the app records and surfaces, it does not block).
        if (result.missingFields.length > 0 && !overrideReason) {
          return res.status(200).json({
            ...result,
            warning: "hold_metadata_incomplete",
            warningMessage:
              `Hold recorded, but the following six-field metadata is missing: ` +
              result.missingFields.join(", ") +
              `. Re-submit with overrideReason to confirm the override.`,
          });
        }

        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] hold error:", msg);
        res.status(400).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stages/resume
  app.post(
    "/api/projects/:projectId/stages/resume",
    jwtAuth,
    requireAuth,
    requirePermission("stage_gate", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
        if (!ADMIN_ROLES.includes(user.role)) {
          return res.status(403).json({ error: "Only admin roles can resume a project" });
        }
        const { reason } = req.body || {};
        const result = await resumeProjectFromHold({
          projectId,
          actorUserId: user.id,
          reason,
        });
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] resume error:", msg);
        res.status(400).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stages/done
  app.post(
    "/api/projects/:projectId/stages/done",
    jwtAuth,
    requireAuth,
    requirePermission("stage_gate", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
        if (!ADMIN_ROLES.includes(user.role)) {
          return res.status(403).json({ error: "Only admin roles can mark a project done" });
        }
        const { reason } = req.body || {};
        const result = await markProjectDone({
          projectId,
          actorUserId: user.id,
          reason,
        });
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] done error:", msg);
        res.status(400).json({ error: msg });
      }
    },
  );

  // ── Requirements ────────────────────────────────────────────

  // GET /api/projects/:projectId/stages/:stageCode/requirements
  app.get(
    "/api/projects/:projectId/stages/:stageCode/requirements",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stageCode = p(req.params.stageCode);

        const stages = await db
          .select()
          .from(projectStageInstances)
          .where(eq(projectStageInstances.projectId, projectId));

        const stage = stages.find((s: any) => s.stageCode === stageCode);
        if (!stage) return res.status(404).json({ error: "Stage not found" });

        const requirements = await db
          .select()
          .from(projectStageRequirements)
          .where(eq(projectStageRequirements.stageInstanceId, stage.id));

        res.json({ requirements });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stages/:stageCode/requirements/hydrate
  app.post(
    "/api/projects/:projectId/stages/:stageCode/requirements/hydrate",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stageCode = p(req.params.stageCode);
        const hydrateResult = await hydrateStageChecklist(projectId, stageCode);
        res.status(201).json(hydrateResult);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[stage-lifecycle] hydrate error:", msg);
        const isNotFound = msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("not found");
        res.status(isNotFound ? 404 : 500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/requirements/:requirementId
  app.patch(
    "/api/projects/:projectId/requirements/:requirementId",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const requirementId = parseIntParam(req.params.requirementId);
        if (Number.isNaN(requirementId)) return res.status(400).json({ error: "Invalid requirementId" });
        const user = getUser(req);
        const { status, evidenceUrl, notes, contributors, reopenReason } = req.body;

        // Support updating contributors without status change
        if (contributors !== undefined && !status) {
          const { projectStageRequirements: psr } = await import("@shared/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          await db.update(psr).set({ contributors, updatedAt: new Date() }).where(eqOp(psr.id, requirementId));
          const [updated] = await db.select().from(psr).where(eqOp(psr.id, requirementId));
          return res.json({ requirement: updated });
        }

        if (!status) return res.status(400).json({ error: "status is required" });

        const result = await updateRequirementStatus({
          requirementId,
          status,
          actorUserId: user.id,
          actorRole: user.role,
          evidenceUrl,
          notes,
          reopenReason,
        });
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: msg });
      }
    },
  );

  // ── Evidence ────────────────────────────────────────────────

  // POST /api/projects/:projectId/stages/:stageCode/evidence
  app.post(
    "/api/projects/:projectId/stages/:stageCode/evidence",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const stageCode = p(req.params.stageCode);
        const { title, fileUrl, evidenceType, notes } = req.body;

        if (!title || !fileUrl) return res.status(400).json({ error: "title and fileUrl required" });

        const evidence = await addEvidence({
          projectId,
          stageCode,
          title,
          fileUrl,
          evidenceType,
          uploadedByUserId: user.id,
          notes,
        });
        res.status(201).json({ evidence });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // GET /api/projects/:projectId/stages/:stageCode/evidence
  app.get(
    "/api/projects/:projectId/stages/:stageCode/evidence",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stageCode = p(req.params.stageCode);
        const evidence = await getStageEvidence(projectId, stageCode);
        res.json({ evidence });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Exceptions ──────────────────────────────────────────────

  // GET /api/projects/:projectId/stage-exceptions
  app.get(
    "/api/projects/:projectId/stage-exceptions",
    jwtAuth,
    requireAuth,
    requirePermission("stage_exceptions", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stageCode = req.query.stageCode as string | undefined;
        const exceptions = await getProjectExceptions(projectId, stageCode);
        res.json({ exceptions });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stage-exceptions
  app.post(
    "/api/projects/:projectId/stage-exceptions",
    jwtAuth,
    requireAuth,
    requirePermission("stage_exceptions", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const { stageCode, requirementCode, reasonText, riskLevel, mitigationText, closeoutDueDate, downstreamBlockingStage } = req.body;

        if (!stageCode || !reasonText || !riskLevel) {
          return res.status(400).json({ error: "stageCode, reasonText, riskLevel required" });
        }

        const exception = await createException({
          projectId,
          stageCode,
          requirementCode,
          reasonText,
          riskLevel,
          mitigationText,
          ownerUserId: user.id,
          closeoutDueDate,
          downstreamBlockingStage,
        });
        res.status(201).json({ exception });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/stage-exceptions/:id/approve
  app.patch(
    "/api/projects/:projectId/stage-exceptions/:id/approve",
    jwtAuth,
    requireAuth,
    requirePermission("stage_exceptions", "edit"),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
        const user = getUser(req);
        const { conditions } = req.body;
        const exception = await approveException(id, user.id, conditions);
        res.json({ exception });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/stage-exceptions/:id/reject
  app.patch(
    "/api/projects/:projectId/stage-exceptions/:id/reject",
    jwtAuth,
    requireAuth,
    requirePermission("stage_exceptions", "edit"),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
        const user = getUser(req);
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: "reason required" });
        const exception = await rejectException(id, user.id, reason);
        res.json({ exception });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/stage-exceptions/:id/close
  app.patch(
    "/api/projects/:projectId/stage-exceptions/:id/close",
    jwtAuth,
    requireAuth,
    requirePermission("stage_exceptions", "edit"),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
        const user = getUser(req);
        const exception = await closeException(id, user.id);
        res.json({ exception });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: msg });
      }
    },
  );

  // ── Dependencies ────────────────────────────────────────────

  // GET /api/projects/:projectId/stage-dependencies
  app.get(
    "/api/projects/:projectId/stage-dependencies",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const stageCode = req.query.stageCode as string | undefined;
        const dependencies = await getProjectDependencies(projectId, stageCode);
        res.json({ dependencies });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stage-dependencies
  app.post(
    "/api/projects/:projectId/stage-dependencies",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const { stageCode, fromDepartment, fromUserId, toDepartment, toUserId, description, dueDate } = req.body;

        if (!stageCode || !fromDepartment || !toDepartment || !description) {
          return res.status(400).json({ error: "stageCode, fromDepartment, toDepartment, description required" });
        }

        const dependency = await createDependency({
          projectId,
          stageCode,
          fromDepartment,
          fromUserId,
          toDepartment,
          toUserId,
          description,
          dueDate,
        });
        res.status(201).json({ dependency });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/stage-dependencies/:id/resolve
  app.patch(
    "/api/projects/:projectId/stage-dependencies/:id/resolve",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
        const user = getUser(req);
        const dependency = await resolveDependency(id, user.id);
        res.json({ dependency });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: msg });
      }
    },
  );

  // PATCH /api/projects/:projectId/stage-dependencies/:id/escalate
  app.patch(
    "/api/projects/:projectId/stage-dependencies/:id/escalate",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
        const user = getUser(req);
        const { reason } = req.body;
        const dependency = await escalateDependency(id, user.id, reason);
        res.json({ dependency });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: msg });
      }
    },
  );

  // ── Decisions ───────────────────────────────────────────────

  // GET /api/projects/:projectId/stage-decisions
  app.get(
    "/api/projects/:projectId/stage-decisions",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const decisions = await getStageDecisions(projectId);
        res.json({ decisions });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // POST /api/projects/:projectId/stage-decisions
  app.post(
    "/api/projects/:projectId/stage-decisions",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const user = getUser(req);
        const { stageCode, decisionType, decisionSummary, rationale } = req.body;

        if (!stageCode || !decisionSummary) {
          return res.status(400).json({ error: "stageCode and decisionSummary required" });
        }

        const [decision] = await db.insert(projectStageDecisions).values({
          projectId,
          stageCode,
          decisionType: decisionType || "GATE_PASS",
          decisionSummary,
          decidedByUserId: user.id,
          decidedDate: new Date(),
          rationale: rationale || null,
        }).returning();
        res.status(201).json({ decision });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // Admin stage-definition and checklist-template endpoints are owned by
  // server/routes/stage-admin-routes.ts to avoid duplicate registrations.

  // ── B1: Stage Gate Evidence History (audit trail, not blocker) ──
  // Returns the per-transition evidence snapshots for a project so post-
  // mortems can see which gate requirements were captured (and which were
  // missing) at the moment of every transition.
  app.get(
    "/api/projects/:projectId/stage-gate-history",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        if (Number.isNaN(projectId)) {
          return res.status(400).json({ error: "Invalid projectId" });
        }
        const limitParam = parseInt(p(req.query.limit as any), 10);
        const limit = Number.isNaN(limitParam) ? 200 : Math.min(Math.max(limitParam, 1), 1000);
        const history = await getStageGateHistory(projectId, limit);
        res.json({ projectId, count: history.length, snapshots: history });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Task #84: Gate auto-evaluator endpoints ──────────────────
  // GET /api/projects/:projectId/stage-gates/:phase/auto
  // Run the auto-evaluator registry for a single project + phase, persist
  // the auto_* columns, and return the evaluation results so the UI can
  // render "Detected from <source>" badges. Holds/Done are not evaluated.
  app.get(
    "/api/projects/:projectId/stage-gates/:phase/auto",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseProjectId(req, res);
        if (!projectId) return;
        const phase = p(req.params.phase);
        if (!phase) return res.status(400).json({ error: "Missing phase code" });

        const { evaluateAndPersistGateAuto, listEvaluatorsForPhase } = await import(
          "./services/gate-auto-evaluator-service"
        );
        const bindings = listEvaluatorsForPhase(phase);
        if (bindings.length === 0) {
          return res.json({
            projectId,
            phase,
            results: [],
            persistResult: { updated: 0, cleared: 0 },
            note: "No evaluator bindings registered for this phase (Hold/Done are intentionally excluded).",
          });
        }
        const { results, persistResult } = await evaluateAndPersistGateAuto(projectId, phase);
        res.json({
          projectId,
          phase,
          results,
          persistResult,
          summary: {
            evaluatedItems: results.length,
            detectedItems: results.filter((r) => r.status !== null).length,
            highConfidence: results.filter((r) => r.status !== null && r.confidence === "high").length,
          },
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // GET /api/projects/stage-gates/auto?phase=...&projectIds=1,2,3
  // Bulk evaluator for board/dashboard views. Returns
  //   { projects: { [projectId]: AutoRequirementEvaluation[] } }
  // Persistence is opt-in via ?persist=true (default false) — bulk reads
  // shouldn't always rewrite per-row state.
  app.get(
    "/api/projects/stage-gates/auto",
    jwtAuth,
    requireAuth,
    requirePermission("stage_lifecycle", "view"),
    async (req: Request, res: Response) => {
      try {
        const phase = p(req.query.phase as string | undefined) || undefined;
        const projectIdsRaw = p(req.query.projectIds as string | undefined);
        const persist = p(req.query.persist as string | undefined) === "true";
        if (!projectIdsRaw) {
          return res.status(400).json({ error: "Missing projectIds (comma-separated)" });
        }
        const projectIds = projectIdsRaw
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        if (projectIds.length === 0) {
          return res.status(400).json({ error: "No valid projectIds" });
        }
        if (projectIds.length > 100) {
          return res.status(400).json({ error: "Maximum 100 projectIds per request" });
        }

        const { evaluateGateAutoBulk, persistGateAutoEvaluation } = await import(
          "./services/gate-auto-evaluator-service"
        );
        const projects = await evaluateGateAutoBulk(projectIds, phase);

        if (persist && phase) {
          // Best-effort persistence; we don't fail the whole batch on a single project error.
          await Promise.all(
            Object.entries(projects).map(([pid, results]) =>
              persistGateAutoEvaluation(parseInt(pid, 10), phase, results).catch(() => null),
            ),
          );
        }

        res.json({ phase: phase ?? "ALL_SEQUENTIAL", projects });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── B1: Stage Gate Readiness badge (live, not historical) ──
  // Returns the current readiness score and traffic-light classification
  // for the specified stage. Used by project headers and dashboards to
  // render the "Stage Gate Readiness" badge without requiring a transition.
  app.get(
    "/api/projects/:projectId/stage-gate-readiness/:stageCode",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        const stageCode = p(req.params.stageCode);
        if (Number.isNaN(projectId) || !stageCode) {
          return res.status(400).json({ error: "Invalid projectId or stageCode" });
        }
        const readiness = await computeCurrentStageGateReadiness(projectId, stageCode);
        if (!readiness) {
          return res.status(404).json({ error: "Stage instance not found", projectId, stageCode });
        }
        res.json(readiness);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    },
  );
}

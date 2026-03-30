// ============================================================
// COLLABORATION WORKFLOW ROUTES — Acceptances, Commitments,
//   Evidence Requests, Queries, Client Updates
// ============================================================

import type { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "./auth-context";
import {
  createAcceptance,
  getAcceptances,
  getAcceptanceReservations,
  updateReservationStatus,
  createClientCommitment,
  getClientCommitments,
  updateClientCommitment,
  createEvidenceRequest,
  getEvidenceRequests,
  fulfillEvidenceRequest,
  updateEvidenceRequestStatus,
  createProjectQuery,
  getProjectQueries,
  respondToQuery,
  updateQueryStatus,
  createClientUpdate,
  getClientUpdates,
  updateClientUpdate,
  generateClientUpdateDraft,
  getAllOpenQueries,
  getAllOverdueCommitments,
} from "./services/collaboration-workflow-service";

function getUser(req: Request): { id: number; role: string } {
  const user = (req as any).user;
  return { id: user?.id, role: user?.role || "unknown" };
}

function parseProjectId(req: Request, res: Response): number | null {
  const id = parseInt(req.params.projectId, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid projectId" });
    return null;
  }
  return id;
}

export function registerCollaborationWorkflowRoutes(app: Express): void {

  // ── Acceptances ──────────────────────────────────────────

  app.get("/api/projects/:projectId/acceptances", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const stageCode = req.query.stageCode as string | undefined;
      const acceptances = await getAcceptances(projectId, stageCode);
      res.json({ acceptances });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[collab-workflow] get acceptances error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/projects/:projectId/acceptances", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const user = getUser(req);
      const acceptance = await createAcceptance({
        projectId,
        decidedByUserId: user.id,
        ...req.body,
      });
      res.status(201).json({ acceptance });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[collab-workflow] create acceptance error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // ── Acceptance Reservations ──────────────────────────────

  app.get("/api/projects/:projectId/acceptance-reservations", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const stageCode = req.query.stageCode as string | undefined;
      const reservations = await getAcceptanceReservations(projectId, stageCode);
      res.json({ reservations });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:projectId/acceptance-reservations/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const reservation = await updateReservationStatus(id, req.body.status, req.body.notes);
      res.json({ reservation });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Client Commitments ───────────────────────────────────

  app.get("/api/projects/:projectId/client-commitments", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const commitments = await getClientCommitments(projectId);
      res.json({ commitments });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/projects/:projectId/client-commitments", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const user = getUser(req);
      const commitment = await createClientCommitment({
        projectId,
        committedByUserId: user.id,
        ...req.body,
      });
      res.status(201).json({ commitment });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:projectId/client-commitments/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const commitment = await updateClientCommitment(id, req.body);
      res.json({ commitment });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Evidence Requests ────────────────────────────────────

  app.get("/api/projects/:projectId/evidence-requests", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const stageCode = req.query.stageCode as string | undefined;
      const requests = await getEvidenceRequests(projectId, stageCode);
      res.json({ requests });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/projects/:projectId/evidence-requests", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const user = getUser(req);
      const request = await createEvidenceRequest({
        projectId,
        requestedByUserId: user.id,
        ...req.body,
      });
      res.status(201).json({ request });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:projectId/evidence-requests/:id/fulfill", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const request = await fulfillEvidenceRequest(id, req.body.evidenceUrl);
      res.json({ request });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:projectId/evidence-requests/:id/status", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const request = await updateEvidenceRequestStatus(id, req.body.status);
      res.json({ request });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Project Queries ──────────────────────────────────────

  app.get("/api/projects/:projectId/queries", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const stageCode = req.query.stageCode as string | undefined;
      const queries = await getProjectQueries(projectId, stageCode);
      res.json({ queries });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/projects/:projectId/queries", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const user = getUser(req);
      const query = await createProjectQuery({
        projectId,
        raisedByUserId: user.id,
        ...req.body,
      });
      res.status(201).json({ query });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:projectId/queries/:id/respond", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const user = getUser(req);
      const query = await respondToQuery(id, {
        respondedByUserId: user.id,
        ...req.body,
      });
      res.json({ query });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:projectId/queries/:id/status", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const query = await updateQueryStatus(id, req.body.status);
      res.json({ query });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Client Updates ───────────────────────────────────────

  app.get("/api/projects/:projectId/client-updates", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const updates = await getClientUpdates(projectId);
      res.json({ updates });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/projects/:projectId/client-updates", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const update = await createClientUpdate({ projectId, ...req.body });
      res.status(201).json({ update });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:projectId/client-updates/:id", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const user = getUser(req);
      const update = await updateClientUpdate(id, {
        clientUpdateSentBy: user.id,
        ...req.body,
      });
      res.json({ update });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/projects/:projectId/client-updates/generate-draft", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseProjectId(req, res);
      if (!projectId) return;
      const draft = await generateClientUpdateDraft(projectId);
      res.json({ draft });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Cross-project (gates) endpoints ──────────────────────

  app.get("/api/gates/queries", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const queries = await getAllOpenQueries();
      res.json({ queries });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/gates/commitments", jwtAuth, requireAuth, async (_req: Request, res: Response) => {
    try {
      const commitments = await getAllOverdueCommitments();
      res.json({ commitments });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });
}

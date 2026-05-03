import type { Express, Request, Response } from "express";
import { jwtAuth, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import {
  createFinancialReview,
  decideReview,
  getFinancialReview,
  getFinancialReviewHistory,
  getLatestFinancialReview,
  getPendingReviews,
  refreshSnapshot,
  submitReview,
  updateFinancialReview,
} from "./services/financial-review-service";
import { parseIntParam } from "./lib/req-params";

function getUser(req: Request): { id: number; role: string } {
  const user = (req as any).user;
  return { id: user?.id, role: user?.role || "unknown" };
}

export function registerFinancialReviewRoutes(app: Express): void {
  // Roles allowed to initiate a financial review
  const CREATE_REVIEW_ROLES = [
    "PROJECT_MANAGER_SITE",
    "PROGRAM_MANAGER",
    "COO_ADMIN",
    "CEO_ADMIN",
  ];

  // ── Create new review ──────────────────────────────────────────
  app.post(
    "/api/projects/:projectId/financial-review",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "create"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
        const user = getUser(req);
        if (!CREATE_REVIEW_ROLES.includes(user.role)) {
          return res.status(403).json({ error: "Only Project Managers, Programme Managers, and COO can initiate a financial review" });
        }
        const review = await createFinancialReview({ projectId, requestedByUserId: user.id });
        res.status(201).json({ review });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] create error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Get latest review for project ─────────────────────────────
  app.get(
    "/api/projects/:projectId/financial-review",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
        const review = await getLatestFinancialReview(projectId);
        res.json({ review });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] get latest error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Get specific review ───────────────────────────────────────
  app.get(
    "/api/projects/:projectId/financial-review/:reviewId",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "view"),
    async (req: Request, res: Response) => {
      try {
        const reviewId = parseIntParam(req.params.reviewId);
        if (Number.isNaN(reviewId)) return res.status(400).json({ error: "Invalid reviewId" });
        const review = await getFinancialReview(reviewId);
        if (!review) return res.status(404).json({ error: "Review not found" });
        res.json({ review });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] get error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Get review history ────────────────────────────────────────
  app.get(
    "/api/projects/:projectId/financial-review-history",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "view"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.projectId);
        if (Number.isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
        const reviews = await getFinancialReviewHistory(projectId);
        res.json({ reviews });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] history error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Update review sections/participants ───────────────────────
  app.patch(
    "/api/projects/:projectId/financial-review/:reviewId",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "edit"),
    async (req: Request, res: Response) => {
      try {
        const reviewId = parseIntParam(req.params.reviewId);
        if (Number.isNaN(reviewId)) return res.status(400).json({ error: "Invalid reviewId" });

        const allowedFields = [
          "reviewDate", "reviewMeetingRef", "participants",
          "budgetReview", "procurementReview", "scopeReview",
          "logisticsReview", "hseReview", "outcomeConditions", "outcomeNotes",
        ];
        const updates: Record<string, any> = {};
        for (const key of allowedFields) {
          if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        const review = await updateFinancialReview(reviewId, updates);
        if (!review) return res.status(404).json({ error: "Review not found" });
        res.json({ review });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] update error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Refresh snapshot ──────────────────────────────────────────
  app.post(
    "/api/projects/:projectId/financial-review/:reviewId/refresh-snapshot",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "edit"),
    async (req: Request, res: Response) => {
      try {
        const reviewId = parseIntParam(req.params.reviewId);
        if (Number.isNaN(reviewId)) return res.status(400).json({ error: "Invalid reviewId" });
        const review = await refreshSnapshot(reviewId);
        res.json({ review });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] refresh error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Submit review (DRAFT → IN_REVIEW) ─────────────────────────
  app.post(
    "/api/projects/:projectId/financial-review/:reviewId/submit",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "edit"),
    async (req: Request, res: Response) => {
      try {
        const reviewId = parseIntParam(req.params.reviewId);
        if (Number.isNaN(reviewId)) return res.status(400).json({ error: "Invalid reviewId" });
        const user = getUser(req);
        const review = await submitReview(reviewId, user.id);
        res.json({ review });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] submit error:", msg);
        res.status(400).json({ error: msg });
      }
    },
  );

  // ── Approve / Decide review ───────────────────────────────────
  app.post(
    "/api/projects/:projectId/financial-review/:reviewId/approve",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "approve"),
    async (req: Request, res: Response) => {
      try {
        const reviewId = parseIntParam(req.params.reviewId);
        if (Number.isNaN(reviewId)) return res.status(400).json({ error: "Invalid reviewId" });
        const user = getUser(req);
        const { outcome, outcomeConditions, outcomeNotes } = req.body;
        if (!outcome || !["GO", "CONDITIONAL_GO", "NO_GO", "DEFERRED"].includes(outcome)) {
          return res.status(400).json({ error: "Invalid outcome. Must be GO, CONDITIONAL_GO, NO_GO, or DEFERRED" });
        }
        const review = await decideReview({
          reviewId,
          outcome,
          outcomeConditions,
          outcomeNotes,
          actorUserId: user.id,
          actorRole: user.role,
        });
        res.json({ review });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] approve error:", msg);
        res.status(400).json({ error: msg });
      }
    },
  );

  // ── Pending reviews queue ─────────────────────────────────────
  app.get(
    "/api/financial-reviews/pending",
    jwtAuth,
    requireAuth,
    requirePermission("pd_finance", "view"),
    async (_req: Request, res: Response) => {
      try {
        const items = await getPendingReviews();
        res.json({ items });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[financial-review] pending error:", msg);
        res.status(500).json({ error: msg });
      }
    },
  );
}

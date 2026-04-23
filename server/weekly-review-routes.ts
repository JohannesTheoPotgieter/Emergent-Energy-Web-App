import type { Express, Request, Response, NextFunction } from "express";
import { type InsertWeeklyReview } from "@shared/schema";
import { z } from "zod";
import { logAuditFromReq } from "./audit-logger";
import { requirePermission } from "./permission-middleware";
import { type AuthenticatedUser, getEffectiveUser, requireAuth } from "./auth-context";
import { WeeklyReviewService } from "./services/weekly-review-service";
import { type WeeklyReviewUpdate } from "./repositories/weekly-review.repository";

export function registerWeeklyReviewRoutes(app: Express): void {
  const weeklyReviewService = new WeeklyReviewService();

  app.get("/api/weekly-reviews-all", requireAuth, requirePermission('weekly_review_wizard', 'view'), async (req: Request, res: Response) => {
    try {
      const reviews = await weeklyReviewService.listAll();
      res.json(reviews);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/weekly-reviews/:projectName", requireAuth, requirePermission('weekly_review_wizard', 'view'), async (req: Request, res: Response) => {
    try {
      const { projectName } = req.params;
      const reviews = await weeklyReviewService.listByProject(String(projectName));
      res.json(reviews);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/weekly-reviews/:projectName/:id", requireAuth, requirePermission('weekly_review_wizard', 'view'), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const review = await weeklyReviewService.getById(id);
      if (!review) return res.status(404).json({ error: "Review not found" });
      res.json(review);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/weekly-reviews/:projectName", requireAuth, requirePermission('weekly_review_wizard', 'create'), async (req: Request, res: Response) => {
    try {
      const { projectName } = req.params;
      const user = getEffectiveUser(req);
      const userId = user?.id;
      const body = z.object({
        weekStarting: z.string(),
        snapshotMetrics: z.any().optional(),
      }).parse(req.body);

      const reviewValues: InsertWeeklyReview = {
        projectName,
        weekStarting: body.weekStarting,
        reviewedBy: userId,
        status: "draft",
        snapshotMetrics: body.snapshotMetrics || null,
      };

      const review = await weeklyReviewService.create(reviewValues);
      logAuditFromReq(req, { entityType: "weekly_review", entityId: String(review.id), action: "create", projectName: String(projectName), changesJson: { description: "Weekly review created", weekStarting: body.weekStarting } });
      res.json(review);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/weekly-reviews/:projectName/:id", requireAuth, requirePermission('weekly_review_wizard', 'edit'), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const body = req.body;
      const updates: WeeklyReviewUpdate = {};

      if (body.stepSchedule !== undefined) updates.stepSchedule = body.stepSchedule;
      if (body.stepBudget !== undefined) updates.stepBudget = body.stepBudget;
      if (body.stepRisks !== undefined) updates.stepRisks = body.stepRisks;
      if (body.stepQuality !== undefined) updates.stepQuality = body.stepQuality;
      if (body.stepActions !== undefined) updates.stepActions = body.stepActions;
      if (body.stepSummary !== undefined) updates.stepSummary = body.stepSummary;
      if (body.status !== undefined) {
        updates.status = body.status;
        if (body.status === "completed") updates.completedAt = new Date();
      }

      const review = await weeklyReviewService.updateById(id, updates);
      logAuditFromReq(req, { entityType: "weekly_review", entityId: String(id), action: "update", projectName: String(req.params.projectName), changesJson: { description: "Weekly review updated", status: body.status } });
      res.json(review);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}

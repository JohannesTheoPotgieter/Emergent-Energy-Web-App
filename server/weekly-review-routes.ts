import type { Express, Request, Response } from "express";
import { db } from "./db";
import { weeklyReviews } from "@shared/schema";
import { eq, desc, type SQL } from "drizzle-orm";
import { z } from "zod";
import { logAuditFromReq } from "./audit-logger";
import { requirePermission } from "./permission-middleware";

function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  next();
}

export function registerWeeklyReviewRoutes(app: Express) {
  app.get("/api/weekly-reviews-all", requireAuth, requirePermission('weekly_review_wizard', 'view'), async (req, res) => {
    try {
      const reviews = await db
        .select()
        .from(weeklyReviews)
        .orderBy(desc(weeklyReviews.weekStarting));
      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/weekly-reviews/:projectName", requireAuth, requirePermission('weekly_review_wizard', 'view'), async (req, res) => {
    try {
      const { projectName } = req.params;
      const reviews = await db
        .select()
        .from(weeklyReviews)
        .where(eq(weeklyReviews.projectName, projectName))
        .orderBy(desc(weeklyReviews.weekStarting));
      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/weekly-reviews/:projectName/:id", requireAuth, requirePermission('weekly_review_wizard', 'view'), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [review] = await db.select().from(weeklyReviews).where(eq(weeklyReviews.id, id));
      if (!review) return res.status(404).json({ error: "Review not found" });
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/weekly-reviews/:projectName", requireAuth, requirePermission('weekly_review_wizard', 'create'), async (req, res) => {
    try {
      const { projectName } = req.params;
      const userId = (req.user as any)?.id;
      const body = z.object({
        weekStarting: z.string(),
        snapshotMetrics: z.any().optional(),
      }).parse(req.body);

      const [review] = await db
        .insert(weeklyReviews)
        .values({
          projectName,
          weekStarting: body.weekStarting,
          reviewedBy: userId,
          status: "draft",
          snapshotMetrics: body.snapshotMetrics || null,
        })
        .returning();
      logAuditFromReq(req, { entityType: "weekly_review", entityId: String(review.id), action: "create", projectName, changesJson: { description: "Weekly review created", weekStarting: body.weekStarting } });
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/weekly-reviews/:projectName/:id", requireAuth, requirePermission('weekly_review_wizard', 'edit'), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = req.body;
      const updates: Record<string, any> = {};

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

      const [review] = await db
        .update(weeklyReviews)
        .set(updates)
        .where(eq(weeklyReviews.id, id))
        .returning();
      logAuditFromReq(req, { entityType: "weekly_review", entityId: String(id), action: "update", projectName: req.params.projectName, changesJson: { description: "Weekly review updated", status: body.status } });
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

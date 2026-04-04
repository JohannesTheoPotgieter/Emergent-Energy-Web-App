/**
 * Home Dashboard Summary API — Wave 1 Step 4
 *
 * Provides a cross-role attention cockpit: my tasks, approvals, alerts.
 * Reads from promoted schema (core.work_items, documentation.document_approvals)
 * with fallbacks to legacy tables.
 *
 * READ-ONLY. Writes go through existing work-item and approval endpoints.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/home/summary
 *
 * Returns personalized dashboard counts for the authenticated user.
 */
router.get("/api/home/summary", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const userId = user.id;

    // My tasks — counts from work_items (legacy view backed by promoted schema)
    const taskCounts = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('COMPLETE', 'Complete', 'Done', 'Cancelled') AND end_date IS NOT NULL AND end_date::date < CURRENT_DATE)::int AS overdue,
        COUNT(*) FILTER (WHERE status NOT IN ('COMPLETE', 'Complete', 'Done', 'Cancelled') AND end_date IS NOT NULL AND end_date::date = CURRENT_DATE)::int AS due_today,
        COUNT(*) FILTER (WHERE status IN ('IN PROGRESS', 'In Progress'))::int AS in_progress,
        COUNT(*) FILTER (WHERE status NOT IN ('COMPLETE', 'Complete', 'Done', 'Cancelled'))::int AS total_open
      FROM work_items
      WHERE owner_user_id = ${userId}
        AND deleted_at IS NULL
    `);

    // My approvals — pending approvals assigned to me
    const approvalCounts = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < NOW())::int AS urgent
      FROM approvals
      WHERE assigned_approver = ${userId}
    `);

    // Recent activity — last 10 activities for context
    const recentActivity = await db.execute(sql`
      SELECT
        'task_update' AS type,
        title AS message,
        status,
        updated_at AS timestamp
      FROM work_items
      WHERE owner_user_id = ${userId}
        AND deleted_at IS NULL
        AND updated_at > NOW() - INTERVAL '7 days'
      ORDER BY updated_at DESC
      LIMIT 10
    `);

    // Alerts — overdue tasks, expiring approvals, blocked items
    const alerts: Array<{ type: string; message: string; severity: string }> = [];

    const tasks = (taskCounts.rows[0] || {}) as Record<string, number>;
    const approvals = (approvalCounts.rows[0] || {}) as Record<string, number>;

    if ((tasks.overdue || 0) > 0) {
      alerts.push({
        type: "overdue_tasks",
        message: `You have ${tasks.overdue} overdue task${tasks.overdue === 1 ? '' : 's'}`,
        severity: "warning",
      });
    }
    if ((approvals.urgent || 0) > 0) {
      alerts.push({
        type: "urgent_approvals",
        message: `${approvals.urgent} approval${approvals.urgent === 1 ? '' : 's'} past due date`,
        severity: "error",
      });
    }
    if ((tasks.due_today || 0) > 0) {
      alerts.push({
        type: "due_today",
        message: `${tasks.due_today} task${tasks.due_today === 1 ? '' : 's'} due today`,
        severity: "info",
      });
    }

    res.json({
      myTasks: {
        overdue: tasks.overdue || 0,
        dueToday: tasks.due_today || 0,
        inProgress: tasks.in_progress || 0,
        total: tasks.total_open || 0,
      },
      myApprovals: {
        pending: approvals.pending || 0,
        urgent: approvals.urgent || 0,
      },
      alerts,
      recentActivity: recentActivity.rows,
    });
  } catch (err) {
    console.error("[HomeSummary] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch home summary" });
  }
});

export function registerHomeSummaryRoutes(app: import("express").Express) {
  app.use(router);
}

export default router;

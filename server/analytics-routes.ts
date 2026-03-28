import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth } from "./auth-context";

export function registerAnalyticsRoutes(app: Express) {
  app.get("/api/analytics/portfolio-health", requireAuth, async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT id, project_name as name,
               COALESCE(NULLIF(overall_rag,''),'Amber') as rag,
               COALESCE(total_project_value, 0) as budget
        FROM project_info
        ORDER BY total_project_value DESC
        LIMIT 200
      `);
      res.json({ items: (rows as any).rows || [] });
    } catch (err) {
      console.error("[Analytics] Failed to fetch portfolio health:", err);
      res.status(500).json({ error: "Failed to fetch portfolio health" });
    }
  });

  app.get("/api/analytics/trends", requireAuth, async (req, res) => {
    try {
      const metric = String(req.query.metric || "project_count");
      const period = String(req.query.period || "12m");
      const rows = Array.from({ length: 12 }).map((_, i) => ({
        label: `W${i + 1}`,
        value: metric === "task_velocity" ? 20 + (i % 5) * 3 : metric === "budget_utilization" ? 50 + i * 2 : 30 + i,
        period,
      }));
      res.json({ metric, period, items: rows });
    } catch (err) {
      console.error("[Analytics] Failed to fetch trends:", err);
      res.status(500).json({ error: "Failed to fetch trends" });
    }
  });

  app.get("/api/analytics/budget-waterfall", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.query.project_id || 0);
      const rows = await db.execute(sql`SELECT COALESCE(total_project_value,0) as budget FROM project_info WHERE id = ${projectId} LIMIT 1`);
      const budget = Number((rows as any).rows?.[0]?.budget || 0);
      const approvedChanges = Math.round(budget * 0.08);
      const actual = Math.round(budget * 0.74);
      const remaining = budget + approvedChanges - actual;
      res.json({
        items: [
          { name: "Starting Budget", value: budget, type: "start" },
          { name: "Approved Changes", value: approvedChanges, type: "change" },
          { name: "Actuals", value: -actual, type: "actual" },
          { name: "Remaining", value: remaining, type: "remaining" },
        ],
      });
    } catch (err) {
      console.error("[Analytics] Failed to fetch budget waterfall:", err);
      res.status(500).json({ error: "Failed to fetch budget waterfall" });
    }
  });

  app.get("/api/analytics/velocity", requireAuth, async (req, res) => {
    try {
      const teamId = Number(req.query.team_id || 1);
      const items = Array.from({ length: 12 }).map((_, i) => ({ week: `W${i + 1}`, completed: 8 + ((i + teamId) % 6) * 2 }));
      const average = items.reduce((s, r) => s + r.completed, 0) / items.length;
      res.json({ teamId, average, items });
    } catch (err) {
      console.error("[Analytics] Failed to fetch velocity:", err);
      res.status(500).json({ error: "Failed to fetch velocity data" });
    }
  });
}

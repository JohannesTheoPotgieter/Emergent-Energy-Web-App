import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";

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

  // EE-QA-002 — these three endpoints used to fabricate numbers from
  // constants and `total_project_value × 0.08 / 0.74`. They are NOT backed
  // by any canonical reads. Any UI consumer that wants real values must
  // call /api/program-dashboard, /api/portfolio-dashboard, or the KPI
  // traceability surface instead.
  //
  // To avoid a silent fabrication risk, the endpoints now return HTTP 410
  // unless the caller explicitly opts in with `?demo=true`, in which case
  // the response includes `synthetic: true` so any debug consumer can show
  // a "Demo data" badge.
  const DEMO_GATE_BODY = {
    error: "synthetic_disabled",
    message:
      "This endpoint previously returned synthetic / fabricated values. " +
      "Use /api/program-dashboard or /api/portfolio-dashboard for real data, " +
      "or pass ?demo=true to receive the synthetic payload (response will " +
      "carry synthetic: true so the UI can label it).",
  } as const;

  app.get("/api/analytics/trends", requireAuth, requirePermission("home", "view"), async (req, res) => {
    if (req.query.demo !== "true") return res.status(410).json(DEMO_GATE_BODY);
    const metric = String(req.query.metric || "project_count");
    const period = String(req.query.period || "12m");
    const rows = Array.from({ length: 12 }).map((_, i) => ({
      label: `W${i + 1}`,
      value: metric === "task_velocity" ? 20 + (i % 5) * 3 : metric === "budget_utilization" ? 50 + i * 2 : 30 + i,
      period,
    }));
    res.json({ synthetic: true, metric, period, items: rows });
  });

  app.get("/api/analytics/budget-waterfall", requireAuth, requirePermission("home", "view"), async (req, res) => {
    if (req.query.demo !== "true") return res.status(410).json(DEMO_GATE_BODY);
    try {
      const projectId = Number(req.query.project_id || 0);
      const rows = await db.execute(sql`SELECT COALESCE(total_project_value,0) as budget FROM project_info WHERE id = ${projectId} LIMIT 1`);
      const budget = Number((rows as any).rows?.[0]?.budget || 0);
      const approvedChanges = Math.round(budget * 0.08);
      const actual = Math.round(budget * 0.74);
      const remaining = budget + approvedChanges - actual;
      res.json({
        synthetic: true,
        items: [
          { name: "Starting Budget", value: budget, type: "start" },
          { name: "Approved Changes (synthetic 8% of budget)", value: approvedChanges, type: "change" },
          { name: "Actuals (synthetic 74% of budget)", value: -actual, type: "actual" },
          { name: "Remaining", value: remaining, type: "remaining" },
        ],
      });
    } catch (err) {
      console.error("[Analytics] Failed to fetch budget waterfall:", err);
      res.status(500).json({ error: "Failed to fetch budget waterfall" });
    }
  });

  app.post("/api/analytics/nav-event", requireAuth, requirePermission("home", "view"), async (_req, res) => {
    // Accepts batched nav events from the client; intentionally no-op (no DB write).
    // Gated on `home:view` because every authenticated user has a home surface
    // and can fire nav telemetry from any page they can reach.
    res.status(204).end();
  });

  app.get("/api/analytics/velocity", requireAuth, requirePermission("home", "view"), async (req, res) => {
    if (req.query.demo !== "true") return res.status(410).json(DEMO_GATE_BODY);
    const teamId = Number(req.query.team_id || 1);
    const items = Array.from({ length: 12 }).map((_, i) => ({ week: `W${i + 1}`, completed: 8 + ((i + teamId) % 6) * 2 }));
    const average = items.reduce((s, r) => s + r.completed, 0) / items.length;
    res.json({ synthetic: true, teamId, average, items });
  });
}

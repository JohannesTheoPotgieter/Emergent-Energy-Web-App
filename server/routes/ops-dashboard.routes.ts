import type { Express, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { randomUUID, timingSafeEqual } from "crypto";

const CACHE_TTL_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

let pool: Pool | null = null;
let poolInitFailed = false;

function getPool(): Pool | null {
  if (pool || poolInitFailed) return pool;
  const url = process.env.CLAUDE_RO_DATABASE_URL;
  if (!url) {
    poolInitFailed = true;
    return null;
  }
  pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => {
    console.error("[ops-dashboard] pg pool error:", err.message);
  });
  return pool;
}

interface CacheEntry {
  body: string;
  expiresAt: number;
}
let cache: CacheEntry | null = null;

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

function rateCheck(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) {
    if (v.resetAt <= now) rateBuckets.delete(k);
  }
}, 5 * RATE_LIMIT_WINDOW_MS).unref?.();

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  if (Array.isArray(fwd) && fwd[0]) return fwd[0].split(",")[0]!.trim();
  return req.socket.remoteAddress || "unknown";
}

function logRequest(req: Request, status: number, extra?: string) {
  const ts = new Date().toISOString();
  const ua = (req.headers["user-agent"] || "").toString().slice(0, 200).replace(/[\r\n]/g, " ");
  const ip = clientIp(req);
  console.log(`[ops-dashboard] ${ts} ip=${ip} ua="${ua}" status=${status}${extra ? " " + extra : ""}`);
}

function applyCors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

function checkBearer(req: Request): boolean {
  const expected = process.env.OPS_DASHBOARD_API_KEY;
  if (!expected) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return false;
  const provided = m[1]!.trim();
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function buildPayload(): Promise<string> {
  const p = getPool();
  if (!p) throw new Error("CLAUDE_RO_DATABASE_URL not configured");

  const client = await p.connect();
  try {
    await client.query("SET statement_timeout = '20s'");

    const [
      programMetricsR,
      ragSummaryR,
      portfolioKpisR,
      projectsR,
      longLeadR,
      gateReadinessR,
      changeRequestsR,
      qcWarningsR,
    ] = await Promise.all([
      client.query(
        `SELECT * FROM claude_views.v_dashboard_program_metrics
         ORDER BY last_refreshed_at DESC NULLS LAST, updated_at DESC NULLS LAST
         LIMIT 1`
      ),
      client.query(`SELECT * FROM claude_views.v_derived_rag_summary ORDER BY rag_status`),
      client.query(
        `SELECT * FROM claude_views.v_derived_portfolio_kpis
         ORDER BY computed_at DESC NULLS LAST
         LIMIT 1`
      ),
      client.query(
        `SELECT
           m.id, m.project_id, m.project_name, m.project_code,
           m.phase, s.current_stage_code, m.rag_status,
           m.contract_value, p.size_kwp,
           m.gross_profit, m.gross_margin_pct, m.margin_pct,
           m.actual_progress_pct, m.expected_progress_pct, m.schedule_variance_pct,
           m.task_count, m.tasks_overdue, m.open_warnings,
           m.health_score,
           s.gate_status, s.gate_readiness_pct,
           s.pd_handover_date, s.pd_handover_actual,
           s.construction_start_date, s.construction_start_actual,
           s.commissioning_date, s.commissioning_actual,
           s.om_handover_date,
           s.client_handover_date, s.client_handover_actual,
           s.practical_completion_target, s.practical_completion_actual,
           m.last_refreshed_at
         FROM claude_views.v_projects p
         LEFT JOIN claude_views.v_project_state s ON s.project_id = p.id
         LEFT JOIN claude_views.v_dashboard_project_metrics m ON m.project_id = p.id
         WHERE p.is_active = true
           AND (p.archived_status IS NULL OR p.archived_status <> 'archived')
         ORDER BY p.project_name NULLS LAST, p.id`
      ),
      client.query(
        `SELECT
           pi.id, pi.project_id, pr.project_name,
           pi.title, pi.category, pi.quantity, pi.unit,
           pi.expected_cost, pi.actual_cost,
           pi.supplier_id, sup.name_canonical AS supplier_name,
           pi.po_id, pi.status,
           pi.required_date, pi.delivery_expected_date, pi.delivery_actual_date, pi.delivery_status,
           pi.rfq_sent_date, pi.quote_received_date, pi.quote_amount
         FROM claude_views.v_procurement_items pi
         LEFT JOIN claude_views.v_suppliers sup ON sup.id = pi.supplier_id
         LEFT JOIN claude_views.v_projects pr ON pr.id = pi.project_id
         WHERE pi.is_long_lead = true
           AND (pi.status IS NULL OR pi.status NOT IN ('cancelled','complete'))
         ORDER BY pi.required_date NULLS LAST, pi.id`
      ),
      client.query(
        `WITH latest AS (
           SELECT DISTINCT ON (project_id, gate_name)
             project_id, gate_name, from_stage, target_stage,
             status, missing_items, has_override, evaluated_at
           FROM claude_views.v_project_gate_evaluations
           ORDER BY project_id, gate_name, evaluated_at DESC NULLS LAST
         )
         SELECT l.project_id, p.project_name,
                l.gate_name, l.from_stage, l.target_stage,
                l.status, l.missing_items, l.has_override, l.evaluated_at
         FROM latest l
         LEFT JOIN claude_views.v_projects p ON p.id = l.project_id
         ORDER BY p.project_name NULLS LAST, l.gate_name`
      ),
      client.query(
        `SELECT id, project_id, title, change_type, status,
                cost_impact, schedule_impact_days, revenue_impact, margin_impact,
                client_linked, created_at, updated_at
         FROM claude_views.v_change_requests
         WHERE final_decision IS NULL
           AND (status IS NULL OR status NOT IN ('cancelled','withdrawn'))
         ORDER BY updated_at DESC NULLS LAST, id`
      ),
      client.query(
        `SELECT id, project_id, project_name, severity, warning_type, title,
                status, due_date, created_at
         FROM claude_views.v_qc_warnings
         WHERE status IS NULL OR status NOT IN ('closed','resolved')
         ORDER BY due_date ASC NULLS LAST, severity, id`
      ),
    ]);

    let portfolioKpis: Record<string, unknown> | null = portfolioKpisR.rows[0] ?? null;
    if (portfolioKpis && typeof portfolioKpis.phase_distribution_json === "string") {
      try {
        portfolioKpis = {
          ...portfolioKpis,
          phase_distribution_json: JSON.parse(portfolioKpis.phase_distribution_json as string),
        };
      } catch {
        /* leave as string */
      }
    }

    const payload = {
      as_of: new Date().toISOString(),
      schema_version: 1,
      program: {
        metrics: programMetricsR.rows[0] ?? null,
        rag_summary: ragSummaryR.rows,
        portfolio_kpis: portfolioKpis,
      },
      projects: projectsR.rows,
      long_lead_items: longLeadR.rows,
      gate_readiness: gateReadinessR.rows,
      change_requests_open: changeRequestsR.rows,
      qc_warnings_open: qcWarningsR.rows,
    };

    return JSON.stringify(payload);
  } finally {
    client.release();
  }
}

export function registerOpsDashboardRoute(app: Express) {
  const handler = async (req: Request, res: Response, _next: NextFunction) => {
    const ip = clientIp(req);

    if (req.method === "OPTIONS") {
      applyCors(res);
      logRequest(req, 200, "preflight");
      return res.status(200).end();
    }

    applyCors(res);

    if (req.method !== "GET") {
      logRequest(req, 405);
      return res.status(405).json({ error: "method_not_allowed" });
    }

    if (!checkBearer(req)) {
      logRequest(req, 401);
      return res.status(401).json({ error: "unauthorized" });
    }

    if (!rateCheck(ip)) {
      logRequest(req, 429);
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "rate_limited" });
    }

    try {
      const now = Date.now();
      if (cache && cache.expiresAt > now) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "private, max-age=60");
        res.setHeader("X-Cache", "HIT");
        logRequest(req, 200, "cache=hit");
        return res.status(200).send(cache.body);
      }

      const body = await buildPayload();
      cache = { body, expiresAt: now + CACHE_TTL_MS };

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.setHeader("X-Cache", "MISS");
      logRequest(req, 200, "cache=miss");
      return res.status(200).send(body);
    } catch (err) {
      const requestId = randomUUID();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ops-dashboard] request_id=${requestId} error:`, msg);
      logRequest(req, 500, `request_id=${requestId}`);
      return res.status(500).json({ error: "internal", request_id: requestId });
    }
  };

  app.options("/api/ops-dashboard", handler);
  app.get("/api/ops-dashboard", handler);
}

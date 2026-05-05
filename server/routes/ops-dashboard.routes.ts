import type { Express, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { createHash, randomUUID, timingSafeEqual } from "crypto";

const CACHE_TTL_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

let pool: Pool | null = null;

// Non-secret connection constants. These are deliberately not env vars: they
// describe *which* database this route reads from (Neon claude_readonly view
// schema) and never change between environments. Only the password is secret.
const CLAUDE_RO_HOST = "ep-damp-dawn-ajbdpxyq.c-3.us-east-2.aws.neon.tech";
const CLAUDE_RO_DB = "neondb";
const CLAUDE_RO_USER = "claude_readonly";

function resolveClaudeRoUrl(): string | null {
  // Preferred: build the URL at runtime from CLAUDE_RO_PASSWORD so we keep a
  // single source of truth for the credential and never duplicate the secret.
  const pwd = process.env.CLAUDE_RO_PASSWORD;
  if (pwd && pwd.length > 0) {
    return `postgresql://${CLAUDE_RO_USER}:${encodeURIComponent(pwd)}@${CLAUDE_RO_HOST}/${CLAUDE_RO_DB}?sslmode=require`;
  }
  // Override: a fully-formed CLAUDE_RO_DATABASE_URL is honoured if supplied
  // (useful for staging or for pointing at a different read-only branch).
  const explicit = process.env.CLAUDE_RO_DATABASE_URL;
  if (!explicit) return null;
  try {
    const u = new URL(explicit);
    if (u.hostname && u.hostname !== "base") return explicit;
  } catch {
    /* fall through */
  }
  console.error(
    "[ops-dashboard] CLAUDE_RO_DATABASE_URL is unparseable " +
      `(length=${explicit.length}). Set CLAUDE_RO_PASSWORD instead.`,
  );
  return null;
}

function getPool(): Pool | null {
  if (pool) return pool;
  const url = resolveClaudeRoUrl();
  // Do NOT cache the "no URL" outcome: if the operator fixes the secret while
  // the process is running, the next request should pick it up automatically
  // without needing a workflow restart.
  if (!url) return null;
  // Neon enforces TLS via sslmode=require in the connection string; we let
  // node-postgres derive the verified TLS context from the URL rather than
  // disabling certificate verification.
  pool = new Pool({
    connectionString: url,
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
let inflight: Promise<string> | null = null;

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
  // req.ip honours the global `trust proxy` setting (configured in
  // server/index.ts before this route is registered) and is therefore
  // resistant to X-Forwarded-For spoofing from arbitrary upstreams.
  return req.ip || req.socket.remoteAddress || "unknown";
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
  const provided = m[1]!;
  // Constant-length compare via SHA-256 fingerprint so length mismatches
  // do not introduce a timing side channel.
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
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
           p.id, p.id AS project_id, p.project_name, p.project_code,
           COALESCE(m.phase, p.phase) AS phase,
           s.current_stage_code,
           COALESCE(m.rag_status, p.rag_status) AS rag_status,
           COALESCE(m.contract_value, p.contract_value) AS contract_value,
           p.size_kwp,
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
           AND (pi.status IS NULL OR LOWER(pi.status::text) NOT IN ('cancelled','complete','completed','closed','done'))
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
           AND (status IS NULL OR LOWER(status::text) NOT IN ('cancelled','withdrawn','rejected'))
         ORDER BY updated_at DESC NULLS LAST, id`
      ),
      client.query(
        `SELECT id, project_id, project_name, severity, warning_type, title,
                status, due_date, created_at
         FROM claude_views.v_qc_warnings
         WHERE status IS NULL OR LOWER(status::text) NOT IN ('closed','resolved','dismissed')
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

      // Single-flight: concurrent cache misses share one DB roundtrip.
      if (!inflight) {
        inflight = buildPayload()
          .then((body) => {
            cache = { body, expiresAt: Date.now() + CACHE_TTL_MS };
            return body;
          })
          .finally(() => {
            inflight = null;
          });
      }
      const body = await inflight;

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

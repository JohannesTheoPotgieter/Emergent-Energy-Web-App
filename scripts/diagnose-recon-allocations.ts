#!/usr/bin/env tsx
/**
 * diagnose-recon-allocations — READ-ONLY diagnosis for the "Structural for all
 * projects" reconciliation symptom (fix/reconciliation-structural-allcause).
 *
 * For every active project it reports what % of LIVE
 * `normalized_cost_line_actuals` (effective_to IS NULL) resolve to a LIVE
 * `category_revenue_allocations` row — by the cost line's `category_allocation_id`
 * FK if that points to a live row, else by the (project_id, category_key)
 * fallback — with a NON-NULL `revenue_allocation`. That is exactly the condition
 * under which the §3.3 (Q/X)×J derivation in finance-line-level-repository.ts can
 * produce a non-zero perLineRevenue. Lines that don't resolve derive to 0 and are
 * flagged "allocation missing" (→ the board's structural/unlinked status).
 *
 * It also breaks down WHERE the link fails: orphan (no parent), no live
 * allocation (FK dead + key miss), or allocation present but revenue_allocation
 * null/zero. Use it to decide STALE (recompute fixes) vs genuinely-UNLINKED
 * (re-import / backfill needed).
 *
 * Connects directly via DATABASE_URL. SELECT-only — no writes, no DDL.
 * Run: `tsx scripts/diagnose-recon-allocations.ts`.
 */

import "dotenv/config";
import { Client } from "pg";

interface ProjectRow {
  project_id: number;
  project_name: string;
  total_actuals: string;
  orphan_no_parent: string;
  resolvable: string;
  no_live_allocation: string;
  allocation_zero_or_null_rev: string;
}

const PER_PROJECT_SQL = `
WITH live_alloc AS (
  SELECT id, project_id, lower(btrim(category_key)) AS norm_key, revenue_allocation
  FROM category_revenue_allocations
  WHERE effective_to IS NULL
),
parent AS (
  SELECT id, project_id, category_allocation_id, lower(btrim(category_key)) AS norm_key
  FROM normalized_cost_lines
  WHERE effective_to IS NULL AND deleted_at IS NULL
),
actual AS (
  SELECT a.id, a.project_id, a.cost_line_id
  FROM normalized_cost_line_actuals a
  WHERE a.effective_to IS NULL AND a.deleted_at IS NULL
),
classified AS (
  SELECT
    act.project_id,
    act.id AS actual_id,
    p.id AS parent_id,
    fk.id AS fk_alloc_id, fk.revenue_allocation AS fk_rev,
    ka.id AS key_alloc_id, ka.revenue_allocation AS key_rev
  FROM actual act
  LEFT JOIN parent p ON p.id = act.cost_line_id
  LEFT JOIN live_alloc fk ON fk.id = p.category_allocation_id
  LEFT JOIN LATERAL (
    SELECT la.id, la.revenue_allocation
    FROM live_alloc la
    WHERE la.project_id = p.project_id AND p.norm_key IS NOT NULL AND la.norm_key = p.norm_key
    LIMIT 1
  ) ka ON true
)
SELECT
  c.project_id,
  pi.project_name,
  COUNT(*) AS total_actuals,
  COUNT(*) FILTER (WHERE parent_id IS NULL) AS orphan_no_parent,
  COUNT(*) FILTER (
    WHERE parent_id IS NOT NULL
      AND COALESCE(fk_rev, key_rev) IS NOT NULL
      AND COALESCE(fk_rev, key_rev) <> 0
  ) AS resolvable,
  COUNT(*) FILTER (
    WHERE parent_id IS NOT NULL AND fk_alloc_id IS NULL AND key_alloc_id IS NULL
  ) AS no_live_allocation,
  COUNT(*) FILTER (
    WHERE parent_id IS NOT NULL
      AND (fk_alloc_id IS NOT NULL OR key_alloc_id IS NOT NULL)
      AND COALESCE(fk_rev, key_rev, 0) = 0
  ) AS allocation_zero_or_null_rev
FROM classified c
JOIN project_info pi ON pi.id = c.project_id
WHERE pi.deleted_at IS NULL
GROUP BY c.project_id, pi.project_name
ORDER BY resolvable::float / NULLIF(COUNT(*), 0) ASC, total_actuals DESC;
`;

async function scalar(client: Client, sql: string): Promise<number> {
  const r = await client.query<{ n: string }>(sql);
  return Number(r.rows[0]?.n ?? 0);
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}
function padL(s: string | number, n: number): string {
  return String(s).padStart(n);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[diagnose-recon] DATABASE_URL is not set.");
    process.exit(2);
  }

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  });
  await client.connect();
  try {
    const liveAllocations = await scalar(
      client,
      "SELECT COUNT(*) AS n FROM category_revenue_allocations WHERE effective_to IS NULL",
    );
    const liveActuals = await scalar(
      client,
      "SELECT COUNT(*) AS n FROM normalized_cost_line_actuals WHERE effective_to IS NULL AND deleted_at IS NULL",
    );

    console.log("");
    console.log("Reconciliation allocation diagnosis (read-only)");
    console.log("───────────────────────────────────────────────");
    console.log(`Live category_revenue_allocations rows : ${liveAllocations}`);
    console.log(`Live normalized_cost_line_actuals rows : ${liveActuals}`);
    if (liveAllocations === 0) {
      console.log("");
      console.log("⚠ No LIVE category_revenue_allocations rows exist. Every line will fail to");
      console.log("  resolve and the board will read structural/unlinked for ALL projects. The");
      console.log("  allocations must be (re-)imported — recompute alone will not fix this.");
    }
    console.log("");

    const { rows } = await client.query<ProjectRow>(PER_PROJECT_SQL);
    if (rows.length === 0) {
      console.log("No active projects with live actuals found.");
      process.exit(0);
    }

    console.log(
      `${pad("Project", 34)}${padL("actuals", 9)}${padL("resolved", 9)}${padL("%", 7)}` +
        `${padL("orphan", 8)}${padL("noAlloc", 9)}${padL("zeroJ", 7)}`,
    );
    console.log("".padEnd(83, "─"));

    let totAll = 0;
    let totResolved = 0;
    for (const r of rows) {
      const total = Number(r.total_actuals);
      const resolved = Number(r.resolvable);
      totAll += total;
      totResolved += resolved;
      const pct = total > 0 ? ((resolved / total) * 100).toFixed(0) : "—";
      const name = (r.project_name ?? `#${r.project_id}`).slice(0, 33);
      console.log(
        `${pad(name, 34)}${padL(total, 9)}${padL(resolved, 9)}${padL(pct, 7)}` +
          `${padL(r.orphan_no_parent, 8)}${padL(r.no_live_allocation, 9)}${padL(r.allocation_zero_or_null_rev, 7)}`,
      );
    }
    console.log("".padEnd(83, "─"));
    const overall = totAll > 0 ? ((totResolved / totAll) * 100).toFixed(1) : "—";
    console.log(`${pad("PORTFOLIO", 34)}${padL(totAll, 9)}${padL(totResolved, 9)}${padL(overall, 7)}`);
    console.log("");
    console.log("Columns: resolved = lines that resolve to a live allocation with a non-null");
    console.log("revenue_allocation (the §3.3 formula can derive); orphan = no parent cost line;");
    console.log("noAlloc = FK dead AND (project, category_key) fallback misses; zeroJ = allocation");
    console.log("found but revenue_allocation is null/zero.");
    console.log("");
    console.log("Read it: a project at ~100% resolved that still shows red on the board is STALE");
    console.log("→ POST /api/finance/reconciliation/refresh. A project with high noAlloc is");
    console.log("genuinely UNLINKED → re-import it (Smart Import S09/S10 relinks the allocations).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[diagnose-recon] FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
});

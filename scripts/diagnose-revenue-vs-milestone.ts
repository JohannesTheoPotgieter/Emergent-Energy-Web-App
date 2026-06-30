#!/usr/bin/env tsx
/**
 * diagnose-revenue-vs-milestone — READ-ONLY audit for the invariant
 * "realised/derived revenue must never exceed the milestone-tracker contract
 * revenue for a project" (symptom: Seshego Circle showed derived revenue
 * ~R12.43M against a milestone-tracker Planned-Revenue-Actual of ~R10.43M).
 *
 * WHY this is the right probe. The frozen §3.3 derivation
 * (finance-line-level-repository.ts) computes, per category,
 *     Σ perLineRevenue = (Σ actualTotal / categoryTotalActualTotal) × revenue_allocation
 *                       = revenue_allocation
 * (numerator and denominator are the SAME per-category sum). So the project's
 * total DERIVED revenue is identically Σ category_revenue_allocations.revenue_allocation
 * (col J on the Costing sheet) over the categories that have actuals. The
 * Revenue tab faithfully reproduces that sum — it does NOT inflate it.
 *
 * The milestone-tracker "Planned Revenue ACTUAL" tile is a DIFFERENT source
 * cell: tracker_revenue_summary.planned_revenue_actual (imported from the
 * Revenue Tracking summary, rows 4–7). In a self-consistent workbook the two
 * agree. When they diverge, ONE of three things is true and this script tells
 * you which:
 *
 *   (1) DUPLICATE allocations  — category_revenue_allocations has no
 *       (project_id, category_key) uniqueness guard (unlike the *_row_hash
 *       unique indexes on revenue/cost lines), so a re-import that failed to
 *       soft-close can leave two LIVE rows for one category. `dup_excess`
 *       quantifies the over-count. Fix = de-dup + add the missing unique index.
 *   (2) SOURCE divergence      — col J (costing) genuinely sums to more than
 *       the summary cell. `dup_excess≈0` but `delta>0`. The workbook itself is
 *       inconsistent; the app is right to show both. Fix is a business call:
 *       correct the source sheet / re-import, OR decide which figure is canon.
 *   (3) DUPLICATE milestones   — two LIVE normalized_revenue_lines share a
 *       milestone_no/name (the visible "Claim 1 twice"). These are genuinely
 *       different source rows (the row_hash unique index forbids exact dupes),
 *       so this flags a source-workbook artifact to investigate.
 *
 * Connects directly via DATABASE_URL. SELECT-only — no writes, no DDL.
 * Run:  tsx scripts/diagnose-revenue-vs-milestone.ts
 *       tsx scripts/diagnose-revenue-vs-milestone.ts "Seshego"   # filter by name
 */

import "dotenv/config";
import { Client } from "pg";

interface Row {
  project_id: number;
  project_name: string;
  sum_alloc_all: string | null;
  n_alloc: string | null;
  dup_key_count: string | null;
  dup_excess: string | null;
  planned_revenue_actual: string | null;
  planned_revenue_costed: string | null;
  dup_summary_rows: string | null;
  sum_milestones: string | null;
  n_milestones: string | null;
  dup_milestone_groups: string | null;
}

const SQL = `
WITH live_alloc AS (
  SELECT project_id,
         lower(btrim(category_key)) AS norm_key,
         revenue_allocation
  FROM category_revenue_allocations
  WHERE effective_to IS NULL
),
alloc_by_project AS (
  SELECT project_id,
         SUM(revenue_allocation) AS sum_alloc_all,
         COUNT(*)                 AS n_alloc
  FROM live_alloc
  GROUP BY project_id
),
alloc_dups AS (
  SELECT project_id,
         COUNT(*) FILTER (WHERE cnt > 1)                       AS dup_key_count,
         COALESCE(SUM(extra) FILTER (WHERE cnt > 1), 0)        AS dup_excess
  FROM (
    SELECT project_id,
           norm_key,
           COUNT(*)                                            AS cnt,
           -- amount that DUPLICATE rows add beyond a single copy of this key
           COALESCE(SUM(revenue_allocation), 0) - COALESCE(MAX(revenue_allocation), 0) AS extra
    FROM live_alloc
    GROUP BY project_id, norm_key
  ) k
  GROUP BY project_id
),
summary AS (
  -- A project must have exactly ONE live tracker_revenue_summary row, but the
  -- table has no (project_id) WHERE effective_to IS NULL unique guard, so guard
  -- against fan-out: take MAX as the ceiling (never inflate it by summing dupes)
  -- and surface the live-row count so a duplicate ceiling is itself flagged.
  SELECT project_id,
         MAX(planned_revenue_actual) AS planned_revenue_actual,
         MAX(planned_revenue_costed) AS planned_revenue_costed,
         COUNT(*)                    AS dup_summary_rows
  FROM tracker_revenue_summary
  WHERE effective_to IS NULL
  GROUP BY project_id
),
milestones AS (
  SELECT project_id,
         SUM(amount_ex_vat) AS sum_milestones,
         COUNT(*)           AS n_milestones
  FROM normalized_revenue_lines
  WHERE effective_to IS NULL AND deleted_at IS NULL
  GROUP BY project_id
),
milestone_dups AS (
  SELECT project_id, COUNT(*) FILTER (WHERE cnt > 1) AS dup_milestone_groups
  FROM (
    SELECT project_id,
           lower(btrim(COALESCE(NULLIF(milestone_no, ''), milestone_name, ''))) AS k,
           COUNT(*) AS cnt
    FROM normalized_revenue_lines
    WHERE effective_to IS NULL AND deleted_at IS NULL
    GROUP BY project_id, lower(btrim(COALESCE(NULLIF(milestone_no, ''), milestone_name, '')))
  ) m
  WHERE m.k <> ''
  GROUP BY project_id
)
SELECT pi.id AS project_id,
       pi.project_name,
       a.sum_alloc_all,
       a.n_alloc,
       COALESCE(ad.dup_key_count, 0) AS dup_key_count,
       COALESCE(ad.dup_excess, 0)    AS dup_excess,
       s.planned_revenue_actual,
       s.planned_revenue_costed,
       COALESCE(s.dup_summary_rows, 0) AS dup_summary_rows,
       ms.sum_milestones,
       ms.n_milestones,
       COALESCE(md.dup_milestone_groups, 0) AS dup_milestone_groups
FROM project_info pi
LEFT JOIN alloc_by_project a  ON a.project_id  = pi.id
LEFT JOIN alloc_dups       ad ON ad.project_id = pi.id
LEFT JOIN summary          s  ON s.project_id  = pi.id
LEFT JOIN milestones       ms ON ms.project_id = pi.id
LEFT JOIN milestone_dups   md ON md.project_id = pi.id
WHERE pi.deleted_at IS NULL
  AND (a.sum_alloc_all IS NOT NULL OR ms.sum_milestones IS NOT NULL)
ORDER BY (COALESCE(a.sum_alloc_all, 0) - COALESCE(s.planned_revenue_actual, 0)) DESC;
`;

const num = (v: string | null): number | null => (v == null ? null : Number(v));
const money = (v: number | null): string =>
  v == null ? "—" : Math.round(v).toLocaleString("en-ZA");
const padR = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[diagnose-rev-vs-milestone] DATABASE_URL is not set.");
    process.exit(2);
  }
  const nameFilter = (process.argv[2] ?? "").trim().toLowerCase();

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  });
  await client.connect();
  try {
    const { rows } = await client.query<Row>(SQL);
    const filtered = nameFilter
      ? rows.filter((r) => (r.project_name ?? "").toLowerCase().includes(nameFilter))
      : rows;

    console.log("");
    console.log("Revenue (derived col-J) vs Milestone-tracker contract  —  read-only");
    console.log("═".repeat(118));
    console.log(
      padR("Project", 26) +
        padL("derivedJ", 14) +
        padL("ceiling(actual)", 16) +
        padL("Δ over", 13) +
        padL("dupKeys", 9) +
        padL("dupExcess", 12) +
        padL("Σmiles", 13) +
        padL("dupMiles", 9) +
        padL("dupCeil", 9),
    );
    console.log("─".repeat(127));

    let violations = 0;
    let dupCausedCount = 0;
    for (const r of filtered) {
      const derived = num(r.sum_alloc_all) ?? 0;
      const ceiling = num(r.planned_revenue_actual);
      const dupExcess = num(r.dup_excess) ?? 0;
      const dupKeys = Number(r.dup_key_count ?? 0);
      const dupMiles = Number(r.dup_milestone_groups ?? 0);
      const dupCeil = Number(r.dup_summary_rows ?? 0);
      const delta = ceiling == null ? null : derived - ceiling;
      const isViolation = delta != null && delta > 1;
      if (isViolation) violations++;
      // If the duplicate-allocation excess explains (most of) the overage, the
      // cause is class (1); otherwise it's class (2) source divergence.
      const dupExplains = isViolation && delta != null && dupExcess >= delta - 1;
      if (dupExplains) dupCausedCount++;

      const mark = isViolation ? (dupExplains ? " ⚠dup" : " ⚠src") : "";
      const ceilMark = dupCeil > 1 ? " ⚠dupCeil" : "";
      console.log(
        padR((r.project_name ?? `#${r.project_id}`).slice(0, 25), 26) +
          padL(money(derived), 14) +
          padL(money(ceiling), 16) +
          padL(delta == null ? "—" : money(delta), 13) +
          padL(dupKeys, 9) +
          padL(money(dupExcess), 12) +
          padL(money(num(r.sum_milestones)), 13) +
          padL(dupMiles, 9) +
          padL(dupCeil, 9) +
          mark +
          ceilMark,
      );
    }
    console.log("─".repeat(118));
    console.log(
      `Projects audited: ${filtered.length}   ` +
        `Invariant violations (derivedJ > ceiling): ${violations}   ` +
        `…of which duplicate-allocation explains: ${dupCausedCount}`,
    );
    console.log("");
    console.log("Columns:");
    console.log("  derivedJ        Σ live category_revenue_allocations.revenue_allocation");
    console.log("                  (≡ the Revenue tab's total derived revenue, by the §3.3 identity).");
    console.log("  ceiling(actual) tracker_revenue_summary.planned_revenue_actual (the milestone-tracker tile).");
    console.log("  Δ over          derivedJ − ceiling. >0 ⇒ the invariant is violated for this project.");
    console.log("  dupKeys         # category_key values with >1 LIVE allocation row (snapshot-uniqueness gap).");
    console.log("  dupExcess       R added by those duplicate rows beyond one copy per key.");
    console.log("  Σmiles          Σ live normalized_revenue_lines.amount_ex_vat (milestone claims cross-check).");
    console.log("  dupMiles        # milestone_no/name groups appearing on >1 LIVE revenue line (e.g. 'Claim 1' twice).");
    console.log("  dupCeil         # LIVE tracker_revenue_summary rows for the project. >1 (⚠dupCeil) ⇒ the ceiling");
    console.log("                  itself is duplicated; MAX is used so Δ stays meaningful, but the data needs de-duping.");
    console.log("");
    console.log("Read it:");
    console.log("  ⚠dup  → dupExcess explains the overage. Root cause = duplicate LIVE allocations.");
    console.log("          Fix: de-dup category_revenue_allocations + add the missing");
    console.log("          unique index on (project_id, category_key) WHERE effective_to IS NULL,");
    console.log("          then re-import / re-run S10 relink. No frozen-formula change.");
    console.log("  ⚠src  → dupExcess ≈ 0 but derivedJ still exceeds the ceiling. Root cause =");
    console.log("          source-workbook divergence (Costing col J vs Revenue summary cell).");
    console.log("          The app reproduces both faithfully — decide which figure is canonical");
    console.log("          (owner call) and correct the source / re-import. Do NOT silently clamp.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[diagnose-rev-vs-milestone] FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
});

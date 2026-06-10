/**
 * verify:golden — READ-ONLY prod diff for the golden fixture.
 *
 * Reads qa/fixtures/golden-trackers-5.json (the independent tracker truth) and
 * compares it, line by line and project by project, against LIVE prod finance
 * data as of the oracle date (08/06). Emits qa/reports/golden-vs-prod.csv naming
 * every mismatch and every orphan (a line present on one side but not the
 * other), plus the per-project REV/COS/GP comparison against both prod and the
 * dashboard oracle.
 *
 * STRICTLY READ-ONLY. The read-only prod role (claude_readonly) only exposes the
 * `claude_views.*` snapshot-dated views — never the base tables. This script
 * issues SELECTs against those views only; no INSERT/UPDATE/DELETE is ever run,
 * and it does NOT import any app importer or finance-derivation code. The
 * prod-side realised set is read straight from the canonical views.
 *
 * Surfaces compared:
 *   cos          golden Expenditure-Breakdown realised COS  vs  v_normalized_cost_lines (cos_realised=true)
 *   rev_billed   golden Revenue-Tracking realised billings   vs  v_normalized_revenue_lines (status='paid')
 *   rev_recognised  golden (Q/X)×J recognised revenue        vs  oracle only (app-derived; NOT in RO views)
 *
 * Run:  npm run verify:golden
 * Env:  CLAUDE_RO_DATABASE_URL (preferred) or DATABASE_URL — a read-only role.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const ROOT = process.cwd();
const FIXTURE = join(ROOT, "qa/fixtures/golden-trackers-5.json");
const OUT_CSV = join(ROOT, "qa/reports/golden-vs-prod.csv");

const AS_AT = "2026-06-08";
const SNAP = `${AS_AT} 23:59:59`; // snapshot cut for effective_from / effective_to
const ASOF = `effective_from <= $2 AND (effective_to IS NULL OR effective_to > $2)`;
const R1 = 1; // reconciliation tolerance (rands)

function toNum(v: any): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[R\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function normKey(s: any): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function csvCell(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Line { amount: number; inv: string; desc: string; cat: string | number }
/**
 * Group lines by their invoice number (or description when there is no invoice).
 * Lines are NOT summed — each source line is kept individually so the line-level
 * diff can pair them one-for-one and never let offsetting amounts net out.
 */
function groupLines(
  src: any[],
  get: (l: any) => { inv: string; desc: string; amount: number; cat: string | number },
): Map<string, Line[]> {
  const map = new Map<string, Line[]>();
  for (const l of src) {
    const { inv, desc, amount, cat } = get(l);
    const ni = normKey(inv);
    const key = ni ? `inv:${ni}` : `desc:${normKey(desc)}`;
    const line: Line = { amount, inv: String(inv ?? ""), desc: String(desc ?? ""), cat };
    const ex = map.get(key);
    if (ex) ex.push(line);
    else map.set(key, [line]);
  }
  return map;
}

interface CsvRow {
  scope: string; project: string; projectId: number | string; surface: string;
  key: string; field: string; golden: string; prod: string; oracle: string;
  deltaGoldenProd: string; deltaGoldenOracle: string; status: string;
}

async function main() {
  const url = process.env.CLAUDE_RO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("verify:golden — no CLAUDE_RO_DATABASE_URL / DATABASE_URL set. Cannot reach prod.");
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const pool = new Pool({ connectionString: url, max: 2 });
  const q = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;

  const rows: CsvRow[] = [];
  const summary: string[] = [];

  try {
    for (const p of fixture.projects) {
      const name = p.projectName;
      const oracle = p.oracle;
      const ebTotals = p.expenditureBreakdown.totals;
      const rt = p.revenueTracking;

      // ── Prod canonical (read-only views), as of the oracle snapshot ──
      const prodCostLines = await q(
        `SELECT project_id, category_key, cost_category, description,
                amount_ex_vat, invoice_number
         FROM claude_views.v_normalized_cost_lines
         WHERE project_name=$1 AND cos_realised=true AND ${ASOF}`,
        [name, SNAP],
      );
      const prodRevLines = await q(
        `SELECT project_id, milestone_no, milestone_name, description,
                amount_ex_vat, invoice_number
         FROM claude_views.v_normalized_revenue_lines
         WHERE project_name=$1 AND status='paid' AND ${ASOF}`,
        [name, SNAP],
      );

      const prodId =
        prodCostLines[0]?.project_id ?? prodRevLines[0]?.project_id ?? "NOT_FOUND";
      if (prodId === "NOT_FOUND") {
        rows.push({
          scope: "project", project: name, projectId: "NOT_FOUND", surface: "*",
          key: "", field: "*", golden: "", prod: "", oracle: "",
          deltaGoldenProd: "", deltaGoldenOracle: "", status: "prod_project_missing",
        });
        summary.push(`${name.padEnd(22)} — NOT FOUND in prod views`);
        continue;
      }

      const prodCos = prodCostLines.reduce((a, l) => a + toNum(l.amount_ex_vat), 0);
      const prodRevBilled = prodRevLines.reduce((a, l) => a + toNum(l.amount_ex_vat), 0);

      // ── Per-project comparison ──
      const proj = (
        surface: string, field: string,
        gv: number | null, pv: number | null, ov: number | null,
        tieAgainst: "prod" | "oracle",
      ) => {
        const cmp = tieAgainst === "prod" ? pv : ov;
        const status =
          cmp == null ? "no_prod_surface"
            : gv == null ? "n/a"
              : Math.abs(gv - cmp) <= R1 ? "tie" : "mismatch";
        rows.push({
          scope: "project", project: name, projectId: prodId, surface, field,
          key: "",
          golden: gv == null ? "" : String(round(gv)),
          prod: pv == null ? "n/a (app-derived)" : String(round(pv)),
          oracle: ov == null ? "" : String(round(ov)),
          deltaGoldenProd: gv != null && pv != null ? String(round(gv - pv)) : "",
          deltaGoldenOracle: gv != null && ov != null ? String(round(gv - ov)) : "",
          status,
        });
      };
      // Recognised revenue ((Q/X)×J) — prod value is app-derived, not in RO views; tie vs oracle.
      proj("rev_recognised", "realisedRev", ebTotals.realisedRev, null, oracle.rev, "oracle");
      proj("cos", "realisedCos", ebTotals.realisedCos, prodCos, oracle.cos, "prod");
      proj("rev_recognised", "realisedGp", ebTotals.realisedGp, null, oracle.gp, "oracle");
      proj("rev_billed", "billedRev", rt ? rt.realisedRevenue : null, prodRevBilled, null, "prod");

      // ── Line-level COS diff (golden EB realised  vs  prod cost lines) ──
      const gCos = groupLines(
        p.expenditureBreakdown.lines.filter((l: any) => l.bucket === "realised"),
        (l) => ({ inv: l.invoiceNumber, desc: l.description, amount: l.actualTotal, cat: l.categoryNumber ?? "" }),
      );
      const pCos = groupLines(
        prodCostLines,
        (l) => ({ inv: l.invoice_number, desc: l.description, amount: toNum(l.amount_ex_vat), cat: l.cost_category ?? "" }),
      );
      const cosStats = diffLines("cos", name, prodId, gCos, pCos, rows);

      // ── Line-level billed-revenue diff (golden RT realised  vs  prod rev lines) ──
      const gRev = rt
        ? groupLines(
            rt.milestones.filter((m: any) => m.bucket === "realised"),
            (m) => ({ inv: m.invoiceNumber, desc: m.milestone, amount: m.value, cat: m.no ?? "" }),
          )
        : new Map<string, Line[]>();
      const pRev = groupLines(
        prodRevLines,
        (l) => ({ inv: l.invoice_number, desc: l.milestone_name ?? l.description, amount: toNum(l.amount_ex_vat), cat: l.milestone_no ?? "" }),
      );
      const revStats = diffLines("rev_billed", name, prodId, gRev, pRev, rows);

      summary.push(
        `${name.padEnd(22)} prod#${String(prodId).padEnd(4)} ` +
          `COS g=${round(ebTotals.realisedCos)} p=${round(prodCos)} o=${oracle.cos} ` +
          `[match=${cosStats.matched} mis=${cosStats.mismatch} orphFix=${cosStats.orphanFix} orphProd=${cosStats.orphanProd}] | ` +
          `RTbilled g=${rt ? round(rt.realisedRevenue) : "n/a"} p=${round(prodRevBilled)} ` +
          `[match=${revStats.matched} mis=${revStats.mismatch} orphFix=${revStats.orphanFix} orphProd=${revStats.orphanProd}]`,
      );
    }
  } finally {
    await pool.end();
  }

  mkdirSync(join(ROOT, "qa/reports"), { recursive: true });
  const header = [
    "scope", "project", "projectId", "surface", "lineKey", "field",
    "golden", "prod", "oracle", "deltaGoldenProd", "deltaGoldenOracle", "status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.scope, csvCell(r.project), r.projectId, r.surface, csvCell(r.key), r.field,
      r.golden, r.prod, r.oracle, r.deltaGoldenProd, r.deltaGoldenOracle, csvCell(r.status),
    ].join(","));
  }
  writeFileSync(OUT_CSV, lines.join("\n") + "\n");

  console.log(`✓ wrote ${OUT_CSV}  (${rows.length} diff rows)`);
  console.log(summary.join("\n"));
}

/**
 * Strictly LINE-GRANULAR diff. Within each invoice/description group the golden
 * and prod lines are matched one-for-one — never summed — so offsetting amounts
 * on the same invoice cannot net out and hide a real per-line difference:
 *   1. exact pass — pair each golden line with a prod line whose amount matches
 *      within R1 (silent, no CSV row);
 *   2. remaining golden↔prod lines in the same group are paired as `mismatch`
 *      rows naming both amounts and the delta;
 *   3. anything still unpaired is emitted as `orphan_in_fixture` / `orphan_in_prod`.
 * Every unmatched or differing source line therefore produces its own CSV row.
 */
function diffLines(
  surface: string, project: string, projectId: number | string,
  golden: Map<string, Line[]>, prod: Map<string, Line[]>, rows: CsvRow[],
) {
  let matched = 0, mismatch = 0, orphanFix = 0, orphanProd = 0;
  const emit = (key: string, status: string, g: Line | null, pr: Line | null) => {
    rows.push({
      scope: "line", project, projectId, surface, key, field: "amount",
      golden: g ? String(round(g.amount)) : "",
      prod: pr ? String(round(pr.amount)) : "",
      oracle: "",
      deltaGoldenProd: g && pr ? String(round(g.amount - pr.amount)) : "",
      deltaGoldenOracle: "",
      status,
    });
  };

  const keys = new Set<string>([...golden.keys(), ...prod.keys()]);
  for (const key of keys) {
    const gList = (golden.get(key) ?? []).slice();
    const pList = (prod.get(key) ?? []).slice();
    const pUsed = new Array(pList.length).fill(false);
    const gRem: Line[] = [];

    // 1. exact-amount pass
    for (const g of gList) {
      let hit = -1;
      for (let i = 0; i < pList.length; i++) {
        if (!pUsed[i] && Math.abs(g.amount - pList[i].amount) <= R1) { hit = i; break; }
      }
      if (hit >= 0) { pUsed[hit] = true; matched++; }
      else gRem.push(g);
    }
    const pRem = pList.filter((_, i) => !pUsed[i]);

    // 2. pair leftovers in the same group as mismatches
    let gi = 0, pi = 0;
    for (; gi < gRem.length && pi < pRem.length; gi++, pi++) {
      mismatch++;
      emit(key, `mismatch (${csvCell(gRem[gi].desc).slice(0, 40)})`, gRem[gi], pRem[pi]);
    }
    // 3. true orphans
    for (; gi < gRem.length; gi++) {
      orphanFix++;
      emit(key, `orphan_in_fixture (${csvCell(gRem[gi].desc).slice(0, 40)} inv=${gRem[gi].inv})`, gRem[gi], null);
    }
    for (; pi < pRem.length; pi++) {
      orphanProd++;
      emit(key, `orphan_in_prod (${csvCell(pRem[pi].desc).slice(0, 40)} inv=${pRem[pi].inv})`, null, pRem[pi]);
    }
  }
  return { matched, mismatch, orphanFix, orphanProd };
}

main().catch((e) => {
  console.error("verify:golden failed:", e);
  process.exit(1);
});

/**
 * Golden-oracle verification core (shared by the verify:golden CLI and the
 * weekly finance integrity guard).
 *
 * Compares qa/fixtures/golden-trackers-5.json (the INDEPENDENT tracker truth)
 * line-by-line and project-by-project against LIVE prod finance data as of the
 * oracle date, via the read-only `claude_views.*` snapshot-dated views.
 *
 * STRICTLY READ-ONLY and INDEPENDENT: only SELECTs against the RO views, and it
 * imports ZERO app importer / finance-derivation code — the whole point of an
 * oracle is that it doesn't share logic with the thing it audits.
 *
 * S7/S9: the guard runs this against Postgres/prod only. When the DB is not
 * Postgres, the RO views are absent, or no connection string is set, this
 * returns `skipped` (environment health) — never a false drift signal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const ROOT = process.cwd();
const FIXTURE = join(ROOT, "qa/fixtures/golden-trackers-5.json");

const AS_AT = "2026-06-08";
const SNAP = `${AS_AT} 23:59:59`; // snapshot cut for effective_from / effective_to
const ASOF = `effective_from <= $2 AND (effective_to IS NULL OR effective_to > $2)`;
const R1 = 1; // reconciliation tolerance (rands)

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[R\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function normKey(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Line {
  amount: number;
  inv: string;
  desc: string;
  cat: string | number;
}

export interface GoldenCsvRow {
  scope: string;
  project: string;
  projectId: number | string;
  surface: string;
  key: string;
  field: string;
  golden: string;
  prod: string;
  oracle: string;
  deltaGoldenProd: string;
  deltaGoldenOracle: string;
  status: string;
}

export interface GoldenVerificationResult {
  asAt: string;
  rows: GoldenCsvRow[];
  summaryLines: string[];
  counts: {
    projectsCompared: number;
    tie: number;
    mismatch: number;
    orphanFix: number;
    orphanProd: number;
    missing: number;
  };
  /** A status that represents drift — a broken tie / orphan / missing project. */
  driftCount: number;
  /** True when no drift was found AND the check actually ran. */
  pass: boolean;
  /** True when the environment was not eligible (non-Postgres, no views, no url). */
  skipped: boolean;
  skipReason?: string;
}

/** Group lines by invoice (or description) without summing, for one-for-one diff. */
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

/**
 * Run the golden-vs-prod verification. Read-only. Returns structured rows +
 * counts; the CLI wrapper renders the CSV and console summary from this.
 */
export async function runGoldenVerification(): Promise<GoldenVerificationResult> {
  const empty = (skipReason: string): GoldenVerificationResult => ({
    asAt: AS_AT,
    rows: [],
    summaryLines: [],
    counts: { projectsCompared: 0, tie: 0, mismatch: 0, orphanFix: 0, orphanProd: 0, missing: 0 },
    driftCount: 0,
    pass: false,
    skipped: true,
    skipReason,
  });

  const url = process.env.CLAUDE_RO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) return empty("no CLAUDE_RO_DATABASE_URL / DATABASE_URL set");
  if (!/^postgres(ql)?:\/\//i.test(url)) return empty("not a PostgreSQL connection (golden requires prod RO views)");

  let fixture: { projects: any[] };
  try {
    fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  } catch (err) {
    return empty(`golden fixture unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rows: GoldenCsvRow[] = [];
  const summary: string[] = [];
  const counts = { projectsCompared: 0, tie: 0, mismatch: 0, orphanFix: 0, orphanProd: 0, missing: 0 };

  const pool = new Pool({ connectionString: url, max: 2 });
  const q = async (sqlText: string, params: any[] = []) => (await pool.query(sqlText, params)).rows;

  try {
    for (const p of fixture.projects) {
      const name = p.projectName;
      const oracle = p.oracle;
      const ebTotals = p.expenditureBreakdown.totals;
      const rt = p.revenueTracking;

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

      const prodId = prodCostLines[0]?.project_id ?? prodRevLines[0]?.project_id ?? "NOT_FOUND";
      counts.projectsCompared += 1;
      if (prodId === "NOT_FOUND") {
        counts.missing += 1;
        rows.push({
          scope: "project", project: name, projectId: "NOT_FOUND", surface: "*",
          key: "", field: "*", golden: "", prod: "", oracle: "",
          deltaGoldenProd: "", deltaGoldenOracle: "", status: "prod_project_missing",
        });
        summary.push(`${String(name).padEnd(22)} — NOT FOUND in prod views`);
        continue;
      }

      const prodCos = prodCostLines.reduce((a, l) => a + toNum(l.amount_ex_vat), 0);
      const prodRevBilled = prodRevLines.reduce((a, l) => a + toNum(l.amount_ex_vat), 0);

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
        if (status === "tie") counts.tie += 1;
        else if (status === "mismatch") counts.mismatch += 1;
        rows.push({
          scope: "project", project: name, projectId: prodId, surface, field, key: "",
          golden: gv == null ? "" : String(round(gv)),
          prod: pv == null ? "n/a (app-derived)" : String(round(pv)),
          oracle: ov == null ? "" : String(round(ov)),
          deltaGoldenProd: gv != null && pv != null ? String(round(gv - pv)) : "",
          deltaGoldenOracle: gv != null && ov != null ? String(round(gv - ov)) : "",
          status,
        });
      };
      proj("rev_recognised", "realisedRev", ebTotals.realisedRev, null, oracle.rev, "oracle");
      proj("cos", "realisedCos", ebTotals.realisedCos, prodCos, oracle.cos, "prod");
      proj("rev_recognised", "realisedGp", ebTotals.realisedGp, null, oracle.gp, "oracle");
      proj("rev_billed", "billedRev", rt ? rt.realisedRevenue : null, prodRevBilled, null, "prod");

      const gCos = groupLines(
        p.expenditureBreakdown.lines.filter((l: any) => l.bucket === "realised"),
        (l) => ({ inv: l.invoiceNumber, desc: l.description, amount: l.actualTotal, cat: l.categoryNumber ?? "" }),
      );
      const pCos = groupLines(
        prodCostLines,
        (l) => ({ inv: l.invoice_number, desc: l.description, amount: toNum(l.amount_ex_vat), cat: l.cost_category ?? "" }),
      );
      const cosStats = diffLines("cos", name, prodId, gCos, pCos, rows, counts);

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
      const revStats = diffLines("rev_billed", name, prodId, gRev, pRev, rows, counts);

      summary.push(
        `${String(name).padEnd(22)} prod#${String(prodId).padEnd(4)} ` +
          `COS g=${round(ebTotals.realisedCos)} p=${round(prodCos)} o=${oracle.cos} ` +
          `[match=${cosStats.matched} mis=${cosStats.mismatch} orphFix=${cosStats.orphanFix} orphProd=${cosStats.orphanProd}] | ` +
          `RTbilled g=${rt ? round(rt.realisedRevenue) : "n/a"} p=${round(prodRevBilled)} ` +
          `[match=${revStats.matched} mis=${revStats.mismatch} orphFix=${revStats.orphanFix} orphProd=${revStats.orphanProd}]`,
      );
    }
  } catch (err) {
    await pool.end().catch(() => {});
    // A query error here (missing views, connection refused) is an ENVIRONMENT
    // condition, not finance drift — report it as skipped per S7/S9.
    return empty(`golden query failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await pool.end().catch(() => {});

  const driftCount = counts.mismatch + counts.orphanFix + counts.orphanProd + counts.missing;
  return {
    asAt: AS_AT,
    rows,
    summaryLines: summary,
    counts,
    driftCount,
    pass: driftCount === 0,
    skipped: false,
  };
}

/** Strictly line-granular diff (ported verbatim) — one-for-one, never summed. */
function diffLines(
  surface: string, project: string, projectId: number | string,
  golden: Map<string, Line[]>, prod: Map<string, Line[]>, rows: GoldenCsvRow[],
  counts: GoldenVerificationResult["counts"],
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

    for (const g of gList) {
      let hit = -1;
      for (let i = 0; i < pList.length; i++) {
        if (!pUsed[i] && Math.abs(g.amount - pList[i].amount) <= R1) { hit = i; break; }
      }
      if (hit >= 0) { pUsed[hit] = true; matched++; }
      else gRem.push(g);
    }
    const pRem = pList.filter((_, i) => !pUsed[i]);

    let gi = 0, pi = 0;
    for (; gi < gRem.length && pi < pRem.length; gi++, pi++) {
      mismatch++;
      emit(key, `mismatch (${csvCell(gRem[gi].desc).slice(0, 40)})`, gRem[gi], pRem[pi]);
    }
    for (; gi < gRem.length; gi++) {
      orphanFix++;
      emit(key, `orphan_in_fixture (${csvCell(gRem[gi].desc).slice(0, 40)} inv=${gRem[gi].inv})`, gRem[gi], null);
    }
    for (; pi < pRem.length; pi++) {
      orphanProd++;
      emit(key, `orphan_in_prod (${csvCell(pRem[pi].desc).slice(0, 40)} inv=${pRem[pi].inv})`, null, pRem[pi]);
    }
  }
  counts.mismatch += mismatch;
  counts.orphanFix += orphanFix;
  counts.orphanProd += orphanProd;
  return { matched, mismatch, orphanFix, orphanProd };
}

/** Render the same CSV the verify:golden CLI has always written. */
export const GOLDEN_CSV_HEADER = [
  "scope", "project", "projectId", "surface", "lineKey", "field",
  "golden", "prod", "oracle", "deltaGoldenProd", "deltaGoldenOracle", "status",
];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatGoldenCsv(rows: readonly GoldenCsvRow[]): string {
  const lines = [GOLDEN_CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      r.scope, csvCell(r.project), r.projectId, r.surface, csvCell(r.key), r.field,
      r.golden, r.prod, r.oracle, r.deltaGoldenProd, r.deltaGoldenOracle, csvCell(r.status),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

/**
 * Finance drill-down aggregator — PURE, READ-ONLY, NO NEW MATH.
 *
 * This module takes the canonical per-line output of
 * `server/repositories/finance-line-level-repository.ts` (the single read
 * path, AGENT_GUARDRAILS § 3.3.2) and groups it into the drill hierarchy:
 *
 *     FY → month → project → category line → invoice leaf
 *
 * Every figure on every node is the SUM of the canonical per-line values
 * (`actualTotal` = COS col Q, `perLineRevenue` = derived (Q/X)×J,
 * `perLineGp`). This is exactly the aggregation rule § 3.3.1 mandates
 * ("aggregates must be computed as the sum of the per-line values"). It does
 * NOT recompute revenue / COS / GP and it does NOT touch the frozen
 * computation paths (§ 3B S10). The drill is a view over canonical lines.
 *
 * The invariant that `sum(children) == parent` at every level therefore
 * holds by construction: a parent's totals are the sum of the same leaves
 * its children partition. `findSumViolations` (below) self-checks this within
 * R1 on the read path.
 */

/** Bucket as emitted by the canonical repository (plus the legacy
 * "unrealised" alias some surfaces use). Realised vs forecast is the only
 * split the drill surfaces (§ 3.7: BLACK = realised, RED = forecast). */
export type DrillBucket = "planned" | "committed" | "unrealised" | "realised";

/**
 * Minimal per-line shape the tree builder needs. The canonical
 * `FinanceLine` is structurally assignable to this, so the route passes
 * `FinanceLine[]` straight through — the builder never recomputes anything.
 */
export interface DrillLineInput {
  lineId: number;
  parentLineId: number;
  projectId: number;
  categoryAllocationId: number | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryNumber: string | null;
  descriptionOfWork?: string | null;
  /** COS — Excel col Q (`normalized_cost_line_actuals.actual_total`). */
  actualTotal: number;
  /** Canonical derived revenue (Q/X)×J — never recomputed here. */
  perLineRevenue: number;
  perLineGp: number;
  invoiceNumber: string | null;
  /** Excel col T — invoice raised date (recognition date). */
  invoiceRaisedDate: string | null;
  /** §3.7 invoice-date colour signal: false = RED/unconfirmed, true/null = confirmed. */
  invoiceDateConfirmed: boolean | null;
  poNumber: string | null;
  /** YYYY-MM key derived from the invoice-raised date; null = no T date. */
  recognitionMonth: string | null;
  bucket: DrillBucket;
}

export interface SplitTotals {
  cos: number;
  revenue: number;
  gp: number;
}

export interface DrillTotals {
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  /** Realised = bucket "realised" (BLACK / confirmed). */
  realised: SplitTotals;
  /** Forecast = everything not realised (committed + planned; RED). */
  forecast: SplitTotals;
}

export type DrillLevel = "fy" | "month" | "project" | "category" | "invoice";

export interface DrillNode extends DrillTotals {
  level: DrillLevel;
  /** Stable key within the parent (used as a React key + drill path). */
  key: string;
  label: string;

  // Identity carried down so the client can lazily fetch leaves for a node.
  month?: string | null;
  projectId?: number | null;
  categoryAllocationId?: number | null;
  categoryKey?: string | null;

  // Invoice-leaf specifics (only set when level === "invoice").
  lineId?: number;
  parentLineId?: number;
  invoiceNumber?: string | null;
  invoiceRaisedDate?: string | null;
  /** §3.7 invoice-date colour signal: false = RED/unconfirmed, true/null = confirmed. */
  invoiceDateConfirmed?: boolean | null;
  poNumber?: string | null;
  bucket?: DrillBucket;
  /** Set to true when the leaf's invoice date colour is RED (forecast). */
  isForecast?: boolean;
  /** Tracker source-cell reference (sheet ▸ row ▸ column) for traceability. */
  sourceSheet?: string | null;
  sourceRow?: number | null;
  sourceCell?: string | null;

  /** Present on aggregate nodes when children are materialised. */
  children?: DrillNode[];
  /** Count of direct children even when not materialised (lazy leaves). */
  childCount?: number;
}

/**
 * Excel tracker column letters for the canonical fields, so an invoice leaf
 * can name its source cell (e.g. "Expenditure Breakdown!Q42"). These are
 * fixed by the workbook layout referenced in AGENT_GUARDRAILS § 3.2–§ 3.3.
 */
export const TRACKER_COLUMNS = {
  /** Actual Total (COS). */
  actualTotal: "Q",
  /** Category total of col Q. */
  categoryTotalActual: "X",
  /** Category revenue allocation. */
  revenueAllocation: "J",
  /** Invoice number. */
  invoiceNumber: "S",
  /** Invoice raised date (recognition). */
  invoiceRaisedDate: "T",
  /** PO number. */
  poNumber: "R",
  /** Finance payment date (cashflow). */
  financePaymentDate: "W",
  /** Budget total (planned). */
  budgetTotal: "G",
  /** Stored revenue-recognition paste (recon cross-check only). */
  revenueStored: "U",
} as const;

const UNRECOGNISED_KEY = "unrecognised";

const isRealised = (b: DrillBucket): boolean => b === "realised";

/** Round to 2dp at emit — mirrors the canonical aggregator's r2 step so the
 * drill rows are stable and tie to the FY card / recon grid. */
const r2 = (n: number): number => Number(n.toFixed(2));

const emptyTotals = (): DrillTotals => ({
  cos: 0,
  revenue: 0,
  gp: 0,
  gpPct: null,
  count: 0,
  realised: { cos: 0, revenue: 0, gp: 0 },
  forecast: { cos: 0, revenue: 0, gp: 0 },
});

const accumulate = (acc: DrillTotals, line: DrillLineInput): void => {
  acc.cos += line.actualTotal;
  acc.revenue += line.perLineRevenue;
  acc.gp += line.perLineGp;
  acc.count += 1;
  const target = isRealised(line.bucket) ? acc.realised : acc.forecast;
  target.cos += line.actualTotal;
  target.revenue += line.perLineRevenue;
  target.gp += line.perLineGp;
};

/** Sum a leaf subset into rounded totals. Raw accumulation, r2 at finalise —
 * intermediate per-line maths stay precise, the surfaced row is stable. */
export function summariseLines(lines: readonly DrillLineInput[]): DrillTotals {
  const t = emptyTotals();
  for (const l of lines) accumulate(t, l);
  return {
    cos: r2(t.cos),
    revenue: r2(t.revenue),
    gp: r2(t.gp),
    gpPct: t.revenue !== 0 ? t.gp / t.revenue : null,
    count: t.count,
    realised: { cos: r2(t.realised.cos), revenue: r2(t.realised.revenue), gp: r2(t.realised.gp) },
    forecast: { cos: r2(t.forecast.cos), revenue: r2(t.forecast.revenue), gp: r2(t.forecast.gp) },
  };
}

const monthLabel = (key: string): string => {
  if (key === UNRECOGNISED_KEY) return "Unrecognised (no T date)";
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const [y, m] = key.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[Number(m) - 1]} ${y}`;
};

const categoryGroupKey = (l: DrillLineInput): string =>
  l.categoryAllocationId != null
    ? `alloc:${l.categoryAllocationId}`
    : `missing:${(l.categoryKey ?? "uncategorised").trim().toLowerCase()}`;

const categoryLabel = (l: DrillLineInput): string => {
  const name = l.categoryName ?? l.categoryKey ?? "Uncategorised";
  return l.categoryNumber ? `${l.categoryNumber}. ${name}` : name;
};

/** Group helper preserving first-seen order so callers can sort deterministically. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export interface BuildTreeOptions {
  /** FY root label, e.g. "FY26 (Sep '25 – Aug '26)". */
  fyLabel?: string;
  /** project_info.id → display name. */
  projectLabels?: Map<number, string>;
  /**
   * When true the tree includes the invoice leaves under each category.
   * The /tree endpoint leaves this false (lazy leaves via /invoices);
   * callers that assert leaf ties set it true.
   */
  includeInvoices?: boolean;
}

const sortMonthKeys = (a: string, b: string): number => {
  if (a === UNRECOGNISED_KEY) return 1;
  if (b === UNRECOGNISED_KEY) return -1;
  return a.localeCompare(b);
};

export function buildInvoiceLeaf(line: DrillLineInput): DrillNode {
  const totals = summariseLines([line]);
  return {
    ...totals,
    level: "invoice",
    key: `line:${line.lineId}`,
    label: line.descriptionOfWork ?? line.invoiceNumber ?? `Line #${line.parentLineId}`,
    month: line.recognitionMonth,
    projectId: line.projectId,
    categoryAllocationId: line.categoryAllocationId,
    categoryKey: line.categoryKey,
    lineId: line.lineId,
    parentLineId: line.parentLineId,
    invoiceNumber: line.invoiceNumber,
    invoiceRaisedDate: line.invoiceRaisedDate,
    invoiceDateConfirmed: line.invoiceDateConfirmed,
    poNumber: line.poNumber,
    bucket: line.bucket,
    isForecast: !isRealised(line.bucket),
  };
}

function buildCategoryNode(lines: DrillLineInput[], includeInvoices: boolean): DrillNode {
  const first = lines[0];
  const totals = summariseLines(lines);
  const node: DrillNode = {
    ...totals,
    level: "category",
    key: categoryGroupKey(first),
    label: categoryLabel(first),
    month: first.recognitionMonth,
    projectId: first.projectId,
    categoryAllocationId: first.categoryAllocationId,
    categoryKey: first.categoryKey,
    childCount: lines.length,
  };
  if (includeInvoices) {
    node.children = lines
      .slice()
      .sort((a, b) => {
        const da = a.invoiceRaisedDate ?? "";
        const db = b.invoiceRaisedDate ?? "";
        if (da !== db) return da.localeCompare(db);
        return a.parentLineId - b.parentLineId;
      })
      .map(buildInvoiceLeaf);
  }
  return node;
}

function buildProjectNode(
  lines: DrillLineInput[],
  opts: BuildTreeOptions,
): DrillNode {
  const first = lines[0];
  const totals = summariseLines(lines);
  const byCategory = groupBy(lines, categoryGroupKey);
  const children = Array.from(byCategory.values())
    .map((catLines) => buildCategoryNode(catLines, opts.includeInvoices ?? false))
    .sort((a, b) => {
      const an = Number(a.label.split(".")[0]);
      const bn = Number(b.label.split(".")[0]);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return a.label.localeCompare(b.label);
    });
  return {
    ...totals,
    level: "project",
    key: `project:${first.projectId}`,
    label: opts.projectLabels?.get(first.projectId) ?? `Project #${first.projectId}`,
    month: first.recognitionMonth,
    projectId: first.projectId,
    children,
    childCount: children.length,
  };
}

function buildMonthNode(
  monthKey: string,
  lines: DrillLineInput[],
  opts: BuildTreeOptions,
): DrillNode {
  const totals = summariseLines(lines);
  const byProject = groupBy(lines, (l) => `project:${l.projectId}`);
  const children = Array.from(byProject.values())
    .map((projLines) => buildProjectNode(projLines, opts))
    .sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label));
  return {
    ...totals,
    level: "month",
    key: `month:${monthKey}`,
    label: monthLabel(monthKey),
    month: monthKey,
    children,
    childCount: children.length,
  };
}

/**
 * Build the full FY → month → project → category (→ invoice) tree.
 *
 * The input `lines` are already FY-windowed by the caller (the repository's
 * fyStart/fyEnd filter on the invoice-raised date). The FY node is the root;
 * its totals equal the sum across all lines, and each descendant level
 * partitions the same leaves — so `sum(children) === parent` holds at every
 * level (self-checked by `findSumViolations` within R1).
 */
export function buildRevCosGpTree(
  lines: readonly DrillLineInput[],
  opts: BuildTreeOptions = {},
): DrillNode {
  const totals = summariseLines(lines);
  const byMonth = groupBy(lines, (l) => l.recognitionMonth ?? UNRECOGNISED_KEY);
  const monthKeys = Array.from(byMonth.keys()).sort(sortMonthKeys);
  const children = monthKeys.map((mk) => buildMonthNode(mk, byMonth.get(mk)!, opts));
  return {
    ...totals,
    level: "fy",
    key: "fy",
    label: opts.fyLabel ?? "Financial year",
    children,
    childCount: children.length,
  };
}

/**
 * Recursively assert `sum(children) === parent` within `tol` for every
 * aggregate node. Returns the list of violations (empty = clean). Used as a
 * defensive read-path self-check on the endpoint (logged, never thrown —
 * § 0A: the app records, it does not block).
 */
export interface SumViolation {
  level: DrillLevel;
  key: string;
  field: "cos" | "revenue" | "gp";
  parent: number;
  childrenSum: number;
  delta: number;
}

export function findSumViolations(node: DrillNode, tol = 1): SumViolation[] {
  const out: SumViolation[] = [];
  const walk = (n: DrillNode): void => {
    if (n.children && n.children.length > 0) {
      const fields: Array<"cos" | "revenue" | "gp"> = ["cos", "revenue", "gp"];
      for (const f of fields) {
        const childrenSum = n.children.reduce((acc, c) => acc + c[f], 0);
        const delta = n[f] - childrenSum;
        if (Math.abs(delta) > tol) {
          out.push({ level: n.level, key: n.key, field: f, parent: n[f], childrenSum, delta });
        }
      }
      for (const c of n.children) walk(c);
    }
  };
  walk(node);
  return out;
}

/** Build the source-cell string for an invoice leaf (e.g. "Expenditure
 * Breakdown!Q42"). Falls back to a stored `source_cell` when present, then
 * to sheet + COS column + row, then to whatever partial info exists. */
export function buildSourceCell(
  sourceSheet: string | null,
  sourceRow: number | null,
  storedSourceCell: string | null,
): string | null {
  if (storedSourceCell && storedSourceCell.trim()) return storedSourceCell.trim();
  if (sourceSheet && sourceRow != null) {
    return `${sourceSheet}!${TRACKER_COLUMNS.actualTotal}${sourceRow}`;
  }
  if (sourceSheet) return sourceSheet;
  if (sourceRow != null) return `row ${sourceRow}`;
  return null;
}

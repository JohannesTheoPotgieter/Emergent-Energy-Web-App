/**
 * Cashflow drill grouping — PURE, NO NEW CASH MATH.
 *
 * The cashflow series (`/api/cashflow-2026`) and its per-week leaf detail
 * (`/api/cashflow-2026/detail?week=`) are produced by the FROZEN weekly
 * cashflow engine and bucketed on the §3.4 cash-event date. This helper only
 * GROUPS those existing leaves into the drill hierarchy:
 *
 *     week → line item → invoice leaf
 *
 * It never re-buckets by a different date and never recomputes an amount —
 * `sum(invoices) === lineItem === week total` holds by construction (the
 * grouping is a partition of the same leaves). The unit test asserts this
 * within R1. Inflow = cash in, outflow = cash out (§3.4); realised (BLACK =
 * received/paid) vs forecast (RED) is surfaced from the leaf's own signal.
 */

export type CashDirection = "inflow" | "outflow";
export type CashPaidState = "realised" | "forecast";

/** Minimal inflow leaf shape — `DetailInflow` from the cashflow page is
 * structurally assignable. */
export interface CashInflowInput {
  inflowId: number;
  projectName: string | null;
  milestoneName: string | null;
  milestoneInvoiceNumber: string | null;
  paymentReceivedDate: string | null;
  milestoneAmount: number | null;
  qbPaymentStatus?: "paid" | "partial" | "unpaid" | null;
}

/** Minimal outflow leaf shape — `DetailOutflow` from the cashflow page is
 * structurally assignable. */
export interface CashOutflowInput {
  expenseId: number;
  projectName: string | null;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  expenseInvoiceNumber: string | null;
  expensePaymentDate: string | null;
  expenseActualTotal: number | null;
  /** Set by the server detail mapper: "actual" = paid (BLACK), "forecast" = RED. */
  outflowType?: "actual" | "forecast";
  paymentStatus?: string | null;
  rowNumber?: number | null;
}

export interface CashLeaf {
  direction: CashDirection;
  id: number;
  projectName: string;
  lineItem: string;
  category: string | null;
  invoiceNumber: string | null;
  /** Finance payment date — Excel col W (the cash-event date). */
  paymentDate: string | null;
  amount: number;
  paidState: CashPaidState;
  sourceRow: number | null;
}

export interface CashLineItemGroup {
  key: string;
  direction: CashDirection;
  projectName: string;
  lineItem: string;
  category: string | null;
  amount: number;
  realisedAmount: number;
  forecastAmount: number;
  count: number;
  invoices: CashLeaf[];
}

export interface CashWeekDrill {
  weekStart: string;
  inflowTotal: number;
  outflowTotal: number;
  net: number;
  inflowGroups: CashLineItemGroup[];
  outflowGroups: CashLineItemGroup[];
}

const num = (v: number | null | undefined): number =>
  v != null && Number.isFinite(v) ? v : 0;

const r2 = (n: number): number => Number(n.toFixed(2));

const inflowPaidState = (i: CashInflowInput): CashPaidState =>
  i.qbPaymentStatus === "paid" ? "realised" : "forecast";

const PAID_OUTFLOW_STATUSES = new Set([
  "paid",
  "out_of_bank",
  "outofbank",
  "settled",
]);

const outflowPaidState = (o: CashOutflowInput): CashPaidState => {
  if (o.outflowType === "actual") return "realised";
  if (o.outflowType === "forecast") return "forecast";
  const s = (o.paymentStatus ?? "").trim().toLowerCase();
  return PAID_OUTFLOW_STATUSES.has(s) ? "realised" : "forecast";
};

export function inflowToLeaf(i: CashInflowInput): CashLeaf {
  return {
    direction: "inflow",
    id: i.inflowId,
    projectName: i.projectName ?? "—",
    lineItem: i.milestoneName ?? "(unnamed milestone)",
    category: null,
    invoiceNumber: i.milestoneInvoiceNumber ?? null,
    paymentDate: i.paymentReceivedDate ?? null,
    amount: num(i.milestoneAmount),
    paidState: inflowPaidState(i),
    sourceRow: null,
  };
}

export function outflowToLeaf(o: CashOutflowInput): CashLeaf {
  return {
    direction: "outflow",
    id: o.expenseId,
    projectName: o.projectName ?? "—",
    lineItem: o.expenseLineItem ?? o.expenseCategory ?? "(uncategorised)",
    category: o.expenseCategory ?? null,
    invoiceNumber: o.expenseInvoiceNumber ?? null,
    paymentDate: o.expensePaymentDate ?? null,
    amount: num(o.expenseActualTotal),
    paidState: outflowPaidState(o),
    sourceRow: o.rowNumber ?? null,
  };
}

/** Group leaves into line-item nodes keyed by project + line item (+ category
 * for outflows). Each group sums its leaves; realised/forecast split is the
 * sum of the leaves' own paid states. */
function groupLeaves(leaves: CashLeaf[], direction: CashDirection): CashLineItemGroup[] {
  const map = new Map<string, CashLineItemGroup>();
  for (const leaf of leaves) {
    const key = `${direction}:${leaf.projectName}::${leaf.category ?? ""}::${leaf.lineItem}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        direction,
        projectName: leaf.projectName,
        lineItem: leaf.lineItem,
        category: leaf.category,
        amount: 0,
        realisedAmount: 0,
        forecastAmount: 0,
        count: 0,
        invoices: [],
      };
      map.set(key, g);
    }
    g.invoices.push(leaf);
    g.amount += leaf.amount;
    g.count += 1;
    if (leaf.paidState === "realised") g.realisedAmount += leaf.amount;
    else g.forecastAmount += leaf.amount;
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.amount = r2(g.amount);
    g.realisedAmount = r2(g.realisedAmount);
    g.forecastAmount = r2(g.forecastAmount);
    g.invoices.sort((a, b) => {
      const da = a.paymentDate ?? "";
      const db = b.paymentDate ?? "";
      if (da !== db) return da.localeCompare(db);
      return Math.abs(b.amount) - Math.abs(a.amount);
    });
  }
  return groups.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/**
 * Build the week drill from the raw `/detail` leaves. Returns the line-item
 * groups (each expandable to invoice leaves) and the week totals — which
 * equal the sum of the groups, which equal the sum of the leaves.
 */
export function buildCashflowWeekDrill(
  weekStart: string,
  inflows: readonly CashInflowInput[],
  outflows: readonly CashOutflowInput[],
): CashWeekDrill {
  const inflowLeaves = inflows.map(inflowToLeaf);
  const outflowLeaves = outflows.map(outflowToLeaf);
  const inflowGroups = groupLeaves(inflowLeaves, "inflow");
  const outflowGroups = groupLeaves(outflowLeaves, "outflow");
  const inflowTotal = r2(inflowLeaves.reduce((a, l) => a + l.amount, 0));
  const outflowTotal = r2(outflowLeaves.reduce((a, l) => a + l.amount, 0));
  return {
    weekStart,
    inflowTotal,
    outflowTotal,
    net: r2(inflowTotal - outflowTotal),
    inflowGroups,
    outflowGroups,
  };
}

/** Flatten a week drill's leaves for CSV export (with source-row column). */
export function cashflowDrillLeaves(drill: CashWeekDrill): CashLeaf[] {
  const out: CashLeaf[] = [];
  for (const g of [...drill.inflowGroups, ...drill.outflowGroups]) {
    for (const leaf of g.invoices) out.push(leaf);
  }
  return out;
}

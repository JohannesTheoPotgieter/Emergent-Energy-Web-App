/**
 * QuickBooks P&L → company-level Revenue / COS / GP totals.
 *
 * Pure parser, kept in its own focused module (rather than the 2.7k-LOC
 * quickbooks-reconciliation-service.ts) so the company-level tracker-vs-QB
 * comparison can consume it without growing that file.
 *
 * QB cost bills aren't project-tagged, so COS/GP only reconcile to QuickBooks at
 * the COMPANY level — this is the grain the comparison runs at (§ 3.4; the app
 * compares and flags, it never adjusts a tracker).
 */

export interface QbPnLCompanyTotals {
  revenue: number | null;
  cos: number | null;
  gp: number | null;
}

/**
 * Company-level totals from a QB ProfitAndLoss report (the single "Total" column
 * form — no `summarize_column_by`). Reads each section's Summary row: `group`
 * "Income" → revenue, "COS"/"CostOfGoodsSold" → cos, "GrossProfit" → gp.
 * Returns null for any section the report omits, and is null-safe on a malformed
 * report.
 */
export function parsePnLCompanyTotals(report: unknown): QbPnLCompanyTotals {
  const rows: unknown[] = Array.isArray((report as { Rows?: { Row?: unknown[] } })?.Rows?.Row)
    ? (report as { Rows: { Row: unknown[] } }).Rows.Row
    : [];

  // Last non-empty numeric cell of a section's Summary row (the Total column).
  const summaryTotal = (row: unknown): number | null => {
    const cols: Array<{ value?: unknown }> =
      (row as { Summary?: { ColData?: Array<{ value?: unknown }> } })?.Summary?.ColData ?? [];
    for (let i = cols.length - 1; i >= 1; i--) {
      const raw = cols[i]?.value;
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;
      const n = parseFloat(String(raw));
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const findSection = (groups: string[], headerNeedles: string[]): unknown => {
    const groupSet = new Set(groups.map((g) => g.toLowerCase()));
    return rows.find((r) => {
      const g = String((r as { group?: unknown })?.group ?? "").toLowerCase();
      if (groupSet.has(g)) return true;
      const header = String(
        (r as { Header?: { ColData?: Array<{ value?: unknown }> } })?.Header?.ColData?.[0]?.value ?? "",
      ).toLowerCase();
      return headerNeedles.some((needle) => header.includes(needle));
    });
  };

  const incomeRow = findSection(["Income"], ["total income", "income"]);
  const cosRow = findSection(["COS", "CostOfGoodsSold"], ["cost of sales", "cost of goods sold"]);
  const gpRow = findSection(["GrossProfit"], ["gross profit"]);

  return {
    revenue: incomeRow ? summaryTotal(incomeRow) : null,
    cos: cosRow ? summaryTotal(cosRow) : null,
    gp: gpRow ? summaryTotal(gpRow) : null,
  };
}

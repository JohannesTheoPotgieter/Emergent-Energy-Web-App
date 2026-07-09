/**
 * Board-ready export (item 7) for Finance Home.
 *
 * Serialises figures ALREADY computed on the page (KPIs + monthly budget /
 * planned / realised / QB + variance + on-track) into a labelled, ex-VAT,
 * as-at-stamped CSV or XLSX. Reuses the canonical client export primitives
 * (`downloadCsv` + dynamic `exceljs`) — it computes no finance number, it only
 * re-serialises what the dashboard shows.
 */
import { downloadCsv } from "@/lib/table-utils";

export interface BoardExportKpi {
  metric: string;
  value: string;
}

export interface BoardExportMonthlyRow {
  month: string;
  budget: number;
  planned: number;
  realised: number;
  qb: number;
  /** Realised − budget for the month. */
  variance: number;
  cumRealised: number;
  cumBudget: number;
  /** Cumulative realised − cumulative budget (ahead = positive). */
  onTrackGap: number;
}

export interface BoardExportModel {
  fyLabel: string;
  /** e.g. "Last closed month (Jun 26)" or "Incl. open month". */
  asAtLabel: string;
  /** Provenance line — always "ex-VAT · canonical line-level ledger". */
  basis: string;
  kpis: BoardExportKpi[];
  monthly: BoardExportMonthlyRow[];
}

const MONTHLY_HEADERS = [
  "Period",
  "Budget (R, ex-VAT)",
  "Planned (R, ex-VAT)",
  "Realised (R, ex-VAT)",
  "QuickBooks (R, ex-VAT)",
  "Variance vs budget (R)",
  "Cumulative realised (R)",
  "Cumulative budget (R)",
  "On-track gap (R)",
];

function monthlyCells(r: BoardExportMonthlyRow): Array<string | number> {
  return [
    r.month,
    r.budget,
    r.planned,
    r.realised,
    r.qb,
    r.variance,
    r.cumRealised,
    r.cumBudget,
    r.onTrackGap,
  ];
}

/** Stacked CSV: metadata → KPI block → monthly block. */
export function exportBoardCsv(model: BoardExportModel, filename: string): void {
  const rows: Array<Array<string | number | null>> = [];
  rows.push(["Finance Home — board figures"]);
  rows.push(["Financial year", model.fyLabel]);
  rows.push(["As at", model.asAtLabel]);
  rows.push(["Basis", model.basis]);
  rows.push([]);
  rows.push(["KPI", "Value"]);
  for (const k of model.kpis) rows.push([k.metric, k.value]);
  rows.push([]);
  rows.push(MONTHLY_HEADERS);
  for (const m of model.monthly) rows.push(monthlyCells(m));
  // downloadCsv writes [headers, ...rows]; use the title line as the header row.
  const [head, ...body] = rows;
  downloadCsv(filename, (head as string[]) ?? [], body);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Two-sheet XLSX: "Summary" (metadata + KPIs) and "Monthly" (the by-period table). */
export async function exportBoardXlsx(model: BoardExportModel, filename: string): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();

  const summary = wb.addWorksheet("Summary");
  summary.addRow(["Finance Home — board figures"]).font = { bold: true };
  summary.addRow(["Financial year", model.fyLabel]);
  summary.addRow(["As at", model.asAtLabel]);
  summary.addRow(["Basis", model.basis]);
  summary.addRow([]);
  const kpiHead = summary.addRow(["KPI", "Value"]);
  kpiHead.font = { bold: true };
  kpiHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  for (const k of model.kpis) summary.addRow([k.metric, k.value]);
  summary.getColumn(1).width = 34;
  summary.getColumn(2).width = 26;

  const monthly = wb.addWorksheet("Monthly");
  const monthlyHead = monthly.addRow(MONTHLY_HEADERS);
  monthlyHead.font = { bold: true };
  monthlyHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  for (const m of model.monthly) monthly.addRow(monthlyCells(m));
  MONTHLY_HEADERS.forEach((_, i) => {
    monthly.getColumn(i + 1).width = i === 0 ? 12 : 20;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

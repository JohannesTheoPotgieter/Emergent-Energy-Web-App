/**
 * Table data export utilities — CSV and Excel support.
 * Uses native CSV generation and ExcelJS for .xlsx files.
 */

export interface ExportColumn {
  key: string;
  header: string;
  /**
   * Optional value accessor. When provided it overrides the dot-path lookup —
   * use it for computed / formatted columns whose value isn't a plain field on
   * the row (e.g. GP = revenue − cos, a percentage, a status label). Return a
   * primitive; null / undefined export as an empty cell.
   */
  value?: (row: any) => string | number | boolean | null | undefined;
}

function getNestedValue(obj: any, key: string): string {
  const val = key.split(".").reduce((o, k) => o?.[k], obj);
  if (val == null) return "";
  if (val instanceof Date) return val.toISOString().split("T")[0];
  return String(val);
}

/** Resolve a single cell to its export string — accessor first, dot-path otherwise. */
function resolveCell(row: any, col: ExportColumn): string {
  if (col.value) {
    const val = col.value(row);
    if (val == null) return "";
    return String(val);
  }
  return getNestedValue(row, col.key);
}

function escapeCSV(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function exportToCSV(data: any[], columns: ExportColumn[], filename: string) {
  const header = columns.map(c => escapeCSV(c.header)).join(",");
  const rows = data.map(row =>
    columns.map(c => escapeCSV(resolveCell(row, c))).join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${filename}.csv`);
}

export async function exportToExcel(data: any[], columns: ExportColumn[], filename: string) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Data");

  sheet.columns = columns.map(c => ({
    header: c.header,
    key: c.key,
    width: Math.max(c.header.length + 4, 15),
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8E8E8" },
  };

  for (const item of data) {
    const rowData: Record<string, string> = {};
    for (const col of columns) {
      rowData[col.key] = resolveCell(item, col);
    }
    sheet.addRow(rowData);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, `${filename}.xlsx`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

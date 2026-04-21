import { initializeDatabase } from "../server/db";
async function main() {
  await initializeDatabase();
  const { getMonthlyPnLReport } = await import("../server/services/quickbooks-service");
  try {
    const r: any = await getMonthlyPnLReport("2025-09-01", "2026-08-31");
    if (!r) { console.log("NULL response"); return; }
    const cols = (r?.Columns?.Column ?? []).map((c: any, i: number) => ({
      i,
      title: c?.ColTitle,
      start: c?.MetaData?.find((m: any) => m?.Name === "StartDate")?.Value ?? null,
    }));
    console.log("COLS:", JSON.stringify(cols, null, 2));
    const lines: string[] = [];
    const walk = (row: any, depth = 0) => {
      if (!row) return;
      const h = row?.Header?.ColData?.[0];
      const d = Array.isArray(row?.ColData) ? row.ColData[0] : null;
      const indent = "  ".repeat(depth);
      if (h) {
        const sumCells = row?.Summary?.ColData ?? [];
        const totalCell = sumCells[sumCells.length - 1]?.value;
        lines.push(`${indent}[Section] id=${h.id ?? ""} name="${h.value ?? ""}" total=${totalCell ?? ""}`);
      }
      if (d) {
        const last = row.ColData[row.ColData.length - 1]?.value;
        lines.push(`${indent}[${row.type ?? "?"}] id=${d.id ?? ""} name="${d.value ?? ""}" total=${last ?? ""}`);
      }
      for (const c of row?.Rows?.Row ?? []) walk(c, depth + 1);
    };
    for (const r2 of r?.Rows?.Row ?? []) walk(r2);
    console.log("ROWS:");
    console.log(lines.join("\n"));
  } catch (e) {
    console.error("FAIL:", (e as Error)?.message);
  }
  process.exit(0);
}
main();

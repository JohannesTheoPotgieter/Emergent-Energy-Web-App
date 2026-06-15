import { db, initializeDatabase } from "../db";
import { categoryRevenueAllocations, normalizedCostLines, projectInfo } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
const m = (n: number) => Math.round(n).toLocaleString("en-ZA");

async function main() {
  await initializeDatabase();
  const projects = await db.select({ id: projectInfo.id, name: projectInfo.projectName })
    .from(projectInfo).where(isNull(projectInfo.deletedAt));
  console.log(pad("PROJECT", 30) + pad("#alloc", 7) + pad("#allocJ", 8) + pad("sumJ", 16) + pad("#costLn", 8) + pad("#linked", 8) + "  mode");
  console.log("-".repeat(95));
  const tally: Record<string, number> = {};
  for (const p of projects) {
    const allocs = await db.select().from(categoryRevenueAllocations)
      .where(and(eq(categoryRevenueAllocations.projectId, p.id), isNull(categoryRevenueAllocations.effectiveTo)));
    const allocJ = allocs.filter((a: any) => a.revenueAllocation != null && Number(a.revenueAllocation) !== 0);
    const sumJ = allocJ.reduce((s: number, a: any) => s + Number(a.revenueAllocation), 0);
    const costLn = await db.select({ id: normalizedCostLines.id, caid: normalizedCostLines.categoryAllocationId })
      .from(normalizedCostLines).where(and(eq(normalizedCostLines.projectId, p.id), isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)));
    const linked = costLn.filter((c: any) => c.caid != null).length;
    if (costLn.length === 0) continue;
    let mode = "OK";
    if (allocs.length === 0) mode = "NO_ALLOC";
    else if (sumJ === 0) mode = "ZERO_J";
    else if (linked === 0) mode = "UNLINKED";
    else if (linked < costLn.length) mode = "PARTIAL_LINK";
    tally[mode] = (tally[mode] ?? 0) + 1;
    if (mode !== "OK")
      console.log(pad(p.name ?? `#${p.id}`, 30) + pad(String(allocs.length), 7) + pad(String(allocJ.length), 8) + pad(m(sumJ), 16) + pad(String(costLn.length), 8) + pad(String(linked), 8) + "  " + mode);
  }
  console.log("-".repeat(95));
  console.log("failure-mode tally:", JSON.stringify(tally));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

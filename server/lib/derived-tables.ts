import { db } from "../db";
import { isNull } from "drizzle-orm";
import {
  projectInfo,
  normalizedCostLines,
  normalizedRevenueLines,
  derivedProjectKpis,
  derivedPortfolioKpis,
  derivedRagSummary,
} from "@shared/schema";

function safeNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function rebuildDerivedTables(): Promise<void> {
  const projects = await db.select().from(projectInfo);
  const allCosts = await db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo));
  const allRevenue = await db.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo));

  await db.delete(derivedProjectKpis);
  await db.delete(derivedPortfolioKpis);
  await db.delete(derivedRagSummary);

  let totalBudget = 0, totalSpend = 0, totalRevRealised = 0;
  const today = new Date().toISOString().split("T")[0];

  for (const proj of projects) {
    const projCosts = allCosts.filter(c => c.projectId === proj.id);
    const projRevenue = allRevenue.filter(r => r.projectId === proj.id);

    const totalCostBudget = projCosts.reduce((s, c) => s + safeNum(c.amountExVat), 0);
    const costPaid = projCosts
      .filter(c => c.paidDate && c.paidDate <= today)
      .reduce((s, c) => s + safeNum(c.amountExVat), 0);
    const cosRealised = projCosts
      .filter(c => c.cosRealised)
      .reduce((s, c) => s + safeNum(c.amountExVat), 0);
    const totalRevenuePlanned = projRevenue.reduce((s, r) => s + safeNum(r.amountExVat), 0);
    const revenueRealised = projRevenue
      .filter(r => (r.paidDate && r.paidDate <= today) || (r.inBankDate && r.inBankDate <= today))
      .reduce((s, r) => s + safeNum(r.amountExVat), 0);

    const contractValue = safeNum(proj.contractValue);
    const projBudget = contractValue > 0 ? contractValue : totalRevenuePlanned;

    totalBudget += projBudget;
    totalSpend += costPaid;
    totalRevRealised += revenueRealised;

    await db.insert(derivedProjectKpis).values({
      projectKey: proj.projectName,
      projectName: proj.projectName,
      projectPhase: (proj as any).projectPhase || "UNKNOWN",
      totalRevenue: String(totalRevenuePlanned),
      revenueRealised: String(revenueRealised),
      totalCostBudget: String(totalCostBudget),
      totalCostActual: String(costPaid),
      cosRealised: String(cosRealised),
      grossProfit: String(revenueRealised - costPaid),
      grossProfitPct: totalRevenuePlanned > 0 ? String(((revenueRealised - costPaid) / totalRevenuePlanned) * 100) : "0",
      scheduleRag: "GREEN",
      costRag: costPaid > totalCostBudget ? "RED" : costPaid > totalCostBudget * 0.9 ? "AMBER" : "GREEN",
      qualityRag: "GREEN",
      needsReview: false,
    });
  }

  await db.insert(derivedPortfolioKpis).values({
    snapshotKey: "current",
    totalProgramBudget: String(totalBudget),
    actualSpendPaid: String(totalSpend),
    revenueRealised: String(totalRevRealised),
    activeProjectsCount: projects.length,
    grossProfit: String(totalRevRealised - totalSpend),
    grossProfitPct: totalBudget > 0 ? String(((totalRevRealised - totalSpend) / totalBudget) * 100) : "0",
  });

  const ragCounts: Record<string, { count: number; value: number }> = { GREEN: { count: 0, value: 0 }, AMBER: { count: 0, value: 0 }, RED: { count: 0, value: 0 } };
  const projKpis = await db.select().from(derivedProjectKpis);
  for (const k of projKpis) {
    const rag = k.costRag || "GREEN";
    if (ragCounts[rag]) {
      ragCounts[rag].count++;
      ragCounts[rag].value += safeNum(k.totalRevenue);
    }
  }

  for (const [status, data] of Object.entries(ragCounts)) {
    if (data.count > 0) {
      await db.insert(derivedRagSummary).values({
        ragStatus: status,
        projectCount: data.count,
        totalContractValue: String(data.value),
      });
    }
  }
}

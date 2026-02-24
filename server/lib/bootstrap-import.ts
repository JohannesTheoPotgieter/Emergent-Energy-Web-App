import crypto from "crypto";
import ExcelJS from "exceljs";
import { db } from "../db";
import { eq, sql, and, desc } from "drizzle-orm";
import {
  bootstrapImportRuns,
  stagingBootstrapProjects,
  projectInfo,
  normalizedPlanTasks,
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedExecutionPhases,
  smartImportRuns,
  derivedProjectKpis,
  derivedPortfolioKpis,
  derivedRagSummary,
  appSettings,
  projectPlan,
  programExpense,
  programInflows,
} from "@shared/schema";
import { runSmartImportPreview } from "./import/index";

function computeFileHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function extractProjectNameFromFilename(fileName: string): string {
  let name = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  const trackerIdx = name.toLowerCase().indexOf("tracker");
  if (trackerIdx > 0) name = name.substring(0, trackerIdx);
  name = name.replace(/[_\-]+/g, " ").replace(/[^a-zA-Z0-9\s]/g, "").trim();
  name = name.replace(/\s+/g, " ");
  return name || "Untitled Project";
}

function safeNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface ProjectPreview {
  projectName: string;
  projectInfo: {
    contractValue: string | null;
    systemSize: string | null;
    clientName: string | null;
    projectPhase: string | null;
    location: string | null;
  } | null;
  planTaskCount: number;
  revenueLineCount: number;
  costLineCount: number;
  executionPhaseCount: number;
  counterpartyNames: string[];
  issues: Array<{
    severity: string;
    section: string;
    message: string;
  }>;
  hasBlockers: boolean;
  sheetsFound: string[];
  fileHash: string;
  cosRealisedCount: number;
  cashflowConfirmedCount: number;
}

export async function previewTrackerUpload(
  buffer: Buffer,
  fileName: string
): Promise<ProjectPreview> {
  const hash = computeFileHash(buffer);
  const extractedName = extractProjectNameFromFilename(fileName);

  const preview = await runSmartImportPreview(buffer, fileName);

  const info = preview.detection.projectInfo;
  const projectName = extractedName;
  const norm = preview.normalization;

  const cosRealisedCount = norm.costLines.filter((c: any) => c.cosRealised).length;
  const cashflowConfirmedCount = norm.costLines.filter((c: any) => c.cashflowConfirmed).length;

  return {
    projectName,
    projectInfo: info ? {
      contractValue: info.contractValue || null,
      systemSize: info.sizeKwp || null,
      clientName: info.pd || null,
      projectPhase: info.phase || null,
      location: null,
    } : null,
    planTaskCount: norm.planTasks?.length || 0,
    revenueLineCount: norm.revenueLines?.length || 0,
    costLineCount: norm.costLines?.length || 0,
    executionPhaseCount: norm.executionPhases?.length || 0,
    counterpartyNames: norm.counterpartyNames || [],
    issues: (norm.issues || []).map((i: any) => ({
      severity: i.severity,
      section: i.section,
      message: i.message,
    })),
    hasBlockers: preview.hasBlockers || false,
    sheetsFound: preview.detection.sections.map((s: any) => `${s.section}:${s.sheetName}`),
    fileHash: hash,
    cosRealisedCount,
    cashflowConfirmedCount,
  };
}

export async function commitProjectFromTracker(
  buffer: Buffer,
  fileName: string,
  overrideProjectName?: string,
  userId?: number
): Promise<{ projectId: number; importRunId: number; summary: any }> {
  const hash = computeFileHash(buffer);
  const preview = await runSmartImportPreview(buffer, fileName);
  const norm = preview.normalization;
  const detection = preview.detection;

  const detectedInfo = detection.projectInfo;
  const projectName = overrideProjectName || detectedInfo?.name || extractProjectNameFromFilename(fileName);

  const existing = await db.select({ id: projectInfo.id }).from(projectInfo)
    .where(eq(projectInfo.projectName, projectName)).limit(1);
  if (existing.length > 0) {
    throw new Error(`Project "${projectName}" already exists (ID: ${existing[0].id}). Use a different name or delete the existing project first.`);
  }

  const [importRun] = await db.insert(smartImportRuns).values({
    sourceFileName: fileName,
    sourceFileHash: hash,
    status: "COMMITTED" as any,
    uploadedBy: userId || null,
    projectName,
  }).returning();

  const [project] = await db.insert(projectInfo).values({
    projectName,
    phase: detectedInfo?.phase || "PLANNING",
    sizeKwp: detectedInfo?.sizeKwp || null,
    pd: detectedInfo?.pd || null,
    contractValue: detectedInfo?.contractValue || null,
  } as any).returning();

  let planCount = 0, revCount = 0, costCount = 0, phaseCount = 0;

  if (norm.planTasks && norm.planTasks.length > 0) {
    const planBatch = norm.planTasks.map((t: any) => ({
      projectId: project.id,
      projectName,
      taskName: t.taskName,
      phase: t.phase,
      startDate: t.startDate,
      endDate: t.endDate,
      durationDays: t.durationDays,
      actualStartDate: t.actualStartDate,
      actualEndDate: t.actualEndDate,
      actualDurationDays: t.actualDurationDays,
      owner: t.owner,
      status: t.status,
      pctComplete: t.pctComplete != null ? String(t.pctComplete) : null,
      comment: t.comment,
      sourceSheet: t.sourceSheet,
      sourceRow: t.sourceRow,
      importRunId: importRun.id,
    }));
    for (let i = 0; i < planBatch.length; i += 100) {
      await db.insert(normalizedPlanTasks).values(planBatch.slice(i, i + 100));
    }
    planCount = planBatch.length;

    const legacyPlanBatch = norm.planTasks.map((t: any, idx: number) => ({
      projectName,
      rowNumber: t.sourceRow || (idx + 1),
      taskNo: String(idx + 1),
      highLevelProgramme: t.taskName,
      actualStart: t.startDate || t.actualStartDate || null,
      durationDays: t.durationDays || null,
      actualEnd: t.endDate || t.actualEndDate || null,
      actualPctComplete: t.pctComplete != null ? Number(t.pctComplete) : null,
      expectedPctComplete: null,
    }));
    for (let i = 0; i < legacyPlanBatch.length; i += 100) {
      await db.insert(projectPlan).values(legacyPlanBatch.slice(i, i + 100));
    }
  }

  if (norm.revenueLines && norm.revenueLines.length > 0) {
    const revBatch = norm.revenueLines.map((r: any) => ({
      projectId: project.id,
      projectName,
      description: r.description,
      milestoneName: r.milestoneName,
      amountExVat: r.amountExVat,
      vat: r.vat,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      invoiceDateFontColor: r.invoiceDateFontColor,
      invoiceDateConfirmed: r.invoiceDateConfirmed,
      expectedPaymentDate: r.expectedPaymentDate,
      paidDate: r.paidDate,
      paidDateFontColor: r.paidDateFontColor,
      paidDateConfirmed: r.paidDateConfirmed,
      inBankDate: r.inBankDate,
      status: r.status,
      sourceSheet: r.sourceSheet,
      sourceRow: r.sourceRow,
      importRunId: importRun.id,
      turnaroundDays: r.turnaroundDays,
    }));
    for (let i = 0; i < revBatch.length; i += 100) {
      await db.insert(normalizedRevenueLines).values(revBatch.slice(i, i + 100));
    }
    revCount = revBatch.length;

    const legacyRevBatch = norm.revenueLines.map((r: any, idx: number) => ({
      projectName,
      rowNumber: r.sourceRow || (idx + 1),
      milestoneNo: String(idx + 1),
      milestoneName: r.milestoneName || r.description || null,
      milestoneAmount: r.amountExVat || null,
      plannedPaymentDate: r.expectedPaymentDate || null,
      milestoneInvoiceNumber: r.invoiceNumber || null,
      invoiceRaisedDate: r.invoiceDate || null,
      paymentReceivedDate: r.paidDate || null,
      inBank: r.inBankDate ? 1 : 0,
    }));
    for (let i = 0; i < legacyRevBatch.length; i += 100) {
      await db.insert(programInflows).values(legacyRevBatch.slice(i, i + 100));
    }
  }

  if (norm.costLines && norm.costLines.length > 0) {
    const costBatch = norm.costLines.map((c: any) => ({
      projectId: project.id,
      projectName,
      costCategory: c.costCategory,
      counterpartyName: c.counterpartyName,
      description: c.description,
      amountExVat: c.amountExVat,
      invoiceNumber: c.invoiceNumber,
      invoiceDate: c.invoiceDate,
      invoiceDateFontColor: c.invoiceDateFontColor,
      invoiceDateConfirmed: c.invoiceDateConfirmed,
      approvedDate: c.approvedDate,
      paidDate: c.paidDate,
      paidDateFontColor: c.paidDateFontColor,
      paidDateConfirmed: c.paidDateConfirmed,
      poNumber: c.poNumber,
      cosRealised: c.cosRealised,
      cashflowConfirmed: c.cashflowConfirmed,
      status: c.status,
      sourceSheet: c.sourceSheet,
      sourceRow: c.sourceRow,
      importRunId: importRun.id,
      turnaroundDays: c.turnaroundDays,
    }));
    for (let i = 0; i < costBatch.length; i += 100) {
      await db.insert(normalizedCostLines).values(costBatch.slice(i, i + 100));
    }
    costCount = costBatch.length;

    const legacyCostBatch = norm.costLines.map((c: any, idx: number) => ({
      projectName,
      rowNumber: c.sourceRow || (idx + 1),
      rowType: "item" as const,
      expenseCategory: c.costCategory || null,
      expenseLineItem: c.description || null,
      expenseActualTotal: c.amountExVat || null,
      expensePoNumber: c.poNumber || null,
      expenseInvoiceNumber: c.invoiceNumber || null,
      expenseInvoicedDate: c.invoiceDate || null,
      invoiceDateConfirmed: c.invoiceDateConfirmed || false,
      invoiceDateFontColor: c.invoiceDateFontColor || null,
      expensePaymentDate: c.paidDate || null,
      paymentDateConfirmed: c.paidDateConfirmed || false,
      paymentDateFontColor: c.paidDateFontColor || null,
      supplierName: c.counterpartyName || null,
    } as any));
    for (let i = 0; i < legacyCostBatch.length; i += 100) {
      await db.insert(programExpense).values(legacyCostBatch.slice(i, i + 100));
    }
  }

  if (norm.executionPhases && norm.executionPhases.length > 0) {
    const phaseBatch = norm.executionPhases.map((p: any) => ({
      projectId: project.id,
      projectName,
      phaseName: p.phaseName,
      phaseDate: p.phaseDate,
      importRunId: importRun.id,
    }));
    await db.insert(normalizedExecutionPhases).values(phaseBatch);
    phaseCount = phaseBatch.length;
  }

  return {
    projectId: project.id,
    importRunId: importRun.id,
    summary: {
      projectName,
      planTasks: planCount,
      revenueLines: revCount,
      costLines: costCount,
      executionPhases: phaseCount,
      cosRealisedCount: norm.costLines.filter((c: any) => c.cosRealised).length,
      cashflowConfirmedCount: norm.costLines.filter((c: any) => c.cashflowConfirmed).length,
      issues: (norm.issues || []).length,
    },
  };
}

export async function rebuildDerivedTables(): Promise<void> {
  const projects = await db.select().from(projectInfo);
  const allCosts = await db.select().from(normalizedCostLines);
  const allRevenue = await db.select().from(normalizedRevenueLines);

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

export async function getFeatureFlag(key: string): Promise<boolean> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (rows.length === 0) return false;
  return rows[0].value === "true" || rows[0].value === "1";
}

export async function setFeatureFlag(key: string, value: boolean, updatedBy: string): Promise<void> {
  const existing = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(appSettings).set({ value: value ? "true" : "false", updatedBy, updatedAt: new Date() }).where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, value: value ? "true" : "false", updatedBy, updatedAt: new Date() });
  }
}

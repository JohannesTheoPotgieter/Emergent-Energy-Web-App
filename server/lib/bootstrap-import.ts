import crypto from "crypto";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { db } from "../db";
import { eq, sql, and, desc } from "drizzle-orm";
import {
  bootstrapImportRuns,
  stagingBootstrapProjects,
  projectInfo,
  programExpense,
  programInflows,
  projectPlan,
  normalizedPlanTasks,
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedExecutionPhases,
  smartImportRuns,
  derivedProjectKpis,
  derivedPortfolioKpis,
  derivedRagSummary,
  appSettings,
} from "@shared/schema";
import type { BootstrapImportRun, StagingBootstrapProject } from "@shared/schema";
import { runSmartImportPreview } from "./import/index";

const EXCEL_EXTENSIONS = [".xlsx", ".xlsm", ".xls"];

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

export interface DiscoverResult {
  files: { path: string; name: string; extractedProjectName: string; modifiedAt: Date | null; sizeBytes: number }[];
  totalCount: number;
  sourcePath: string;
}

export async function discoverSourceFiles(sourcePath: string): Promise<DiscoverResult> {
  const absPath = path.resolve(sourcePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Source path does not exist: ${absPath}`);
  }

  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  const files: DiscoverResult["files"] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXCEL_EXTENSIONS.includes(ext)) continue;
    if (entry.name.startsWith("~$") || entry.name.startsWith(".")) continue;

    const fullPath = path.join(absPath, entry.name);
    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(fullPath); } catch {}

    files.push({
      path: fullPath,
      name: entry.name,
      extractedProjectName: extractProjectNameFromFilename(entry.name),
      modifiedAt: stat?.mtime || null,
      sizeBytes: stat?.size || 0,
    });
  }

  return { files, totalCount: files.length, sourcePath: absPath };
}

export async function runBootstrapImport(
  sourcePath: string,
  userId: number,
  userRole: string
): Promise<{ runId: number }> {
  const [run] = await db.insert(bootstrapImportRuns).values({
    status: "SCANNING",
    triggeredByUserId: userId,
    triggeredByRole: userRole,
    sourcePath,
  }).returning();

  try {
    await executeBootstrapPipeline(run.id, sourcePath);
  } catch (error: any) {
    await db.update(bootstrapImportRuns).set({
      status: "FAILED",
      finishedAt: new Date(),
      logsJson: [{ level: "ERROR", message: error.message, stack: error.stack }],
    }).where(eq(bootstrapImportRuns.id, run.id));
  }

  return { runId: run.id };
}

async function executeBootstrapPipeline(runId: number, sourcePath: string): Promise<void> {
  const logs: any[] = [];
  const log = (level: string, message: string, data?: any) => {
    logs.push({ level, message, data, ts: new Date().toISOString() });
  };

  // STEP 1: DISCOVER
  log("INFO", "Step 1: Discovering source files...");
  const discovered = await discoverSourceFiles(sourcePath);
  await db.update(bootstrapImportRuns).set({
    status: "SCANNING",
    discoveredCount: discovered.totalCount,
  }).where(eq(bootstrapImportRuns.id, runId));
  log("INFO", `Discovered ${discovered.totalCount} Excel files`);

  if (discovered.totalCount === 0) {
    await db.update(bootstrapImportRuns).set({
      status: "COMPLETED",
      finishedAt: new Date(),
      logsJson: logs,
    }).where(eq(bootstrapImportRuns.id, runId));
    return;
  }

  // STEP 2: STAGING LOAD
  log("INFO", "Step 2: Loading files to staging...");
  await db.update(bootstrapImportRuns).set({ status: "STAGING" }).where(eq(bootstrapImportRuns.id, runId));

  let imported = 0, skipped = 0, quarantined = 0, errors = 0;

  for (const file of discovered.files) {
    try {
      const buffer = fs.readFileSync(file.path);
      const hash = computeFileHash(buffer);

      const existing = await db.select({ id: stagingBootstrapProjects.id })
        .from(stagingBootstrapProjects)
        .where(and(
          eq(stagingBootstrapProjects.importRunId, runId),
          eq(stagingBootstrapProjects.sourceHash, hash)
        ))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        log("INFO", `Skipped (duplicate hash): ${file.name}`);
        continue;
      }

      let preview: any = null;
      let parseStatus: "OK" | "PARTIAL" | "FAILED" = "OK";
      let errorReason: string | null = null;
      let sheetsFound: string[] = [];
      let planRowCount = 0, revenueRowCount = 0, costRowCount = 0;
      let infoExtracted: any = null;
      let needsReview = false;

      try {
        preview = await runSmartImportPreview(buffer, file.name);
        sheetsFound = preview.detection.sections.map((s: any) => `${s.section}:${s.sheetName}`);
        planRowCount = preview.normalization.planTasks?.length || 0;
        revenueRowCount = preview.normalization.revenueLines?.length || 0;
        costRowCount = preview.normalization.costLines?.length || 0;
        infoExtracted = preview.detection.projectInfo;

        if (preview.hasBlockers) {
          parseStatus = "PARTIAL";
          needsReview = true;
          errorReason = preview.normalization.issues
            .filter((i: any) => i.severity === "BLOCKER")
            .map((i: any) => i.message).join("; ");
          quarantined++;
        } else {
          imported++;
        }
      } catch (parseErr: any) {
        parseStatus = "FAILED";
        errorReason = parseErr.message;
        needsReview = true;
        errors++;
        log("WARN", `Parse failed for ${file.name}: ${parseErr.message}`);
      }

      await db.insert(stagingBootstrapProjects).values({
        importRunId: runId,
        sourcePath: file.path,
        sourceModifiedAt: file.modifiedAt,
        sourceHash: hash,
        projectNameExtracted: file.extractedProjectName,
        parseStatus,
        errorReason,
        rawJson: preview ? {
          planTasks: preview.normalization?.planTasks?.slice(0, 5),
          revenueLines: preview.normalization?.revenueLines?.slice(0, 5),
          costLines: preview.normalization?.costLines?.slice(0, 5),
          issues: preview.normalization?.issues,
        } : null,
        sheetsFound,
        planRowCount,
        revenueRowCount,
        costRowCount,
        infoExtracted,
        needsReview,
      });
    } catch (fileErr: any) {
      errors++;
      log("ERROR", `Failed to process ${file.name}: ${fileErr.message}`);
      await db.insert(stagingBootstrapProjects).values({
        importRunId: runId,
        sourcePath: file.path,
        sourceModifiedAt: file.modifiedAt,
        sourceHash: null,
        projectNameExtracted: file.extractedProjectName,
        parseStatus: "FAILED",
        errorReason: fileErr.message,
        rawJson: null,
        sheetsFound: [],
        planRowCount: 0,
        revenueRowCount: 0,
        costRowCount: 0,
        infoExtracted: null,
        needsReview: true,
      });
    }
  }

  await db.update(bootstrapImportRuns).set({
    importedCount: imported,
    skippedCount: skipped,
    quarantinedCount: quarantined,
    errorsCount: errors,
    logsJson: logs,
  }).where(eq(bootstrapImportRuns.id, runId));

  // STEP 3: CANONICAL UPSERT
  log("INFO", "Step 3: Upserting to canonical tables...");
  await db.update(bootstrapImportRuns).set({ status: "UPSERTING" }).where(eq(bootstrapImportRuns.id, runId));

  const stagingRows = await db.select().from(stagingBootstrapProjects)
    .where(and(
      eq(stagingBootstrapProjects.importRunId, runId),
      eq(stagingBootstrapProjects.parseStatus, "OK"),
    ));

  let updated = 0;
  for (const staging of stagingRows) {
    try {
      const projectName = staging.projectNameExtracted || "Unknown";
      const info = staging.infoExtracted as any;

      const existingPI = await db.select({ id: projectInfo.id })
        .from(projectInfo)
        .where(eq(projectInfo.projectName, projectName))
        .limit(1);

      let projectId: number;

      if (existingPI.length > 0) {
        projectId = existingPI[0].id;
        if (info) {
          await db.update(projectInfo).set({
            sizeKwp: info.sizeKwp || undefined,
            pd: info.pd || undefined,
            pm: info.pm || undefined,
            contractValue: info.contractValue || undefined,
            phase: info.phase || undefined,
            pdHandoverDate: info.pdHandoverDate || undefined,
            constructionStartDate: info.constructionStartDate || undefined,
            commissioningDate: info.commissioningDate || undefined,
            omHandoverDate: info.omHandoverDate || undefined,
            clientHandoverDate: info.clientHandoverDate || undefined,
            updatedAt: new Date(),
          }).where(eq(projectInfo.id, projectId));
        }
        updated++;
      } else {
        const [newPI] = await db.insert(projectInfo).values({
          projectName,
          sizeKwp: info?.sizeKwp || null,
          pd: info?.pd || null,
          pm: info?.pm || null,
          contractValue: info?.contractValue || null,
          phase: info?.phase || null,
          pdHandoverDate: info?.pdHandoverDate || null,
          constructionStartDate: info?.constructionStartDate || null,
          commissioningDate: info?.commissioningDate || null,
          omHandoverDate: info?.omHandoverDate || null,
          clientHandoverDate: info?.clientHandoverDate || null,
          isActive: true,
          archivedStatus: "ACTIVE",
        }).returning();
        projectId = newPI.id;
      }

      await db.update(stagingBootstrapProjects).set({
        canonicalProjectName: projectName,
      }).where(eq(stagingBootstrapProjects.id, staging.id));

      const buffer = fs.readFileSync(staging.sourcePath);
      const preview = await runSmartImportPreview(buffer, path.basename(staging.sourcePath));

      const [smartRun] = await db.insert(smartImportRuns).values({
        projectId,
        projectName,
        sourceFileName: path.basename(staging.sourcePath),
        sourceFileHash: staging.sourceHash,
        status: "COMMITTED",
        committedAt: new Date(),
      }).returning();

      await db.delete(normalizedPlanTasks).where(eq(normalizedPlanTasks.projectName, projectName));
      await db.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectName, projectName));
      await db.delete(normalizedCostLines).where(eq(normalizedCostLines.projectName, projectName));
      await db.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectName, projectName));

      if (preview.normalization.planTasks.length > 0) {
        const planValues = preview.normalization.planTasks.map((t: any) => ({
          projectId,
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
          pctComplete: t.pctComplete,
          comment: t.comment,
          sourceSheet: t.sourceSheet,
          sourceRow: t.sourceRow,
          importRunId: smartRun.id,
        }));
        for (let i = 0; i < planValues.length; i += 100) {
          await db.insert(normalizedPlanTasks).values(planValues.slice(i, i + 100));
        }
      }

      if (preview.normalization.revenueLines.length > 0) {
        const revValues = preview.normalization.revenueLines.map((r: any) => ({
          projectId,
          projectName,
          description: r.description,
          milestoneName: r.milestoneName,
          amountExVat: r.amountExVat,
          vat: r.vat,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate,
          expectedPaymentDate: r.expectedPaymentDate,
          paidDate: r.paidDate,
          inBankDate: r.inBankDate,
          status: r.status,
          sourceSheet: r.sourceSheet,
          sourceRow: r.sourceRow,
          importRunId: smartRun.id,
          turnaroundDays: r.turnaroundDays,
        }));
        for (let i = 0; i < revValues.length; i += 100) {
          await db.insert(normalizedRevenueLines).values(revValues.slice(i, i + 100));
        }
      }

      if (preview.normalization.costLines.length > 0) {
        const costValues = preview.normalization.costLines.map((c: any) => ({
          projectId,
          projectName,
          costCategory: c.costCategory,
          counterpartyName: c.counterpartyName,
          description: c.description,
          amountExVat: c.amountExVat,
          invoiceNumber: c.invoiceNumber,
          invoiceDate: c.invoiceDate,
          approvedDate: c.approvedDate,
          paidDate: c.paidDate,
          poNumber: c.poNumber,
          status: c.status,
          sourceSheet: c.sourceSheet,
          sourceRow: c.sourceRow,
          importRunId: smartRun.id,
          turnaroundDays: c.turnaroundDays,
        }));
        for (let i = 0; i < costValues.length; i += 100) {
          await db.insert(normalizedCostLines).values(costValues.slice(i, i + 100));
        }
      }

      if (preview.normalization.executionPhases?.length > 0) {
        for (const ep of preview.normalization.executionPhases) {
          await db.insert(normalizedExecutionPhases).values({
            projectId,
            projectName,
            phaseName: ep.phaseName,
            phaseDate: ep.phaseDate,
            source: "EXCEL_IMPORT",
            importRunId: smartRun.id,
          });
        }
      }

      log("INFO", `Upserted project: ${projectName} (plan=${preview.normalization.planTasks.length}, rev=${preview.normalization.revenueLines.length}, cost=${preview.normalization.costLines.length})`);
    } catch (upsertErr: any) {
      log("ERROR", `Upsert failed for staging ${staging.id}: ${upsertErr.message}`);
      errors++;
    }
  }

  await db.update(bootstrapImportRuns).set({
    updatedCount: updated,
    errorsCount: errors,
    logsJson: logs,
  }).where(eq(bootstrapImportRuns.id, runId));

  // STEP 4: DERIVED REBUILD
  log("INFO", "Step 4: Rebuilding derived rollup tables...");
  await db.update(bootstrapImportRuns).set({ status: "REBUILDING" }).where(eq(bootstrapImportRuns.id, runId));
  await rebuildDerivedTables(log);

  // STEP 5: VALIDATION
  log("INFO", "Step 5: Running validation checks...");
  await db.update(bootstrapImportRuns).set({ status: "VALIDATING" }).where(eq(bootstrapImportRuns.id, runId));
  const validation = await runValidation(runId, discovered.totalCount, log);

  // STEP 6: COMPLETE
  log("INFO", "Step 6: Import complete.");
  await db.update(bootstrapImportRuns).set({
    status: "COMPLETED",
    finishedAt: new Date(),
    validationJson: validation,
    logsJson: logs,
    updatedCount: updated,
    errorsCount: errors,
  }).where(eq(bootstrapImportRuns.id, runId));
}

export async function rebuildDerivedTables(log?: (level: string, msg: string, data?: any) => void): Promise<void> {
  const _log = log || ((_l: string, _m: string) => {});
  const today = new Date().toISOString().split("T")[0];

  const allPI = await db.select().from(projectInfo);
  const allExpenses = await db.select().from(programExpense);
  const allInflows = await db.select().from(programInflows);
  const allPlans = await db.select().from(projectPlan);
  const allNormCosts = await db.select().from(normalizedCostLines);
  const allNormRevs = await db.select().from(normalizedRevenueLines);
  const allNormPlans = await db.select().from(normalizedPlanTasks);

  const piNameSet = new Set(allPI.map(p => p.projectName));

  await db.delete(derivedProjectKpis);
  await db.delete(derivedPortfolioKpis);
  await db.delete(derivedRagSummary);

  const projectKpiRows: any[] = [];

  for (const pi of allPI) {
    const pn = pi.projectName;

    const legacyExp = allExpenses.filter(e => e.projectName === pn);
    const legacyInf = allInflows.filter(i => i.projectName === pn);
    const legacyPlan = allPlans.filter(p => p.projectName === pn);
    const normCosts = allNormCosts.filter(c => c.projectName === pn);
    const normRevs = allNormRevs.filter(r => r.projectName === pn);
    const normPlans = allNormPlans.filter(p => p.projectName === pn);

    const hasLegacyCost = legacyExp.length > 0;
    const hasLegacyRev = legacyInf.length > 0;
    const hasLegacyPlan = legacyPlan.length > 0;

    let totalPlannedRevenue = 0, totalActualRevenue = 0, revenueRealised = 0, revenueOutstanding = 0;
    let totalPlannedExpenses = 0, totalActualExpenses = 0, cosRealised = 0, expensesOutstanding = 0;

    if (hasLegacyRev) {
      for (const inf of legacyInf) {
        const amt = safeNum(inf.milestoneAmount);
        totalPlannedRevenue += amt;
        totalActualRevenue += amt;
        const pd = inf.paymentReceivedDate;
        if (pd && /^\d{4}-\d{2}-\d{2}$/.test(pd) && pd <= today) {
          revenueRealised += amt;
        } else if (inf.invoiceRaisedDate && !inf.paymentReceivedDate) {
          revenueOutstanding += amt;
        }
      }
    }
    if (!hasLegacyRev) {
      for (const rev of normRevs) {
        const amt = safeNum(rev.amountExVat);
        totalPlannedRevenue += amt;
        totalActualRevenue += amt;
        const pd = rev.paidDate || rev.inBankDate;
        if (pd && /^\d{4}-\d{2}-\d{2}$/.test(pd) && pd <= today) {
          revenueRealised += amt;
        } else if (rev.invoiceNumber && !rev.paidDate) {
          revenueOutstanding += amt;
        }
      }
    }

    if (hasLegacyCost) {
      for (const exp of legacyExp) {
        const budgetAmt = safeNum(exp.budgetTotal);
        totalPlannedExpenses += budgetAmt;
        const actualAmt = safeNum(exp.expenseActualTotal);
        totalActualExpenses += actualAmt;
        const pd = exp.expensePaymentDate;
        if (pd && /^\d{4}-\d{2}-\d{2}$/.test(pd) && pd <= today) {
          cosRealised += actualAmt;
        } else if (exp.expenseInvoicedDate && !exp.expensePaymentDate) {
          expensesOutstanding += actualAmt;
        }
      }
    }
    if (!hasLegacyCost) {
      for (const cost of normCosts) {
        const amt = safeNum(cost.amountExVat);
        totalPlannedExpenses += amt;
        totalActualExpenses += amt;
        const pd = cost.paidDate;
        if (pd && /^\d{4}-\d{2}-\d{2}$/.test(pd) && pd <= today) {
          cosRealised += amt;
        } else if (cost.invoiceNumber && !cost.paidDate) {
          expensesOutstanding += amt;
        }
      }
    }

    const grossProfit = totalActualRevenue - totalActualExpenses;
    const grossMarginPct = totalActualRevenue > 0 ? grossProfit / totalActualRevenue : 0;

    const plans = hasLegacyPlan ? legacyPlan : normPlans;
    let sumActual = 0, sumExpected = 0, planCount = 0;
    for (const p of plans) {
      const actual = safeNum((p as any).actualPctComplete || (p as any).pctComplete);
      const expected = safeNum((p as any).expectedPctComplete);
      if (actual > 0 || expected > 0) {
        sumActual += actual;
        sumExpected += expected;
        planCount++;
      }
    }
    const avgActual = planCount > 0 ? sumActual / planCount : 0;
    const avgExpected = planCount > 0 ? sumExpected / planCount : 0;
    const scheduleDelta = avgActual - avgExpected;

    const taskCount = plans.length;
    const expenseLineCount = hasLegacyCost ? legacyExp.length : normCosts.length;
    const revenueLineCount = hasLegacyRev ? legacyInf.length : normRevs.length;

    const isActive = pi.isActive && pi.archivedStatus === "ACTIVE";

    const needsReview = !pi.phase || (!pi.sizeKwp && taskCount === 0 && expenseLineCount === 0);
    const needsReviewReason = !pi.phase ? "Missing phase" : (!pi.sizeKwp && taskCount === 0 ? "No size or data" : null);

    const kpiRow = {
      projectKey: pn,
      projectName: pn,
      phase: pi.phase,
      sizeKwp: pi.sizeKwp,
      contractValue: pi.contractValue,
      ragStatus: pi.ragStatus,
      pm: pi.pm,
      pd: pi.pd,
      isActive,
      totalPlannedRevenue: totalPlannedRevenue.toFixed(2),
      totalActualRevenue: totalActualRevenue.toFixed(2),
      revenueRealised: revenueRealised.toFixed(2),
      revenueOutstanding: revenueOutstanding.toFixed(2),
      totalPlannedExpenses: totalPlannedExpenses.toFixed(2),
      totalActualExpenses: totalActualExpenses.toFixed(2),
      cosRealised: cosRealised.toFixed(2),
      expensesOutstanding: expensesOutstanding.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      grossMarginPct: grossMarginPct.toFixed(4),
      avgActualPctComplete: avgActual.toFixed(4),
      avgExpectedPctComplete: avgExpected.toFixed(4),
      scheduleDelta: scheduleDelta.toFixed(4),
      taskCount,
      expenseLineCount,
      revenueLineCount,
      needsReview,
      needsReviewReason,
      computedAt: new Date(),
    };

    projectKpiRows.push(kpiRow);
  }

  if (projectKpiRows.length > 0) {
    for (let i = 0; i < projectKpiRows.length; i += 50) {
      await db.insert(derivedProjectKpis).values(projectKpiRows.slice(i, i + 50));
    }
  }

  _log("INFO", `Computed KPIs for ${projectKpiRows.length} projects`);

  const activeKpis = projectKpiRows.filter(k => k.isActive);
  let totalProgramBudget = 0;
  let actualSpendPaid = 0, revRealisedTotal = 0;
  let activeCapacityKw = 0;
  let behindPlan = 0, onSchedule = 0;
  let onHold = 0, closed = 0;
  let revOutTotal = 0, expOutTotal = 0;
  const phaseDistribution: Record<string, { count: number; kw: number }> = {};

  for (const k of projectKpiRows) {
    totalProgramBudget += safeNum(k.contractValue);
    actualSpendPaid += safeNum(k.cosRealised);
    revRealisedTotal += safeNum(k.revenueRealised);
    revOutTotal += safeNum(k.revenueOutstanding);
    expOutTotal += safeNum(k.expensesOutstanding);

    const phase = k.phase || "Unknown";
    if (!phaseDistribution[phase]) phaseDistribution[phase] = { count: 0, kw: 0 };
    phaseDistribution[phase].count++;
    phaseDistribution[phase].kw += safeNum(k.sizeKwp);

    if (phase.toLowerCase().includes("hold")) onHold++;
    else if (phase.toLowerCase().includes("closed")) closed++;

    if (k.isActive) {
      activeCapacityKw += safeNum(k.sizeKwp);
      if (safeNum(k.scheduleDelta) >= 0 && k.taskCount > 0) onSchedule++;
      else if (safeNum(k.scheduleDelta) < 0 && k.taskCount > 0) behindPlan++;
    }
  }

  const withTasks = activeKpis.filter(k => k.taskCount > 0);
  const onScheduleRate = withTasks.length > 0 ? onSchedule / withTasks.length : 0;
  const grossProfitTotal = revRealisedTotal - actualSpendPaid;
  const grossProfitPct = revRealisedTotal > 0 ? grossProfitTotal / revRealisedTotal : 0;

  await db.insert(derivedPortfolioKpis).values({
    snapshotKey: "current",
    totalProgramBudget: totalProgramBudget.toFixed(2),
    actualSpendPaid: actualSpendPaid.toFixed(2),
    revenueRealised: revRealisedTotal.toFixed(2),
    activeProjectsCount: activeKpis.length,
    activeCapacityMw: (activeCapacityKw / 1000).toFixed(2),
    onScheduleRate: onScheduleRate.toFixed(4),
    behindPlanCount: behindPlan,
    onHoldCount: onHold,
    closedCount: closed,
    grossProfit: grossProfitTotal.toFixed(2),
    grossProfitPct: grossProfitPct.toFixed(4),
    revenueOutstanding: revOutTotal.toFixed(2),
    expensesOutstanding: expOutTotal.toFixed(2),
    phaseDistributionJson: phaseDistribution,
    computedAt: new Date(),
  });

  const ragGroups: Record<string, { count: number; kwp: number; cv: number }> = {};
  for (const k of projectKpiRows) {
    const rag = k.ragStatus || "Unknown";
    if (!ragGroups[rag]) ragGroups[rag] = { count: 0, kwp: 0, cv: 0 };
    ragGroups[rag].count++;
    ragGroups[rag].kwp += safeNum(k.sizeKwp);
    ragGroups[rag].cv += safeNum(k.contractValue);
  }

  for (const [rag, data] of Object.entries(ragGroups)) {
    await db.insert(derivedRagSummary).values({
      ragStatus: rag,
      projectCount: data.count,
      totalKwp: data.kwp.toFixed(2),
      totalContractValue: data.cv.toFixed(2),
      computedAt: new Date(),
    });
  }

  _log("INFO", `Rebuilt portfolio KPIs (${activeKpis.length} active) and ${Object.keys(ragGroups).length} RAG groups`);
}

async function runValidation(
  runId: number,
  discoveredCount: number,
  log: (level: string, msg: string, data?: any) => void
): Promise<any> {
  const results: any = { checks: [], overallPass: true };

  const run = await db.select().from(bootstrapImportRuns).where(eq(bootstrapImportRuns.id, runId)).limit(1);
  if (!run.length) return results;
  const r = run[0];

  const totalProcessed = r.importedCount + r.updatedCount + r.skippedCount + r.quarantinedCount + r.errorsCount;
  const countCheck = {
    name: "count_reconciliation",
    pass: totalProcessed === discoveredCount,
    detail: `discovered=${discoveredCount}, processed=${totalProcessed} (imported=${r.importedCount}, updated=${r.updatedCount}, skipped=${r.skippedCount}, quarantined=${r.quarantinedCount}, errors=${r.errorsCount})`,
  };
  results.checks.push(countCheck);
  if (!countCheck.pass) results.overallPass = false;

  const dupCheck = await db.execute(sql`
    SELECT project_key, COUNT(*) as cnt FROM derived_project_kpis GROUP BY project_key HAVING COUNT(*) > 1
  `);
  const hasDups = (dupCheck as any).rows?.length > 0;
  results.checks.push({
    name: "no_duplicate_project_keys",
    pass: !hasDups,
    detail: hasDups ? `Found duplicate project_keys` : "No duplicates",
  });
  if (hasDups) results.overallPass = false;

  const portfolioRow = await db.select().from(derivedPortfolioKpis).where(eq(derivedPortfolioKpis.snapshotKey, "current")).limit(1);
  results.checks.push({
    name: "portfolio_kpi_exists",
    pass: portfolioRow.length > 0,
    detail: portfolioRow.length > 0 ? `Active projects: ${portfolioRow[0].activeProjectsCount}` : "No portfolio KPI row",
  });
  if (portfolioRow.length === 0) results.overallPass = false;

  const projectKpis = await db.select().from(derivedProjectKpis);
  const reviewCount = projectKpis.filter(k => k.needsReview).length;
  results.checks.push({
    name: "needs_review_count",
    pass: true,
    detail: `${reviewCount} of ${projectKpis.length} projects need review`,
  });

  const sampleSize = Math.min(10, projectKpis.length);
  const sample = projectKpis.sort(() => Math.random() - 0.5).slice(0, sampleSize);
  const samplePass = sample.every(k => k.projectKey && k.projectName);
  results.checks.push({
    name: "sample_required_fields",
    pass: samplePass,
    detail: `Checked ${sampleSize} random projects: all have projectKey and projectName`,
  });
  if (!samplePass) results.overallPass = false;

  if (portfolioRow.length > 0) {
    const sumRev = projectKpis.reduce((s, k) => s + safeNum(k.revenueRealised), 0);
    const portfolioRev = safeNum(portfolioRow[0].revenueRealised);
    const revDiff = Math.abs(sumRev - portfolioRev);
    const revPass = revDiff < 1;
    results.checks.push({
      name: "rollup_integrity_revenue",
      pass: revPass,
      detail: `sum(project revenue_realised)=${sumRev.toFixed(2)}, portfolio=${portfolioRev.toFixed(2)}, diff=${revDiff.toFixed(2)}`,
    });
    if (!revPass) results.overallPass = false;
  }

  log("INFO", `Validation: ${results.checks.filter((c: any) => c.pass).length}/${results.checks.length} checks passed`);
  return results;
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

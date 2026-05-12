/**
 * Finance / COS Routes — Extracted from server/routes.ts (Phase 9a)
 *
 * 22 handlers covering:
 *   - Program COS dashboard (1)
 *   - Financial headline (1)
 *   - Financial close upload/files (2)
 *   - Realisation KPIs (1)
 *   - Program inflows (1)
 *   - Expenditure font-color-toggle (2)
 *   - Revenue tracking overrides (2)
 *   - Expenditure overrides (3)
 *   - Expense task links (4)
 *   - Expense add-line / add-category / insert-task-as-line (3)
 *   - COS status override (2)
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, or, isNull } from "drizzle-orm";
import { normalizedCostLines, normalizedRevenueLines, financialEditRequests, projectInfo, OVERRIDE_CATEGORIES } from "@shared/schema";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { classifyExpenseState } from "../lib/calculations/stateClassifier";
import { z } from "zod";
import { createCostLine, updateCostLineFields, createRevenueLine, updateRevenueLineFields } from "../services/finance-line-write-service";
import { invalidateProjectFinanceReads } from "../services/dashboard-metrics";
import { mapCostToExpenseInput } from "../lib/data-merge";
import { getMergedExpensesAndInflows } from "../lib/cashflow-helpers";
import { getCosEffectiveDateAndSource } from "../lib/expense-row-selector";
import { STATIC_COS_BUDGET_FY26 } from "../lib/calculations/financeUtils";
import { FinanceInflowsRepository } from "../repositories/finance-inflows-repository";

const financeInflowsRepository = new FinanceInflowsRepository();
import { sanitizeFilename, allowedFileFilter } from "../lib/upload-security";
import { recordOverride, recordManualEdit } from "../lib/audit/diff-engine";
import { recordManualEditFlag } from "../lib/manual-edit-flag";
import { safeNum, getFYRange } from "../lib/home-helpers";
import { isEffectivelyRealisedLocal, isCashflowConfirmedCheck } from "../lib/finance-helpers";
import { paramStr, parseIntParam } from "../lib/req-params";
import { getCanonicalAllCurrentCostLines, getCanonicalProjectCostLinesByName, getCanonicalCostLinesByNames } from "../services/project-cost-line-read-service";

export function registerFinanceLegacyExtractedRoutes(app: Express): void {

  app.get("/api/program/cos", requireAuth, async (req, res) => {
    try {
      const { projectName, startDate, endDate, atRiskDays = '30' } = req.query;
      const atRiskDaysNum = parseInt(atRiskDays as string, 10) || 30;
      
      const [allExpenses, latestRefresh] = await Promise.all([
        getCanonicalAllCurrentCostLines(),
        storage.getLatestRefresh()
      ]);

      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const fyRange = getFYRange();
      const filterStart = (startDate as string) || fyRange.start;
      const filterEnd = (endDate as string) || fyRange.end;

      // Filter expenses
      let filtered = allExpenses.filter(e => e.rowType === 'item');
      if (projectName) {
        filtered = filtered.filter(e => e.projectName === projectName);
      }

      let totalCosRealised = 0;
      let totalCashPaid = 0;
      let outstandingCos = 0;
      let atRiskCount = 0;
      let totalBudget = 0;
      const supplierMap = new Map<string, number>();
      const projectCosMap = new Map<string, number>();
      const monthlyCategoryMap = new Map<string, Map<string, number>>();

      const _nowCos = new Date();
      const _curLastDay = new Date(_nowCos.getFullYear(), _nowCos.getMonth() + 1, 0).getDate();
      const _curMonthEnd = `${_nowCos.getFullYear()}-${String(_nowCos.getMonth() + 1).padStart(2, '0')}-${String(_curLastDay).padStart(2, '0')}`;

      for (const exp of filtered) {
        const invoiceDate = exp.expenseInvoicedDate;
        const paymentDate = exp.expensePaymentDate;
        const amount = safeNum(exp.expenseActualTotal);
        const cosAmount = safeNum(exp.actualCosTotal) || amount;
        const budgetAmount = safeNum(exp.budgetTotal);
        const category = exp.expenseCategory || 'Panels';

        totalBudget += budgetAmount;

        if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd && invoiceDate <= _curMonthEnd) {
          totalCosRealised += cosAmount;

          // Monthly COS by category
          const monthKey = invoiceDate.substring(0, 7); // YYYY-MM
          if (!monthlyCategoryMap.has(category)) {
            monthlyCategoryMap.set(category, new Map());
          }
          const categoryMonths = monthlyCategoryMap.get(category)!;
          categoryMonths.set(monthKey, (categoryMonths.get(monthKey) || 0) + cosAmount);

          // Project COS
          projectCosMap.set(exp.projectName, (projectCosMap.get(exp.projectName) || 0) + cosAmount);

          // Supplier extraction
          const invoiceNum = exp.expenseInvoiceNumber || '';
          let supplier = 'Unknown';
          if (invoiceNum.includes(':')) {
            supplier = invoiceNum.split(':')[0].trim();
          } else if (invoiceNum.includes('-')) {
            supplier = invoiceNum.split('-')[0].trim();
          } else if (invoiceNum.length > 0) {
            supplier = invoiceNum.substring(0, Math.min(20, invoiceNum.length));
          }
          supplierMap.set(supplier, (supplierMap.get(supplier) || 0) + cosAmount);
        }

        // Cash Paid = has payment date within range
        if (paymentDate && paymentDate >= filterStart && paymentDate <= filterEnd) {
          totalCashPaid += amount;
        }

        if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd && invoiceDate <= _curMonthEnd && !paymentDate) {
          outstandingCos += cosAmount;

          // At-risk = invoice older than X days and not paid
          const invoiceDateObj = new Date(invoiceDate);
          const daysSinceInvoice = Math.floor((today.getTime() - invoiceDateObj.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceInvoice > atRiskDaysNum) {
            atRiskCount++;
          }
        }
      }

      // Format top suppliers
      const topSuppliers = Array.from(supplierMap.entries())
        .map(([supplier, total]) => ({ supplier, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Format top projects
      const topProjects = Array.from(projectCosMap.entries())
        .map(([project, total]) => ({ project: project.replace('_Tracker', ''), total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Format monthly COS matrix
      const allMonths = new Set<string>();
      for (const monthMap of Array.from(monthlyCategoryMap.values())) {
        for (const month of Array.from(monthMap.keys())) {
          allMonths.add(month);
        }
      }
      const sortedMonths = Array.from(allMonths).sort();

      const monthlyCosMatrix = Array.from(monthlyCategoryMap.entries())
        .map(([category, monthMap]) => {
          const row: Record<string, string | number> = { category };
          let total = 0;
          for (const month of sortedMonths) {
            const value = monthMap.get(month) || 0;
            row[month] = value;
            total += value;
          }
          row.total = total;
          return row;
        })
        .sort((a, b) => (b.total as number) - (a.total as number));

      const paidVsBudgetPercent = totalBudget > 0 ? (totalCashPaid / totalBudget) * 100 : 0;

      res.json({
        lastRefresh: latestRefresh?.refreshedAt || null,
        fyRange,
        filterRange: { start: filterStart, end: filterEnd },
        kpis: {
          totalCosRealised,
          cashPaid: totalCashPaid,
          outstandingCos,
          paidVsBudget: paidVsBudgetPercent,
          totalBudget,
          atRiskCount,
          supplierCount: supplierMap.size
        },
        topProjects,
        topSuppliers,
        monthlyCosMatrix: {
          months: sortedMonths,
          rows: monthlyCosMatrix
        }
      });
    } catch (error) {
      console.error("Program COS error:", error);
      res.status(500).json({ error: "Failed to fetch program COS data" });
    }
  });


  app.get("/api/financial-headline", requireAuth, async (_req, res) => {
    try {
      const today = new Date();
      const fyStartMonth = 9;
      let fyStartYear = today.getFullYear();
      if (today.getMonth() + 1 < fyStartMonth) fyStartYear--;
      const fyStart = `${fyStartYear}-09-01`;
      const fyEnd = `${fyStartYear + 1}-08-31`;
      const fyLabel = `FY${String(fyStartYear).slice(2)}/${String(fyStartYear + 1).slice(2)}`;
      const todayStr = today.toISOString().split('T')[0];

      const dateInFY = (dateStr: string | null | undefined): boolean => {
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return false;
        const d = dateStr.substring(0, 10);
        return d >= fyStart && d <= fyEnd;
      };

      const { normalizedCostLines, normalizedRevenueLines, projectInfo, projectExecutionState } = await import("@shared/schema");

      const HARD_EXCLUDED = ["Closed", "Gone"];
      const activeProjectsResult = await db.select({
        projectName: projectInfo.projectName,
        phase: projectExecutionState.executionPhase,
        phaseUpdatedAt: projectExecutionState.phaseUpdatedAt,
      })
        .from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(isNull(projectExecutionState.deletedAt));
      const activeNames = new Set(
        activeProjectsResult
          .filter((p: { projectName: string; phase: string | null; phaseUpdatedAt: Date | null }) => {
            const phase = p.phase || "";
            if (HARD_EXCLUDED.includes(phase)) return false;
            if (phase === "Compliance Handover") {
              if (!p.phaseUpdatedAt) return false;
              const d = p.phaseUpdatedAt instanceof Date
                ? p.phaseUpdatedAt.toISOString().substring(0, 10)
                : String(p.phaseUpdatedAt).substring(0, 10);
              return d >= fyStart && d <= fyEnd;
            }
            return true;
          })
          .map((p: { projectName: string }) => p.projectName.toLowerCase().trim())
      );

      const [allNormCosts, allNormRev] = await Promise.all([
        db.select().from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))),
        db.select().from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
      ]);

      let totalRevenue = 0;
      let totalExpenses = 0;
      let revenueOutstanding = 0;
      let expensesDue = 0;
      let revenueOverdue = 0;
      let expensesOverdue = 0;

      const isValidDate = (d: string | null | undefined): boolean =>
        !!(d && /^\d{4}-\d{2}-\d{2}/.test(d) && d !== '-');
      const isPastDate = (d: string): boolean => d.substring(0, 10) < todayStr;

      for (const rev of allNormRev) {
        if (!activeNames.has(rev.projectName.toLowerCase().trim())) continue;
        // REV realisation FY filter — invoice_date only (per finance rule).
        const dateField = rev.invoiceDate;
        if (!dateInFY(dateField)) continue;

        const amt = parseFloat(rev.amountExVat || '0') || 0;
        if (amt === 0) continue;

        const hasInvoice = !!(rev.invoiceNumber && String(rev.invoiceNumber).trim());
        const hasPaidDate = isValidDate(rev.paidDate);
        const hasPaymentColorInfo = rev.paidDateConfirmed != null || (rev.paidDateFontColor != null && rev.paidDateFontColor !== '');
        const paidDateBlack = hasPaidDate && (rev.paidDateConfirmed === true || rev.paidDateFontColor === 'black' || !hasPaymentColorInfo);
        const isInBank = hasInvoice && paidDateBlack;

        if (isInBank) {
          totalRevenue += amt;
        } else if (hasInvoice) {
          revenueOutstanding += amt;
          const dueDate = rev.expectedPaymentDate || rev.invoiceDate;
          if (isValidDate(dueDate) && isPastDate(dueDate!)) {
            revenueOverdue += amt;
          }
        }
      }

      for (const cost of allNormCosts) {
        if (!activeNames.has(cost.projectName.toLowerCase().trim())) continue;
        // COS realisation FY filter — invoice_date only (per finance rule).
        const dateField = cost.invoiceDate;
        if (!dateInFY(dateField)) continue;

        const amt = parseFloat(cost.amountExVat || '0') || 0;
        if (amt === 0) continue;

        const state = classifyExpenseState(mapCostToExpenseInput(cost));

        if (state === 'Paid') {
          totalExpenses += amt;
        } else if (state === 'Invoiced' || state === 'Committed') {
          expensesDue += amt;
          const dueDate = cost.paidDate || cost.invoiceDate;
          if (isValidDate(dueDate) && isPastDate(dueDate!)) {
            expensesOverdue += amt;
          }
        }
      }

      const grossProfit = totalRevenue - totalExpenses;
      const gpMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      res.json({
        fyLabel,
        fyStart,
        fyEnd,
        totalRevenue,
        totalExpenses,
        grossProfit,
        gpMargin,
        revenueOutstanding,
        expensesDue,
        revenueOverdue,
        expensesOverdue,
      });
    } catch (err: any) {
      console.error("[Financial Headline] Error:", err);
      throw err;
    }
  });

  const docUploadDir = path.join(process.cwd(), 'uploads', 'financial-close');
  if (!fs.existsSync(docUploadDir)) {
    fs.mkdirSync(docUploadDir, { recursive: true });
  }
  const docUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, docUploadDir),
      filename: (_req, file, cb) => {
        const ts = Date.now();
        cb(null, `${ts}_${sanitizeFilename(file.originalname)}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: allowedFileFilter,
  });

  app.post("/api/financial-close/upload", requireAuth, requireAdmin, docUpload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileUrl = `/api/financial-close/files/${req.file.filename}`;
    logAuditFromReq(req, { entityType: "financial_close_doc", action: "upload", entityId: req.file.originalname, changesJson: { description: "Financial close document uploaded", filename: req.file.originalname } });
    res.json({ url: fileUrl, filename: req.file.originalname });
  });

  app.get("/api/financial-close/files/:filename", requireAuth, (req, res) => {
    const filename = req.params.filename as string;
    const resolvedPath = path.resolve(docUploadDir, path.basename(filename));
    if (!resolvedPath.startsWith(path.resolve(docUploadDir))) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "File not found" });
    }
    res.sendFile(resolvedPath);
  });

  // Update project editable fields (Cost Proposal Signed, Funding Signed, EPC Contract Signed, Current VO Total, Comments)
  // REMOVED: /api/tracker-monthly and /api/cos-tracker duplicates.
  // Canonical routes now in finance-routes.ts

  // ==================== REALISATION KPIs (Weekly / Monthly / Yearly) ====================

  app.get("/api/realisation-kpis", requireAuth, async (req, res) => {
    try {
      const legacyExpenses = await getCanonicalAllCurrentCostLines();
      const { expenses: allExpenses } = await getMergedExpensesAndInflows(
        legacyExpenses, []
      );

      const now = new Date();
      const currentMK = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // FY runs Sep–Aug
      const fyStartYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      const fyStart = new Date(Date.UTC(fyStartYear, 8, 1)); // Sep 1
      const fyEnd = new Date(Date.UTC(fyStartYear + 1, 7, 31)); // Aug 31

      // Week boundaries (Monday-based)
      function getMonday(d: Date): Date {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const m = new Date(d); m.setDate(diff); m.setHours(0,0,0,0); return m;
      }
      function getSunday(mon: Date): Date {
        const s = new Date(mon); s.setDate(mon.getDate() + 6); return s;
      }
      function toStr(d: Date): string { return d.toISOString().split('T')[0]; }

      const thisWeekMon = getMonday(new Date(now));
      const thisWeekSun = getSunday(thisWeekMon);
      const lastWeekMon = new Date(thisWeekMon); lastWeekMon.setDate(lastWeekMon.getDate() - 7);
      const lastWeekSun = getSunday(lastWeekMon);

      // Month boundaries
      const thisMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      const thisMonthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
      const lastMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
      const lastMonthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));

      interface PeriodBucket {
        total: number;
        realised: number;
        unrealised: number;
        lineCount: number;
        realisedCount: number;
        byProject: Map<string, { total: number; realised: number }>;
      }
      function emptyBucket(): PeriodBucket {
        return { total: 0, realised: 0, unrealised: 0, lineCount: 0, realisedCount: 0, byProject: new Map() };
      }

      // COS monthly series (for sparklines)
      const cosMonthly = new Map<string, { total: number; realised: number }>();
      // Cashflow monthly series
      const cfMonthly = new Map<string, { total: number; realised: number }>();

      // Period buckets
      const cosThisWeek = emptyBucket(), cosLastWeek = emptyBucket();
      const cosThisMonth = emptyBucket(), cosLastMonth = emptyBucket();
      const cosYTD = emptyBucket();
      const cfThisWeek = emptyBucket(), cfLastWeek = emptyBucket();
      const cfThisMonth = emptyBucket(), cfLastMonth = emptyBucket();
      const cfYTD = emptyBucket();

      function inRange(dateStr: string | null, start: Date, end: Date): boolean {
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        d.setHours(0,0,0,0);
        return d >= start && d <= end;
      }

      function addToBucket(bucket: PeriodBucket, amount: number, isRealised: boolean, projectName: string) {
        bucket.total += amount;
        bucket.lineCount++;
        if (isRealised) { bucket.realised += amount; bucket.realisedCount++; }
        else { bucket.unrealised += amount; }
        if (!bucket.byProject.has(projectName)) bucket.byProject.set(projectName, { total: 0, realised: 0 });
        const p = bucket.byProject.get(projectName)!;
        p.total += amount;
        if (isRealised) p.realised += amount;
      }

      for (const exp of allExpenses) {
        if (exp.rowType !== 'item') continue;
        const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
        if (isNaN(amount) || amount === 0) continue;
        const pName = (exp.projectName || '').replace(/_Tracker$/i, '');

        // COS: uses canonical COS date for bucketing (respects admin overrides)
        const { date: cosDate } = getCosEffectiveDateAndSource(exp);
        if (cosDate) {
          const cosDateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
          if (cosDateMatch) {
            const mk = `${cosDateMatch[1]}-${cosDateMatch[2]}`;
            const isCosReal = isEffectivelyRealisedLocal(exp, mk, currentMK);

            // Monthly series
            if (!cosMonthly.has(mk)) cosMonthly.set(mk, { total: 0, realised: 0 });
            const cm = cosMonthly.get(mk)!;
            cm.total += amount;
            if (isCosReal) cm.realised += amount;

            // Weekly buckets
            if (inRange(cosDate, thisWeekMon, thisWeekSun)) addToBucket(cosThisWeek, amount, isCosReal, pName);
            if (inRange(cosDate, lastWeekMon, lastWeekSun)) addToBucket(cosLastWeek, amount, isCosReal, pName);

            // Monthly buckets
            if (inRange(cosDate, thisMonthStart, thisMonthEnd)) addToBucket(cosThisMonth, amount, isCosReal, pName);
            if (inRange(cosDate, lastMonthStart, lastMonthEnd)) addToBucket(cosLastMonth, amount, isCosReal, pName);

            // YTD (within FY)
            if (inRange(cosDate, fyStart, fyEnd)) addToBucket(cosYTD, amount, isCosReal, pName);
          }
        }

        // Cashflow: uses payment date for bucketing
        const payDate = exp.expensePaymentDate as string | null;
        if (payDate) {
          const payDateMatch = payDate.match(/^(\d{4})-(\d{2})/);
          if (payDateMatch) {
            const mk = `${payDateMatch[1]}-${payDateMatch[2]}`;
            const isCfReal = isCashflowConfirmedCheck(exp) && mk <= currentMK;

            // Monthly series
            if (!cfMonthly.has(mk)) cfMonthly.set(mk, { total: 0, realised: 0 });
            const cfm = cfMonthly.get(mk)!;
            cfm.total += amount;
            if (isCfReal) cfm.realised += amount;

            // Weekly buckets
            if (inRange(payDate, thisWeekMon, thisWeekSun)) addToBucket(cfThisWeek, amount, isCfReal, pName);
            if (inRange(payDate, lastWeekMon, lastWeekSun)) addToBucket(cfLastWeek, amount, isCfReal, pName);

            // Monthly buckets
            if (inRange(payDate, thisMonthStart, thisMonthEnd)) addToBucket(cfThisMonth, amount, isCfReal, pName);
            if (inRange(payDate, lastMonthStart, lastMonthEnd)) addToBucket(cfLastMonth, amount, isCfReal, pName);

            // YTD
            if (inRange(payDate, fyStart, fyEnd)) addToBucket(cfYTD, amount, isCfReal, pName);
          }
        }
      }

      function serializeBucket(bucket: PeriodBucket) {
        const projects: { projectName: string; total: number; realised: number; unrealised: number }[] = [];
        bucket.byProject.forEach((v, k) => {
          projects.push({ projectName: k, total: v.total, realised: v.realised, unrealised: v.total - v.realised });
        });
        projects.sort((a, b) => b.total - a.total);
        return {
          total: bucket.total,
          realised: bucket.realised,
          unrealised: bucket.unrealised,
          realisedPct: bucket.total > 0 ? Number(((bucket.realised / bucket.total) * 100).toFixed(1)) : 0,
          lineCount: bucket.lineCount,
          realisedCount: bucket.realisedCount,
          projects,
        };
      }

      // Build monthly sparkline series (FY months only)
      function buildSeries(monthlyMap: Map<string, { total: number; realised: number }>) {
        const series: { monthKey: string; label: string; total: number; realised: number; unrealised: number; realisedPct: number }[] = [];
        for (let i = 0; i < 12; i++) {
          const d = new Date(Date.UTC(fyStartYear, 8 + i, 1));
          const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          const data = monthlyMap.get(mk);
          const total = data?.total ?? 0;
          const realised = data?.realised ?? 0;
          series.push({
            monthKey: mk,
            label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
            total, realised,
            unrealised: total - realised,
            realisedPct: total > 0 ? Number(((realised / total) * 100).toFixed(1)) : 0,
          });
        }
        return series;
      }

      // Budget variance for COS YTD
      let ytdBudget = 0;
      for (let i = 0; i < 12; i++) {
        const d = new Date(Date.UTC(fyStartYear, 8 + i, 1));
        const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        if (mk <= currentMK) ytdBudget += STATIC_COS_BUDGET_FY26[mk] ?? 0;
      }

      res.json({
        asOf: now.toISOString(),
        fyLabel: `FY${fyStartYear + 1}`,
        fyStart: toStr(fyStart),
        fyEnd: toStr(fyEnd),
        cos: {
          thisWeek: serializeBucket(cosThisWeek),
          lastWeek: serializeBucket(cosLastWeek),
          thisMonth: serializeBucket(cosThisMonth),
          lastMonth: serializeBucket(cosLastMonth),
          ytd: { ...serializeBucket(cosYTD), budget: ytdBudget, variance: cosYTD.total - ytdBudget, variancePct: ytdBudget > 0 ? Number(((cosYTD.total - ytdBudget) / ytdBudget * 100).toFixed(1)) : 0 },
          monthlySeries: buildSeries(cosMonthly),
        },
        cashflow: {
          thisWeek: serializeBucket(cfThisWeek),
          lastWeek: serializeBucket(cfLastWeek),
          thisMonth: serializeBucket(cfThisMonth),
          lastMonth: serializeBucket(cfLastMonth),
          ytd: serializeBucket(cfYTD),
          monthlySeries: buildSeries(cfMonthly),
        },
      });
    } catch (error) {
      console.error("Realisation KPIs error:", error);
      res.status(500).json({ error: "Failed to fetch realisation KPIs" });
    }
  });

  // REMOVED: /api/program-expenses and /api/program-expenses/:projectName
  // Canonical routes now in server/departments/finance-routes.ts (registered first via registerDepartmentRoutes).

  app.get("/api/program-inflows", requireAuth, async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let inflows;

      if (projectName && typeof projectName === 'string') {
        // RLS: verify user has access to this project by name
        const { resolveProjectScope, isProjectAccessibleByName } = await import("../services/project-access-service");
        const infUser = (req as any).user;
        const infScope = await resolveProjectScope(infUser?.id || 0, infUser?.role || "", infUser?.name || "");
        if (!isProjectAccessibleByName(infScope, projectName)) {
          return res.status(403).json({ error: "FORBIDDEN", message: "You do not have access to this project" });
        }
        inflows = await storage.getProgramInflowsByProject(projectName);

        // Apply overrides if requested
        if (applyOverrides === 'true') {
          // Override data now baked into base rows
        }
      } else {
        inflows = await storage.getAllProgramInflows();
        // RLS: filter to accessible projects
        const { resolveProjectScope, isProjectAccessibleByName } = await import("../services/project-access-service");
        const infUser = (req as any).user;
        const infScope = await resolveProjectScope(infUser?.id || 0, infUser?.role || "", infUser?.name || "");
        if (infScope.kind === "scoped") {
          inflows = inflows.filter((i: any) => isProjectAccessibleByName(infScope, i.projectName || ""));
        }
      }

      if (startDate && typeof startDate === 'string') {
        inflows = inflows.filter(i => 
          (i.paymentReceivedDate && i.paymentReceivedDate >= startDate) ||
          (i.plannedPaymentDate && i.plannedPaymentDate >= startDate)
        );
      }
      if (endDate && typeof endDate === 'string') {
        inflows = inflows.filter(i => 
          (i.paymentReceivedDate && i.paymentReceivedDate <= endDate) ||
          (i.plannedPaymentDate && i.plannedPaymentDate <= endDate)
        );
      }

      // Sub-project filter
      const subProjectFilter = req.query.subProject as string | undefined;
      if (subProjectFilter && inflows) {
        inflows = inflows.filter((i: any) => i.subProjectName === subProjectFilter);
      }

      res.json(inflows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch program inflows", message: "Failed to fetch program inflows" });
    }
  });

  // ==================== FINANCIAL DATA ROUTES ====================

  // REMOVED: /api/cashflow and /api/cashflow/planning-overrides duplicates.
  // Canonical routes now in finance-routes.ts

  // REMOVED: /api/revenue-tracking/overrides and /api/revenue-tab duplicates.
  // Canonical routes now in finance-routes.ts

  // REMOVED: /api/expenditure/overrides, /api/expense-task-links, /api/expenses duplicates.
  // Canonical routes now in finance-routes.ts

  app.post("/api/revenue-tracking/overrides", requireAuth, requireAdmin, requirePermission('financials', 'edit'), async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";
      const userId = req.user?.id;

      // Apply overrides directly to the base table (normalized_revenue_lines)
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName).filter(Boolean))] as string[];
      const saved: any[] = [];

      // Finance PR 3: batch read of inflows for every project in this
      // override payload. Replaces N×2 round-trips with a single 2-query
      // call before the apply loop.
      const inflowsByProject = await financeInflowsRepository.listProgramInflowsByProjectNames(projectNames);

      for (const pn of projectNames) {
        const projectOverrides = overrides.filter((o: any) => o.projectName === pn);
        const inflows = inflowsByProject.get(pn) ?? [];
        const rowMap = new Map(inflows.map((r: any) => [r.rowNumber, r]));

        const rowGroups = new Map<number, Record<string, any>>();
        for (const ov of projectOverrides) {
          const inflow = rowMap.get(ov.rowNumber);
          if (!inflow) continue;
          if (!rowGroups.has(inflow.id)) rowGroups.set(inflow.id, {});
          const fields = rowGroups.get(inflow.id)!;
          const effectiveValue = ov.overrideValue === "__null__" ? null : ov.overrideValue;
          fields[ov.fieldName] = effectiveValue;
        }

        for (const [inflowId, fields] of rowGroups.entries()) {
          if (Object.keys(fields).length > 0) {
            const result = await storage.updateProgramInflowFields(inflowId, fields);
            if (result) saved.push(result);
          }
        }
      }

      try {
        for (const o of overrides) {
          await recordOverride({
            actorUserId: userId,
            actorRole: (req as any).user?.role,
            entityType: "revenue_tracking_override",
            entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
            projectName: o.projectName,
            action: "REVENUE_OVERRIDE",
            overrideCategory,
            overrideComment: overrideComment.trim(),
            oldRecord: {},
            newRecord: { [o.fieldName]: o.overrideValue },
          });

          // Record manual edit flag for import conflict detection
          recordManualEditFlag({
            entityType: "revenue_tracking",
            entityId: o.rowNumber,
            fieldName: o.fieldName,
            editedByUserId: userId,
            editedByName: (req as any).user?.name,
          });
        }
      } catch (auditErr: any) {
        console.warn("[audit] Revenue override audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "revenue_tracking_override", action: "create", changesJson: { description: `${overrides.length} revenue tracking override(s) saved`, count: overrides.length, projectNames } });
      res.json({ message: "Revenue tracking overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
      res.status(500).json({ error: "Failed to save revenue tracking overrides" });
    }
  });

  app.delete("/api/revenue-tracking/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      // Override tables collapsed into base tables — no separate overrides to delete
      logAuditFromReq(req, { entityType: "revenue_tracking_override", action: "delete", projectName, changesJson: { description: "All revenue tracking overrides deleted for project", projectName } });
      res.json({ message: `Revenue tracking overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete revenue tracking overrides", message: "Failed to delete revenue tracking overrides" });
    }
  });

  // Revenue tab routes (/api/revenue-tab/*) are now handled exclusively by finance-routes.ts
  // Legacy handlers removed to eliminate duplicate route registration that caused
  // the canonical handler (with governance context) to shadow the legacy one,
  // and to prevent confusion about which handler serves each request.

  // Expenditure Overrides API
  app.get("/api/expenditure/overrides", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.query;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      res.json([]);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expenditure overrides", message: "Failed to fetch expenditure overrides" });
    }
  });

  // Expenditure overrides now handled by finance-routes.ts with approval workflow
  // This legacy route is kept as a fallback redirect to the approval flow
  app.post("/api/expenditure/overrides", requireAuth, requireAdmin, requirePermission('financials', 'edit'), async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";
      const userId = req.user?.id;
      const userRole = req.user?.role;

      // Admin users apply overrides directly (this legacy route requires requireAdmin)
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName).filter(Boolean))] as string[];
      const fieldToColumnMap: Record<string, string> = {
        expenseInvoicedDate: "expenseInvoicedDate",
        expensePaymentDate: "expensePaymentDate",
        expensePoNumber: "expensePoNumber",
        expenseInvoiceNumber: "expenseInvoiceNumber",
        expenseLineItem: "expenseLineItem",
        expenseActualTotal: "expenseActualTotal",
        budgetTotal: "budgetTotal",
        forecastPaymentDate: "forecastPaymentDate",
        expenseQty: "expenseQty",
        expenseRateUnit: "expenseRateUnit",
        budgetQty: "budgetQty",
        budgetRateUnit: "budgetRateUnit",
        invoiceDateFontColor: "invoiceDateFontColor",
        paymentDateFontColor: "paymentDateFontColor",
        supplierName: "supplierName",
      };

      // Finance PR 3: batch read of cost lines for every project in this
      // override payload. Replaces the per-project 2-query lookup with a
      // single fixed-2-query call before the apply loop.
      const costLinesByProject = await getCanonicalCostLinesByNames(projectNames as string[]);

      for (const pn of projectNames) {
        const projectOverrides = overrides.filter((o: any) => o.projectName === pn);
        const expenses = costLinesByProject.get(pn as string)?.rows ?? [];
        const rowMap = new Map(expenses.map((e: any) => [e.rowNumber, e]));

        const rowGroups = new Map<number, Record<string, any>>();
        for (const ov of projectOverrides) {
          const colName = fieldToColumnMap[ov.fieldName];
          if (!colName) continue;
          const expense = rowMap.get(ov.rowNumber);
          if (!expense) continue;
          if (!rowGroups.has(expense.id)) rowGroups.set(expense.id, {});
          const fields = rowGroups.get(expense.id)!;
          const effectiveValue = ov.overrideValue === "__null__" ? null : ov.overrideValue;
          fields[colName] = effectiveValue;
          if (ov.fieldName === 'expenseInvoicedDate' && !effectiveValue) {
            fields.invoiceDateConfirmed = false;
          }
          if (ov.fieldName === 'expensePaymentDate' && !effectiveValue) {
            fields.paymentDateConfirmed = false;
          }
        }

        for (const [expenseId, fields] of rowGroups.entries()) {
          if (Object.keys(fields).length > 0) {
            await storage.updateProgramExpenseFields(expenseId, fields);
          }
        }
      }

      logAuditFromReq(req, { entityType: "expenditure_override", action: "direct_apply", changesJson: { description: `${overrides.length} expenditure override(s) applied directly by admin`, count: overrides.length, projectNames } });
      res.json({ message: "Expenditure overrides applied successfully", count: overrides.length });
    } catch (error) {
      console.error("Failed to submit expenditure overrides for approval:", error);
      res.status(500).json({ error: "Failed to save overrides" });
    }
  });

  app.delete("/api/expenditure/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      // Override tables collapsed into base tables — no separate overrides to delete
      logAuditFromReq(req, { entityType: "expenditure_override", action: "delete", projectName, changesJson: { description: "All expenditure overrides deleted for project", projectName } });
      res.json({ message: `Expenditure overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete expenditure overrides", message: "Failed to delete expenditure overrides" });
    }
  });

  // ==================== EXPENSE TASK LINKS API ====================

  app.get("/api/expense-task-links/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const links = await storage.getExpenseTaskLinks(paramStr(req.params.projectName));
      res.json(links);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expense task links" });
    }
  });

  app.post("/api/expense-task-links/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { expenseId, taskId } = req.body;
      if (!expenseId || taskId === undefined) {
        return res.status(400).json({ error: "expenseId and taskId are required" });
      }
      const link = await storage.upsertExpenseTaskLink(paramStr(req.params.projectName), expenseId, taskId, (req.user as any)?.id);

      logAuditFromReq(req, { entityType: "expense_link", action: "create", projectName: paramStr(req.params.projectName), changesJson: { description: "Expense linked to task", expenseId, taskId } });
      res.json(link);
    } catch (error) {
      console.error("Link expense task error:", error);
      res.status(500).json({ error: "Failed to link task" });
    }
  });

  app.delete("/api/expense-task-links/:projectName/:expenseId", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteExpenseTaskLink(paramStr(req.params.projectName), parseIntParam(req.params.expenseId));

      logAuditFromReq(req, { entityType: "expense_link", action: "delete", projectName: paramStr(req.params.projectName), changesJson: { description: "Expense task link removed", expenseId: paramStr(req.params.expenseId) } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to unlink task" });
    }
  });

  app.post("/api/expense-task-links/:projectName/:expenseId/date-override", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { dateOverride, reason } = req.body;
      const projectName = paramStr(req.params.projectName);
      const expenseId = parseIntParam(req.params.expenseId);
      await storage.updateExpenseTaskLinkDateOverride(projectName, expenseId, dateOverride, reason);

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_date_override",
          entityId: `${projectName}|expense${expenseId}`,
          projectName,
          action: "EXPENSE_DATE_OVERRIDDEN",
          summary: `Overrode expense ${expenseId} date to ${dateOverride}${reason ? ` (${reason})` : ''}`,
          oldRecord: {},
          newRecord: { expenseId, dateOverride, reason },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Expense date override audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_date_override", action: "update", projectName, changesJson: { description: "Expense date overridden", expenseId, dateOverride, reason } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save date override" });
    }
  });

  // ==================== MANUAL EXPENSE ROWS API ====================

  app.post("/api/expenses/add-line", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, expenseCategory, expenseLineItem, expenseActualTotal, expensePoNumber, expenseInvoiceNumber, expenseInvoicedDate, expensePaymentDate } = req.body;
      if (!projectName || !expenseCategory) {
        return res.status(400).json({ error: "projectName and expenseCategory are required" });
      }
      const { rows: maxRow } = await getCanonicalProjectCostLinesByName(projectName);
      const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
      const newExpense = await storage.createManualExpense({
        projectName,
        rowNumber: maxRowNum + 1,
        rowType: 'item',
        expenseCategory,
        expenseLineItem: expenseLineItem || null,
        expenseActualTotal: expenseActualTotal || null,
        expensePoNumber: expensePoNumber || null,
        expenseInvoiceNumber: expenseInvoiceNumber || null,
        expenseInvoicedDate: expenseInvoicedDate || null,
        expensePaymentDate: expensePaymentDate || null,
        lineStatus: 'Planned',
        isManual: true,
      } as any);

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_line",
          entityId: `${projectName}|row${newExpense.rowNumber}`,
          projectName,
          action: "MANUAL_EXPENSE_ADDED",
          summary: `Added manual expense line: ${expenseLineItem || expenseCategory}`,
          oldRecord: {},
          newRecord: { expenseCategory, expenseLineItem, expenseActualTotal, isManual: true },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Manual expense add audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_line", action: "create", projectName, changesJson: { description: "Manual expense line added", expenseCategory, expenseLineItem } });
      res.json(newExpense);
    } catch (error) {
      console.error("Add expense line error:", error);
      res.status(500).json({ error: "Failed to add expense line item" });
    }
  });

  app.post("/api/expenses/add-category", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, categoryName } = req.body;
      if (!projectName || !categoryName) {
        return res.status(400).json({ error: "projectName and categoryName are required" });
      }
      const { rows: maxRow } = await getCanonicalProjectCostLinesByName(projectName);
      const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
      const newCategory = await storage.createManualExpense({
        projectName,
        rowNumber: maxRowNum + 1,
        rowType: 'category',
        expenseCategory: categoryName,
        expenseLineItem: categoryName,
        isManual: true,
      } as any);

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_category",
          entityId: `${projectName}|row${newCategory.rowNumber}`,
          projectName,
          action: "MANUAL_CATEGORY_ADDED",
          summary: `Added manual expense category: ${categoryName}`,
          oldRecord: {},
          newRecord: { expenseCategory: categoryName, isManual: true },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Manual category add audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_category", action: "create", projectName, changesJson: { description: "Manual expense category added", categoryName } });
      res.json(newCategory);
    } catch (error) {
      console.error("Add category error:", error);
      res.status(500).json({ error: "Failed to add category" });
    }
  });

  app.post("/api/expenses/insert-task-as-line", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, taskId, expenseCategory } = req.body;
      if (!projectName || !taskId || !expenseCategory) {
        return res.status(400).json({ error: "projectName, taskId, and expenseCategory are required" });
      }
      const [opTasks, planTasks] = await Promise.all([
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
      ]);
      let taskTitle = '';
      let taskEndDate: string | null = null;
      if (taskId > 0) {
        const opTask = opTasks.find((t: any) => t.id === taskId);
        if (opTask) { taskTitle = opTask.title || ''; taskEndDate = opTask.dueDate || null; }
      } else {
        const planTask = planTasks.find((t: any) => t.id === Math.abs(taskId));
        if (planTask) { taskTitle = (planTask as any).highLevelProgramme || `Task ${(planTask as any).taskNo || ''}`; taskEndDate = (planTask as any).actualEnd || null; }
      }
      const { rows: maxRow } = await getCanonicalProjectCostLinesByName(projectName);
      const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
      const newExpense = await storage.createManualExpense({
        projectName,
        rowNumber: maxRowNum + 1,
        rowType: 'item',
        expenseCategory,
        expenseLineItem: taskTitle,
        expensePaymentDate: taskEndDate,
        lineStatus: 'Planned',
        isManual: true,
      } as any);
      await storage.upsertExpenseTaskLink(projectName, newExpense.id, taskId, (req.user as any)?.id);

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_line",
          entityId: `${projectName}|row${newExpense.rowNumber}`,
          projectName,
          action: "TASK_INSERTED_AS_EXPENSE",
          summary: `Inserted task "${taskTitle}" as expense line in ${expenseCategory}`,
          oldRecord: {},
          newRecord: { expenseCategory, expenseLineItem: taskTitle, taskId, isManual: true },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Insert task as expense audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_line", action: "create", projectName, changesJson: { description: "Task inserted as expense line", taskId, taskTitle, expenseCategory } });
      res.json(newExpense);
    } catch (error) {
      console.error("Insert task as line error:", error);
      res.status(500).json({ error: "Failed to insert task as line item" });
    }
  });

  // ==================== EXPENDITURE BREAKDOWN COMPOSITE API ====================

  app.patch("/api/expenditure/font-color-toggle", requireAuth, async (req, res) => {
    try {
      const { projectName, rowNumber, field, color } = req.body;
      if (!projectName || rowNumber == null || !field || !color) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const confirmedField = field === 'invoiceDateFontColor' ? 'invoiceDateConfirmed'
        : field === 'paymentDateFontColor' ? 'paymentDateConfirmed' : null;
      const isBlack = color === 'black';

      const { rows: expenses } = await getCanonicalProjectCostLinesByName(projectName);
      const expense = expenses.find((e: any) => e.rowNumber === rowNumber);
      if (expense) {
        const updateFields: Record<string, any> = { [field]: color };
        if (confirmedField) updateFields[confirmedField] = isBlack;
        await storage.updateProgramExpenseFields(expense.id, updateFields);
      }

      try {
        const oldColor = expense ? (expense as any)[field] || 'unknown' : 'unknown';
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expenditure_font_color",
          entityId: `${projectName}|row${rowNumber}|${field}`,
          projectName,
          action: "FONT_COLOR_TOGGLE",
          summary: `Toggled ${field} from ${oldColor} to ${color} for row ${rowNumber}`,
          oldRecord: { [field]: oldColor },
          newRecord: { [field]: color },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Font color toggle audit failed:", auditErr.message);
      }

      const friendlyField = field === 'paymentDateFontColor' ? 'payment date confirmation' : 'invoice date confirmation';

      logAuditFromReq(req, { entityType: "expenditure_font_color", action: "toggle", projectName, changesJson: { description: `Font color toggled to ${color}`, rowNumber, field, color } });
      res.json({ success: true });
    } catch (error) {
      console.error("Font color toggle error:", error);
      res.status(500).json({ error: "Failed to toggle font color" });
    }
  });

  // REMOVED: /api/expenditure-breakdown duplicate.
  // Canonical route now in finance-routes.ts

  // ==================== COS STATUS OVERRIDE API ====================

  app.post("/api/cos-status-override", requireAuth, async (req, res) => {
    try {
      const { expenseId, projectName, rowNumber, originalStatus, overrideStatus, reason } = req.body;
      if (!expenseId || !projectName || !overrideStatus || !reason) {
        return res.status(400).json({ error: "Missing required fields: expenseId, projectName, overrideStatus, reason" });
      }

      const userName = (req.user as any)?.username || (req.user as any)?.fullName || 'Unknown';

      // DEPRECATED: cosStatusOverrides table removed — override data baked into base rows
      // PE dual-write removed — normalized_cost_lines is canonical source

      logAuditFromReq(req, { entityType: "cos_override", action: "update", entityId: String(expenseId), projectName, changesJson: { description: "COS status overridden", overrideStatus, originalStatus, reason } });
      res.json({ success: true });
    } catch (error) {
      console.error("COS override error:", error);
      res.status(500).json({ error: "Failed to save COS status override" });
    }
  });

  app.delete("/api/cos-status-override/:expenseId", requireAuth, async (req, res) => {
    try {
      const expenseId = parseIntParam(req.params.expenseId);

      // PE dual-write removed — normalized_cost_lines is canonical source
      // DEPRECATED: cosStatusOverrides table removed — override data baked into base rows

      logAuditFromReq(req, { entityType: "cos_override", action: "delete", entityId: String(expenseId), changesJson: { description: "COS status override removed" } });
      res.json({ success: true });
    } catch (error) {
      console.error("COS override delete error:", error);
      res.status(500).json({ error: "Failed to remove COS status override" });
    }
  });

  // ── Record-level cost/revenue line CRUD ────────────────────────────
  // Allows finance users to create, edit, and soft-delete individual
  // cost and revenue line items via the UI (without requiring an import).

  const costLineSchema = z.object({
    projectId: z.number().int(),
    projectName: z.string().min(1),
    description: z.string().optional(),
    supplier: z.string().optional(),
    amountExVat: z.union([z.string(), z.number()]),
    invoiceNumber: z.string().optional(),
    invoiceDate: z.string().optional(),
    paidDate: z.string().optional(),
    poNumber: z.string().optional(),
    category: z.string().optional(),
    notes: z.string().optional(),
  });

  const revenueLineSchema = z.object({
    projectId: z.number().int(),
    projectName: z.string().min(1),
    description: z.string().optional(),
    milestoneDescription: z.string().optional(),
    amountExVat: z.union([z.string(), z.number()]),
    invoiceNumber: z.string().optional(),
    invoiceDate: z.string().optional(),
    paidDate: z.string().optional(),
    expectedPaymentDate: z.string().optional(),
    notes: z.string().optional(),
  });

  // Create a cost line
  app.post("/api/finance/cost-lines", requireAuth, requirePermission("financials", "create"), async (req: Request, res: Response) => {
    try {
      const parsed = costLineSchema.parse(req.body);
      const row = await createCostLine({
        ...parsed,
        source: "MANUAL",
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date(),
      });
      logAuditFromReq(req, { entityType: "cost_line", action: "create", entityId: String(row.id), projectName: parsed.projectName, source: "UI" });
      res.status(201).json(row);
      // Invalidate downstream reads (cached metrics + materialized row) so the
      // next finance read for this project does not serve pre-write state.
      invalidateProjectFinanceReads(parsed.projectId);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Validation error", details: error.issues });
      console.error("[Finance] Failed to create cost line:", error);
      res.status(500).json({ error: "Failed to create cost line" });
    }
  });

  // Update a cost line
  app.patch("/api/finance/cost-lines/:id", requireAuth, requirePermission("financials", "edit"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      const parsed = costLineSchema.partial().parse(req.body);
      const updated = await updateCostLineFields(id, { ...parsed, updatedAt: new Date() });
      if (!updated) return res.status(404).json({ error: "Cost line not found" });
      logAuditFromReq(req, { entityType: "cost_line", action: "update", entityId: String(id), changesJson: parsed, source: "UI" });
      res.json(updated);
      invalidateProjectFinanceReads((updated as any).projectId);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Validation error", details: error.issues });
      console.error("[Finance] Failed to update cost line:", error);
      res.status(500).json({ error: "Failed to update cost line" });
    }
  });

  // Soft-delete a cost line
  app.delete("/api/finance/cost-lines/:id", requireAuth, requirePermission("financials", "edit"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      const [row] = await db.update(normalizedCostLines).set({ effectiveTo: new Date().toISOString() }).where(eq(normalizedCostLines.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Cost line not found" });
      logAuditFromReq(req, { entityType: "cost_line", action: "soft_delete", entityId: String(id), source: "UI" });
      res.json(row);
      invalidateProjectFinanceReads((row as any).projectId);
    } catch (error) {
      console.error("[Finance] Failed to delete cost line:", error);
      res.status(500).json({ error: "Failed to delete cost line" });
    }
  });

  // Create a revenue line
  app.post("/api/finance/revenue-lines", requireAuth, requirePermission("financials", "create"), async (req: Request, res: Response) => {
    try {
      const parsed = revenueLineSchema.parse(req.body);
      const row = await createRevenueLine({
        ...parsed,
        source: "MANUAL",
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date(),
      });
      logAuditFromReq(req, { entityType: "revenue_line", action: "create", entityId: String(row.id), projectName: parsed.projectName, source: "UI" });
      res.status(201).json(row);
      invalidateProjectFinanceReads(parsed.projectId);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Validation error", details: error.issues });
      console.error("[Finance] Failed to create revenue line:", error);
      res.status(500).json({ error: "Failed to create revenue line" });
    }
  });

  // Update a revenue line
  app.patch("/api/finance/revenue-lines/:id", requireAuth, requirePermission("financials", "edit"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      const parsed = revenueLineSchema.partial().parse(req.body);
      const updated = await updateRevenueLineFields(id, { ...parsed, updatedAt: new Date() });
      if (!updated) return res.status(404).json({ error: "Revenue line not found" });
      logAuditFromReq(req, { entityType: "revenue_line", action: "update", entityId: String(id), changesJson: parsed, source: "UI" });
      res.json(updated);
      invalidateProjectFinanceReads((updated as any).projectId);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Validation error", details: error.issues });
      console.error("[Finance] Failed to update revenue line:", error);
      res.status(500).json({ error: "Failed to update revenue line" });
    }
  });

  // Soft-delete a revenue line
  app.delete("/api/finance/revenue-lines/:id", requireAuth, requirePermission("financials", "edit"), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      const [row] = await db.update(normalizedRevenueLines).set({ effectiveTo: new Date().toISOString() }).where(eq(normalizedRevenueLines.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Revenue line not found" });
      logAuditFromReq(req, { entityType: "revenue_line", action: "soft_delete", entityId: String(id), source: "UI" });
      res.json(row);
      invalidateProjectFinanceReads((row as any).projectId);
    } catch (error) {
      console.error("[Finance] Failed to delete revenue line:", error);
      res.status(500).json({ error: "Failed to delete revenue line" });
    }
  });

  // REMOVED: /api/finance/revenue and /api/finance/cos duplicates.
  // Canonical routes now in finance-routes.ts
}

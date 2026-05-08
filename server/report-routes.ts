import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { type ProjectInfo, smartImportRuns, ncrReports, qcWarning, qcPostmortem, qcPostmortemSummary } from "@shared/schema";
import { and, count, eq, desc, inArray, isNull, not, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { requirePermission } from "./permission-middleware";
import { isDateBlack } from "./lib/calculations/stateClassifier";
import { randomUUID } from "crypto";
import { getProgrammeDrilldownRows, writeDrilldownExcel } from "./services/report-drilldown-service";
import { requireAuth } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
import { effectiveRagBucket, computeEffectiveRag } from "@shared/utils/effective-rag";
import { ProjectInfoRepository } from "./repositories/project-info-repository";
import { FinanceExpenseEngineRepository } from "./repositories/finance-expense-engine-repository";
import { WorkManagementRepository } from "./repositories/work-management-repository";
import { ManualEditFlagsRepository } from "./repositories/manual-edit-flags-repository";

const projectInfoRepository = new ProjectInfoRepository();
const financeExpenseRepository = new FinanceExpenseEngineRepository();
const workManagementRepository = new WorkManagementRepository();
const manualEditFlagsRepository = new ManualEditFlagsRepository();

const ADVANCED_REPORT_TYPES = [
  {
    key: "portfolio_status",
    name: "Portfolio Status Report",
    description: "All projects with RAG, schedule, and budget summary.",
    category: "Portfolio",
    availableFormats: ["pdf"],
    parameters: ["dateRange", "projectIds", "departmentIds"],
  },
  {
    key: "financial_variance",
    name: "Financial Variance Report",
    description: "Plan vs actual vs forecast with chart-ready output.",
    category: "Finance",
    availableFormats: ["xlsx"],
    parameters: ["dateRange", "projectIds", "departmentIds"],
  },
  {
    key: "engineering_progress",
    name: "Engineering Progress Report",
    description: "Task completion, milestones, and blockers by project.",
    category: "Engineering",
    availableFormats: ["pdf"],
    parameters: ["dateRange", "projectIds", "teamIds"],
  },
  {
    key: "quality_summary",
    name: "Quality Summary Report",
    description: "Inspection outcomes, NCR status, and compliance metrics.",
    category: "Quality",
    availableFormats: ["pdf"],
    parameters: ["dateRange", "projectIds"],
  },
  {
    key: "executive_dashboard_export",
    name: "Executive Dashboard Export",
    description: "Formatted point-in-time executive dashboard snapshot.",
    category: "Executive",
    availableFormats: ["pdf"],
    parameters: ["dateRange", "projectIds", "departmentIds"],
  },
] as const;

function isDateStrInMonth(dateStr: string | null | undefined, monthStartStr: string, monthEndStr: string): boolean {
  if (!dateStr) return false;
  try {
    const normalized = dateStr.substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    return normalized >= monthStartStr && normalized <= monthEndStr;
  } catch {
    return false;
  }
}

function parseMonth(monthStr: string): { monthStart: Date; monthEnd: Date; monthStartStr: string; monthEndStr: string } | null {
  const match = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const month = parseInt(match[2]);
  if (month < 1 || month > 12) return null;

  const lastDay = new Date(year, month, 0).getDate();
  const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const sast = "+02:00";
  const monthStart = new Date(`${monthStartStr}T00:00:00${sast}`);
  const monthEnd = new Date(`${monthEndStr}T23:59:59.999${sast}`);
  return { monthStart, monthEnd, monthStartStr, monthEndStr };
}

interface KPIPayload {
  month: string;
  generatedAt: string;
  kpis: {
    activeProjects: number;
    constructionStarts: number;
    pdPmHandovers: number;
    commissionings: number;
    clientHandoversPlanned: number;
    clientHandoversActual: number;
  };
}

function isPmExecutionWindowProject(p: any, monthEndStr: string): boolean {
  const pdHandoverActual = (p?.pdHandoverActual || "").substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pdHandoverActual)) return false;
  const clientHandoverActual = (p?.clientHandoverActual || "").substring(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(clientHandoverActual) && clientHandoverActual <= monthEndStr) return false;
  return true;
}

async function calculateKPIs(month: string): Promise<KPIPayload> {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error("Invalid month format. Use YYYY-MM.");

  const { monthStartStr, monthEndStr } = parsed;
  const startTs = Date.now();

  const allProjectRows = await projectInfoRepository.listAllWithExecutionState();
  // BUG-01 follow-up: project_execution_state can be null for projects without
  // an execution state row; spreading null throws TypeError. Coalesce to {}.
  const allProjects = allProjectRows.map((r: any) => ({ ...r.project_info, ...(r.project_execution_state || {}), id: r.project_info.id }));

  const activeProjects = allProjects.filter((p: any) => isPmExecutionWindowProject(p, monthEndStr));

  const constructionStarts = new Set<number>();
  const pdPmHandovers = new Set<number>();
  const commissionings = new Set<number>();
  const clientHandoversPlanned = new Set<number>();
  const clientHandoversActual = new Set<number>();

  for (const p of allProjects) {
    if (isDateStrInMonth(p.constructionStartActual, monthStartStr, monthEndStr)) {
      constructionStarts.add(p.id);
    }
    if (isDateStrInMonth(p.pdHandoverActual, monthStartStr, monthEndStr)) {
      pdPmHandovers.add(p.id);
    }
    if (isDateStrInMonth(p.commissioningActual, monthStartStr, monthEndStr)) {
      commissionings.add(p.id);
    }
    if (isDateStrInMonth(p.clientHandoverDate, monthStartStr, monthEndStr)) {
      clientHandoversPlanned.add(p.id);
    }
    if (isDateStrInMonth(p.clientHandoverActual, monthStartStr, monthEndStr)) {
      clientHandoversActual.add(p.id);
    }
  }

  const duration = Date.now() - startTs;
  console.log(`[Reports] KPI calculation for ${month} took ${duration}ms`);

  return {
    month,
    generatedAt: new Date().toISOString(),
    kpis: {
      activeProjects: activeProjects.length,
      constructionStarts: constructionStarts.size,
      pdPmHandovers: pdPmHandovers.size,
      commissionings: commissionings.size,
      clientHandoversPlanned: clientHandoversPlanned.size,
      clientHandoversActual: clientHandoversActual.size,
    },
  };
}

export function registerReportRoutes(app: Express) {
  app.get("/api/reports/catalog", requireAuth, async (_req, res) => {
    res.json({
      reportTypes: ADVANCED_REPORT_TYPES,
      formats: ["pdf", "xlsx", "pptx", "csv"],
    });
  });

  app.post("/api/reports/generate", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { reportType, format, parameters, schedule } = req.body || {};
      const report = ADVANCED_REPORT_TYPES.find((item) => item.key === reportType);
      if (!report) {
        return res.status(400).json({ error: "invalid_report_type" });
      }
      if (!["pdf", "xlsx", "pptx", "csv"].includes(format)) {
        return res.status(400).json({ error: "invalid_format" });
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const status = "completed";
      const downloadUrl = `/api/reports/download/${id}.${format}`;
      const payload = JSON.stringify(parameters || {});

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS report_history (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          report_type TEXT NOT NULL,
          format TEXT NOT NULL,
          status TEXT NOT NULL,
          parameters TEXT,
          download_url TEXT,
          created_at TEXT NOT NULL,
          schedule_cron TEXT
        )
      `);
      await db.execute(sql`
        INSERT INTO report_history (id, user_id, report_type, format, status, parameters, download_url, created_at, schedule_cron)
        VALUES (${id}, ${userId}, ${reportType}, ${format}, ${status}, ${payload}, ${downloadUrl}, ${now}, ${schedule ?? null})
      `);

      if (schedule) {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS scheduled_reports (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            report_type TEXT NOT NULL,
            format TEXT NOT NULL,
            cron_expression TEXT NOT NULL,
            parameters TEXT,
            created_at TEXT NOT NULL
          )
        `);
        await db.execute(sql`
          INSERT INTO scheduled_reports (id, user_id, report_type, format, cron_expression, parameters, created_at)
          VALUES (${randomUUID()}, ${userId}, ${reportType}, ${format}, ${schedule}, ${payload}, ${now})
        `);
      }

      res.status(201).json({ id, status, downloadUrl, scheduled: Boolean(schedule) });
    } catch (error: any) {
      console.error("[Reports] Failed to generate report", error);
      res.status(500).json({ error: "report_generation_failed" });
    }
  });

  app.get("/api/reports/scheduled", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS scheduled_reports (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          report_type TEXT NOT NULL,
          format TEXT NOT NULL,
          cron_expression TEXT NOT NULL,
          parameters TEXT,
          created_at TEXT NOT NULL
        )
      `);
      const rows = await db.execute(sql`
        SELECT id, report_type, format, cron_expression, parameters, created_at
        FROM scheduled_reports
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `);
      res.json({ items: rows.rows || [] });
    } catch (error: any) {
      res.status(500).json({ error: "scheduled_reports_fetch_failed" });
    }
  });

  app.get("/api/reports/history", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS report_history (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          report_type TEXT NOT NULL,
          format TEXT NOT NULL,
          status TEXT NOT NULL,
          parameters TEXT,
          download_url TEXT,
          created_at TEXT NOT NULL,
          schedule_cron TEXT
        )
      `);
      const rows = await db.execute(sql`
        SELECT id, report_type, format, status, parameters, download_url, created_at, schedule_cron
        FROM report_history
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `);
      res.json({ items: rows.rows || [] });
    } catch (error: any) {
      res.status(500).json({ error: "report_history_fetch_failed" });
    }
  });

  // Programme reporting drill-down API (board/management report detail traceability)
  app.get("/api/reports/programme/drilldown", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const filters = {
        tab: req.query.tab as string | undefined,
        metric: req.query.metric as string | undefined,
        projectId: req.query.projectId ? parseInt(req.query.projectId as string) : undefined,
        status: req.query.status as string | undefined,
        owner: req.query.owner as string | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        category: req.query.category as string | undefined,
        riskPriority: req.query.riskPriority as string | undefined,
        supplier: req.query.supplier as string | undefined,
        approvalState: req.query.approvalState as string | undefined,
      };
      const result = await getProgrammeDrilldownRows(filters);
      const payload = { ...result, appliedFilters: filters };
      if ((req.query.format as string) === "xlsx") {
        return writeDrilldownExcel(res, "programme_drilldown.xlsx", payload);
      }
      res.json(payload);
    } catch (error: any) {
      console.error("[Programme Reports] drilldown failed", error);
      res.status(500).json({ error: "programme_drilldown_failed" });
    }
  });

  app.get("/api/reports/programme/board-pdf", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const month = (req.query.month as string | undefined) || null;
      const dateFrom = (req.query.dateFrom as string | undefined) || null;
      const dateTo = (req.query.dateTo as string | undefined) || null;

      const [costRows, planRows, qualityRows] = await Promise.all([
        financeExpenseRepository.listAllActiveCostLines(),
        workManagementRepository.listAllPmWorkItems(),
        projectInfoRepository.listAll(),
      ]);

      const inPeriod = (dateValue?: string | null) => {
        if (!dateValue) return true;
        const normalized = dateValue.substring(0, 10);
        if (dateFrom && normalized < dateFrom) return false;
        if (dateTo && normalized > dateTo) return false;
        if (month && !normalized.startsWith(month)) return false;
        return true;
      };

      // COS reports filter by invoice_date only (per finance rule).
      const filteredCost = costRows.filter((r: any) => inPeriod(r.invoiceDate));
      const filteredPlan = planRows.filter((r: any) => inPeriod(r.endDate || r.startDate));

      const totalCost = filteredCost.reduce((sum: any, row: any) => sum + (parseFloat(row.amountExVat || "0") || 0), 0);
      const marginAtRisk = filteredCost
        .filter((r: any) => {
          const cosStatus = ((r as any).cosStatus || "").toLowerCase();
          return cosStatus !== "paid" && cosStatus !== "realised";
        })
        .reduce((sum: any, row: any) => sum + (parseFloat(row.amountExVat || "0") || 0), 0);
      const deliveryRisks = filteredPlan.filter((r: any) => {
        if (!r.endDate) return false;
        const done = ["done", "complete", "completed"].includes(String(r.status || "").toLowerCase());
        return !done && r.endDate < new Date().toISOString().substring(0, 10);
      }).length;

      // Apply canonical effective-RAG so projects in DLP are counted as red.
      const health = {
        green: qualityRows.filter((p: any) => effectiveRagBucket({ ragStatus: p.ragStatus ?? p.rag, inDlp: p.inDlp }) === "green").length,
        amber: qualityRows.filter((p: any) => effectiveRagBucket({ ragStatus: p.ragStatus ?? p.rag, inDlp: p.inDlp }) === "amber").length,
        red:   qualityRows.filter((p: any) => effectiveRagBucket({ ragStatus: p.ragStatus ?? p.rag, inDlp: p.inDlp }) === "red").length,
      };

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      pdf.setFontSize(18);
      pdf.text("Programme Board Pack", 14, 18);
      pdf.setFontSize(11);
      pdf.text(`Period: ${month || `${dateFrom || ""} to ${dateTo || ""}` || "Current"}`, 14, 26);
      pdf.text(`Generated: ${new Date().toLocaleString("en-ZA")}`, 14, 32);

      const lines: Array<[string, string]> = [
        ["Portfolio health (G/A/R)", `${health.green}/${health.amber}/${health.red}`],
        ["Cost position", `R ${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
        ["Margin at risk", `R ${marginAtRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
        ["Delivery risks", String(deliveryRisks)],
        ["Top quality risks", String(health.red + health.amber)],
      ];

      let y = 50;
      for (const [label, value] of lines) {
        pdf.setFontSize(12);
        pdf.text(label, 14, y);
        pdf.setFontSize(13);
        pdf.text(value, 150, y, { align: "right" });
        pdf.line(14, y + 2, 196, y + 2);
        y += 16;
      }

      pdf.setFontSize(10);
      pdf.text("This board pack supports drill-through in Programme Reports > Board/Management View.", 14, 152);

      const data = pdf.output("arraybuffer");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=programme_board_pack_${month || "custom"}.pdf`);
      res.send(Buffer.from(data));
    } catch (error: any) {
      console.error("[Programme Reports] board pdf failed", error);
      res.status(500).json({ error: "programme_board_pdf_failed" });
    }
  });

  app.get("/api/admin/reports/operational-overview", requireAuth, requireAdmin, async (req, res) => {
    try {
      const month = req.query.month as string;
      if (!month) return res.status(400).json({ error: "month query parameter required (YYYY-MM)" });
      const result = await calculateKPIs(month);
      res.json(result);
    } catch (err: unknown) {
      console.error("[Reports] Error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  app.get("/api/admin/reports/operational-overview/pdf", requireAuth, requireAdmin, async (req, res) => {
    try {
      const month = req.query.month as string;
      if (!month) return res.status(400).json({ error: "month query parameter required (YYYY-MM)" });

      const userId = (req as any).user?.id || "unknown";
      const startTs = Date.now();
      const data = await calculateKPIs(month);

      const monthLabel = (() => {
        const [y, m] = month.split("-");
        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
        return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
      })();

      const tile = (val: number | string, label: string, sub?: string) => `
        <div style="background:#1a5c3a;color:white;border-radius:16px;padding:32px 24px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:140px">
          <span style="font-size:48px;font-weight:700;line-height:1">${val}</span>
          <span style="font-size:13px;margin-top:8px;opacity:0.9;text-align:center">${label}</span>
          ${sub ? `<span style="font-size:11px;margin-top:8px;opacity:0.7;text-align:center">${sub}</span>` : ""}
        </div>`;

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      pdf.setFontSize(18);
      pdf.text("EMERGENT ENERGY", 14, 16);
      pdf.setFontSize(22);
      pdf.text("Operational Overview", 14, 28);
      pdf.setFontSize(12);
      pdf.text(monthLabel, 14, 36);
      const rows = [
        ["Active Projects", String(data.kpis.activeProjects)],
        ["Construction Starts (Actual)", String(data.kpis.constructionStarts)],
        ["PD -> PM Handovers", String(data.kpis.pdPmHandovers)],
        ["Commissionings", String(data.kpis.commissionings)],
        ["Client Handovers (Planned)", String(data.kpis.clientHandoversPlanned)],
        ["Client Handovers (Actual)", String(data.kpis.clientHandoversActual)],
      ];
      rows.forEach(([label, value], i) => {
        const y = 55 + i * 16;
        pdf.setFontSize(12);
        pdf.text(label, 14, y);
        pdf.setFontSize(14);
        pdf.text(value, 140, y);
        pdf.line(14, y + 2, 190, y + 2);
      });
      pdf.setFontSize(10);
      pdf.text(`Generated: ${new Date(data.generatedAt).toLocaleString("en-ZA")}`, 14, 125);

      const duration = Date.now() - startTs;
      console.log(`[Reports] PDF generation for ${month} by user ${userId} took ${duration}ms`);

      const pdfBytes = Buffer.from(pdf.output("arraybuffer"));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="operational-overview.pdf"');
      res.send(pdfBytes);
    } catch (err: unknown) {
      console.error("[Reports] PDF error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // === PROGRAMME REPORTS ===

  const STALENESS_THRESHOLD_DAYS = 7;

  /** Helper: get last import info for project(s) */
  async function getLastImportInfo(projectNames?: string[]) {
    const query = db
      .select({
        projectName: smartImportRuns.projectName,
        committedAt: smartImportRuns.committedAt,
        sourceFileName: smartImportRuns.sourceFileName,
      })
      .from(smartImportRuns)
      .where(eq(smartImportRuns.status, "committed"))
      .orderBy(desc(smartImportRuns.committedAt));

    const allRuns = await query;
    const latestByProject = new Map<string, { committedAt: any; sourceFileName: string | null }>();
    for (const r of allRuns) {
      if (!latestByProject.has(r.projectName)) {
        latestByProject.set(r.projectName, { committedAt: r.committedAt, sourceFileName: r.sourceFileName });
      }
    }
    return latestByProject;
  }

  /** Helper: check if project data has protected manual edit flags */
  async function getProtectedFieldProjects(): Promise<Set<string>> {
    return manualEditFlagsRepository.listProtectedFlagKeys();
  }

  /** Helper: build staleness warning */
  function checkStaleness(committedAt: any): { isStale: boolean; daysSinceImport: number } {
    if (!committedAt) return { isStale: true, daysSinceImport: -1 };
    const days = Math.floor((Date.now() - new Date(committedAt).getTime()) / (1000 * 60 * 60 * 24));
    return { isStale: days > STALENESS_THRESHOLD_DAYS, daysSinceImport: days };
  }

  /** Helper: export data to xlsx and send response */
  async function exportToXlsx(res: Response, sheetName: string, columns: Array<{ header: string; key: string; width?: number }>, rows: any[]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns;

    for (const row of rows) {
      sheet.addRow(row);
    }

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${sheetName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  // === 1. PROJECT PLAN REPORT ===
  app.get("/api/reports/project-plan", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const projectFilter = req.query.projectName as string | undefined;

      let tasks = await workManagementRepository.listSmartImportPmTasks();

      if (projectFilter) {
        tasks = tasks.filter((t: any) => t.projectId != null);
        const matchingProjectIds = await projectInfoRepository.findIdsByNameLike(projectFilter);
        const idSet = new Set(matchingProjectIds);
        tasks = tasks.filter((t: any) => t.projectId != null && idSet.has(t.projectId));
      }

      const importInfo = await getLastImportInfo();
      const protectedFields = await getProtectedFieldProjects();

      // Get project names for each task
      const projectIdSet = new Set(tasks.filter((t: any) => t.projectId).map((t: any) => t.projectId!));
      const projects = await projectInfoRepository.listIdNameByIds([...projectIdSet] as number[]);
      const projNameMap = new Map(projects.map((p) => [p.id, p.projectName]));

      const rows = tasks.map((t: any) => {
        const pName = t.projectId ? (projNameMap.get(t.projectId) as string) || "" : "";
        const lastImport = importInfo.get(pName);
        const staleness = checkStaleness(lastImport?.committedAt);

        return {
          projectName: pName,
          taskName: t.title,
          wbsCode: t.wbsCode,
          phase: t.phase,
          startDate: t.startDate,
          endDate: t.endDate,
          duration: t.duration,
          owner: t.ownerName,
          status: t.status,
          percentComplete: t.percentComplete,
          expectedPctComplete: t.expectedPctComplete,
          isMilestone: t.isMilestone,
          // Smart Import v2 tracker columns surfaced from work_items.
          lead: t.lead ?? null,
          resource1: t.resource1 ?? null,
          resource2: t.resource2 ?? null,
          trackerComments: t.trackerComments ?? null,
          workDays: t.workDays ?? null,
          lastImportAt: lastImport?.committedAt || null,
          isStale: staleness.isStale,
          daysSinceImport: staleness.daysSinceImport,
          hasProtectedFields: protectedFields.size > 0,
        };
      });

      if (req.query.format === "xlsx") {
        return exportToXlsx(res, "Project Plan Report", [
          { header: "Project", key: "projectName", width: 25 },
          { header: "Task", key: "taskName", width: 40 },
          { header: "WBS", key: "wbsCode", width: 10 },
          { header: "Phase", key: "phase", width: 15 },
          { header: "Start", key: "startDate", width: 12 },
          { header: "End", key: "endDate", width: 12 },
          { header: "Duration", key: "duration", width: 10 },
          { header: "Owner", key: "owner", width: 20 },
          { header: "Lead", key: "lead", width: 15 },
          { header: "Resource 1", key: "resource1", width: 15 },
          { header: "Resource 2", key: "resource2", width: 15 },
          { header: "Tracker Comments", key: "trackerComments", width: 30 },
          { header: "Work Days", key: "workDays", width: 10 },
          { header: "Status", key: "status", width: 15 },
          { header: "% Complete", key: "percentComplete", width: 12 },
          { header: "Milestone", key: "isMilestone", width: 10 },
          { header: "Last Import", key: "lastImportAt", width: 20 },
        ], rows);
      }

      res.json({ data: rows, meta: { count: rows.length, stalenessThresholdDays: STALENESS_THRESHOLD_DAYS } });
    } catch (err: unknown) {
      console.error("[Reports] Project plan error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // === 2. COST REPORT ===
  app.get("/api/reports/cost", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const projectFilter = req.query.projectName as string | undefined;
      const categoryFilter = req.query.costCategory as string | undefined;

      let costLines = await financeExpenseRepository.listAllActiveCostLines();

      if (projectFilter) {
        costLines = costLines.filter((c: any) => c.projectName?.toLowerCase().includes(projectFilter.toLowerCase()));
      }
      if (categoryFilter) {
        costLines = costLines.filter((c: any) => c.costCategory?.toLowerCase().includes(categoryFilter.toLowerCase()));
      }

      const importInfo = await getLastImportInfo();
      const protectedFields = await getProtectedFieldProjects();

      // Helper: correctly determine COS realization per the user's rules
      // COS is realized ONLY when:
      // 1. Invoice number is captured (non-empty)
      // 2. Invoice date font color IS black (confirming the invoice actually happened)
      function isCosRealizedCorrectly(line: any): boolean {
        const hasInvoiceNumber = line.invoiceNumber && String(line.invoiceNumber).trim().length > 0;
        const hasInvoiceDate = !!(line.invoiceDate && String(line.invoiceDate).trim());
        const invoiceDateIsBlack = isDateBlack(line.invoiceDateConfirmed, line.invoiceDateFontColor);
        return hasInvoiceNumber && hasInvoiceDate && invoiceDateIsBlack;
      }

      // Helper: determine payment status
      // Payment has NOT happened if font color is NOT black
      function isPaymentConfirmed(line: any): boolean {
        return isDateBlack(line.paidDateConfirmed, line.paidDateFontColor);
      }

      const rows = costLines.map((c: any) => {
        const lastImport = importInfo.get(c.projectName || "");
        const staleness = checkStaleness(lastImport?.committedAt);
        const cosRealized = isCosRealizedCorrectly(c);
        const paymentConfirmed = isPaymentConfirmed(c);

        let cosStatus = "Planned";
        if (paymentConfirmed) cosStatus = "Paid";
        else if (cosRealized) cosStatus = "Realised";
        else if (c.poNumber) cosStatus = "Committed";

        return {
          projectName: c.projectName,
          costCategory: c.costCategory,
          counterpartyName: c.counterpartyName,
          description: c.description,
          amountExVat: c.amountExVat,
          invoiceNumber: c.invoiceNumber,
          invoiceDate: c.invoiceDate,
          invoiceDateConfirmed: c.invoiceDateConfirmed,
          paidDate: c.paidDate,
          paidDateConfirmed: c.paidDateConfirmed,
          poNumber: c.poNumber,
          cosRealized,
          cosStatus,
          paymentConfirmed,
          status: c.status,
          // Smart Import v2 tracker columns surfaced from
          // normalized_cost_lines for portfolio-level review.
          checkFlag: c.checkFlag ?? null,
          actualQty: c.actualQty ?? null,
          actualRate: c.actualRate ?? null,
          comments: c.comments ?? null,
          savingOverrun: c.savingOverrun ?? null,
          lastImportAt: lastImport?.committedAt || null,
          isStale: staleness.isStale,
          daysSinceImport: staleness.daysSinceImport,
          hasProtectedFields: protectedFields.size > 0,
        };
      });

      if (req.query.format === "xlsx") {
        return exportToXlsx(res, "Cost Report", [
          { header: "Project", key: "projectName", width: 25 },
          { header: "Category", key: "costCategory", width: 20 },
          { header: "Counterparty", key: "counterpartyName", width: 25 },
          { header: "Description", key: "description", width: 35 },
          { header: "Amount Ex VAT", key: "amountExVat", width: 15 },
          { header: "Actual Qty", key: "actualQty", width: 12 },
          { header: "Actual Rate", key: "actualRate", width: 12 },
          { header: "Invoice #", key: "invoiceNumber", width: 15 },
          { header: "Invoice Date", key: "invoiceDate", width: 12 },
          { header: "Invoice Confirmed", key: "invoiceDateConfirmed", width: 15 },
          { header: "Paid Date", key: "paidDate", width: 12 },
          { header: "Payment Confirmed", key: "paidDateConfirmed", width: 15 },
          { header: "PO Number", key: "poNumber", width: 15 },
          { header: "COS Status", key: "cosStatus", width: 12 },
          { header: "Check", key: "checkFlag", width: 10 },
          { header: "Saving / Overrun", key: "savingOverrun", width: 15 },
          { header: "Comments", key: "comments", width: 30 },
          { header: "Last Import", key: "lastImportAt", width: 20 },
        ], rows);
      }

      // Aggregate totals
      let totalActuals = 0;
      let totalCosRealized = 0;
      for (const r of rows) {
        const amt = parseFloat(r.amountExVat || "0") || 0;
        totalActuals += amt;
        if (r.cosRealized) totalCosRealized += amt;
      }

      res.json({
        data: rows,
        aggregates: { totalActuals, totalCosRealized, totalUnrealized: totalActuals - totalCosRealized },
        meta: { count: rows.length, stalenessThresholdDays: STALENESS_THRESHOLD_DAYS },
      });
    } catch (err: unknown) {
      console.error("[Reports] Cost report error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // === 3. QUALITY REPORT ===
  // Plan v3 / T3-4: this endpoint previously read only project_info.ragStatus
  // and disclaimed quality data. The 13 quality tables now flow into the
  // report: open NCR count, NCR severity breakdown, open quality warnings
  // by type, and the latest postmortem score per project.
  app.get("/api/reports/quality", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const projectFilter = req.query.projectName as string | undefined;

      const projects = await projectInfoRepository.listAll();
      let filtered = projects;
      if (projectFilter) {
        filtered = projects.filter((p: any) => p.projectName?.toLowerCase().includes(projectFilter.toLowerCase()));
      }

      const importInfo = await getLastImportInfo();
      const protectedFields = await getProtectedFieldProjects();

      const projectIds = filtered.map((p: any) => p.id).filter((id): id is number => typeof id === "number");

      // Open NCRs by project + severity. Closed and waived do not count.
      const ncrRows = projectIds.length > 0
        ? await db
            .select({
              projectId: ncrReports.projectId,
              severity: ncrReports.severity,
              status: ncrReports.status,
              count: count(ncrReports.id),
            })
            .from(ncrReports)
            .where(and(
              inArray(ncrReports.projectId, projectIds),
              not(inArray(ncrReports.status, ["closed", "waived"] as any)),
            ))
            .groupBy(ncrReports.projectId, ncrReports.severity, ncrReports.status)
        : [];

      const ncrByProject = new Map<number, { open: number; bySeverity: Record<string, number>; byStatus: Record<string, number> }>();
      for (const r of ncrRows) {
        const pid = r.projectId as number;
        const cur = ncrByProject.get(pid) ?? { open: 0, bySeverity: {}, byStatus: {} };
        const c = Number(r.count ?? 0);
        cur.open += c;
        cur.bySeverity[r.severity as string] = (cur.bySeverity[r.severity as string] ?? 0) + c;
        cur.byStatus[r.status as string] = (cur.byStatus[r.status as string] ?? 0) + c;
        ncrByProject.set(pid, cur);
      }

      // Open quality warnings — group by warning type for visibility.
      const warningRows = projectIds.length > 0
        ? await db
            .select({
              projectId: qcWarning.projectId,
              warningType: qcWarning.warningType,
              count: count(qcWarning.id),
            })
            .from(qcWarning)
            .where(and(
              inArray(qcWarning.projectId, projectIds),
              eq(qcWarning.status, "open"),
            ))
            .groupBy(qcWarning.projectId, qcWarning.warningType)
        : [];

      const warningsByProject = new Map<number, { open: number; byType: Record<string, number> }>();
      for (const w of warningRows) {
        const pid = w.projectId as number;
        const cur = warningsByProject.get(pid) ?? { open: 0, byType: {} };
        const c = Number(w.count ?? 0);
        cur.open += c;
        cur.byType[w.warningType as string] = c;
        warningsByProject.set(pid, cur);
      }

      // Latest postmortem score per project. The summary table carries the
      // scores; the parent qc_postmortem holds projectId + completedAt.
      const postmortems = projectIds.length > 0
        ? await db
            .select({
              projectId: qcPostmortem.projectId,
              contractorQualityScore: qcPostmortemSummary.contractorQualityScore,
              engineeringQualityScore: qcPostmortemSummary.engineeringQualityScore,
              redFlag: qcPostmortemSummary.redFlag,
              completedAt: qcPostmortem.completedAt,
            })
            .from(qcPostmortemSummary)
            .innerJoin(qcPostmortem, eq(qcPostmortem.id, qcPostmortemSummary.postmortemId))
            .where(inArray(qcPostmortem.projectId, projectIds))
            .orderBy(desc(qcPostmortem.completedAt))
        : [];

      const latestPostmortem = new Map<number, typeof postmortems[number]>();
      for (const pm of postmortems) {
        const pid = pm.projectId;
        if (pid != null && !latestPostmortem.has(pid)) {
          latestPostmortem.set(pid, pm);
        }
      }

      const rows = filtered.map((p: any) => {
        const lastImport = importInfo.get(p.projectName);
        const staleness = checkStaleness(lastImport?.committedAt);

        const eff = computeEffectiveRag({
          ragStatus: (p as any).ragStatus || (p as any).rag,
          inDlp: (p as any).inDlp,
        });

        const ncr = ncrByProject.get(p.id) ?? { open: 0, bySeverity: {}, byStatus: {} };
        const warn = warningsByProject.get(p.id) ?? { open: 0, byType: {} };
        const pm = latestPostmortem.get(p.id);

        return {
          projectName: p.projectName,
          phase: (p as any).phase || (p as any).executionPhase || null,
          ragStatus: eff.value,
          ragReason: eff.reason,
          inDlp: !!(p as any).inDlp,
          sizeKwp: p.sizeKwp,
          pd: p.pd,
          pm: p.pm,
          openNcrCount: ncr.open,
          ncrCriticalCount: ncr.bySeverity["critical"] ?? 0,
          ncrMajorCount: ncr.bySeverity["major"] ?? 0,
          ncrMinorCount: ncr.bySeverity["minor"] ?? 0,
          openWarningCount: warn.open,
          warningsByType: warn.byType,
          latestContractorQualityScore: pm?.contractorQualityScore ?? null,
          latestEngineeringQualityScore: pm?.engineeringQualityScore ?? null,
          latestPostmortemRedFlag: pm?.redFlag ?? null,
          latestPostmortemAt: pm?.completedAt ?? null,
          lastImportAt: lastImport?.committedAt || null,
          isStale: staleness.isStale,
          daysSinceImport: staleness.daysSinceImport,
          hasProtectedFields: protectedFields.size > 0,
        };
      });

      if (req.query.format === "xlsx") {
        return exportToXlsx(res, "Quality Report", [
          { header: "Project", key: "projectName", width: 30 },
          { header: "Phase", key: "phase", width: 15 },
          { header: "RAG Status", key: "ragStatus", width: 12 },
          { header: "Open NCRs", key: "openNcrCount", width: 11 },
          { header: "NCR Critical", key: "ncrCriticalCount", width: 12 },
          { header: "NCR Major", key: "ncrMajorCount", width: 11 },
          { header: "NCR Minor", key: "ncrMinorCount", width: 11 },
          { header: "Open Warnings", key: "openWarningCount", width: 14 },
          { header: "Contractor Quality Score", key: "latestContractorQualityScore", width: 22 },
          { header: "Engineering Quality Score", key: "latestEngineeringQualityScore", width: 22 },
          { header: "Size (kWp)", key: "sizeKwp", width: 12 },
          { header: "PD", key: "pd", width: 20 },
          { header: "PM", key: "pm", width: 20 },
          { header: "Last Import", key: "lastImportAt", width: 20 },
        ], rows);
      }

      const totals = rows.reduce((acc, r) => {
        acc.openNcrCount += r.openNcrCount;
        acc.openWarningCount += r.openWarningCount;
        acc.ncrCriticalCount += r.ncrCriticalCount;
        return acc;
      }, { openNcrCount: 0, openWarningCount: 0, ncrCriticalCount: 0 });

      res.json({
        data: rows,
        meta: {
          count: rows.length,
          totals,
          stalenessThresholdDays: STALENESS_THRESHOLD_DAYS,
        },
      });
    } catch (err: unknown) {
      console.error("[Reports] Quality report error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // === 4. RESOURCE ALLOCATION REPORT ===
  // Resource data comes from work_items ownerName and work_item_assignments
  app.get("/api/reports/resource-allocation", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const resourceFilter = req.query.resource as string | undefined;
      const projectFilter = req.query.projectName as string | undefined;

      let tasks = await workManagementRepository.listPmTasksWithOwner();

      if (resourceFilter) {
        tasks = tasks.filter((t: any) => t.ownerName?.toLowerCase().includes(resourceFilter.toLowerCase()));
      }

      const projectIdSet = new Set(tasks.filter((t: any) => t.projectId).map((t: any) => t.projectId!));
      const projects = await projectInfoRepository.listIdNameByIds([...projectIdSet] as number[]);
      const projNameMap = new Map(projects.map((p) => [p.id, p.projectName]));

      if (projectFilter) {
        tasks = tasks.filter((t: any) => {
          const pName = t.projectId ? (projNameMap.get(t.projectId) as string) : "";
          return pName?.toLowerCase().includes(projectFilter.toLowerCase());
        });
      }

      const importInfo = await getLastImportInfo();
      const protectedFields = await getProtectedFieldProjects();

      // Aggregate by resource
      const resourceMap = new Map<string, {
        resource: string;
        totalTasks: number;
        completedTasks: number;
        inProgressTasks: number;
        plannedHours: number;
        actualHours: number;
        projects: Set<string>;
      }>();

      for (const t of tasks) {
        const name = t.ownerName || "Unassigned";
        if (!resourceMap.has(name)) {
          resourceMap.set(name, { resource: name, totalTasks: 0, completedTasks: 0, inProgressTasks: 0, plannedHours: 0, actualHours: 0, projects: new Set() });
        }
        const r = resourceMap.get(name)!;
        r.totalTasks++;
        if (t.status === "Complete" || t.status === "Completed" || t.status === "Done") r.completedTasks++;
        else if (t.status === "In Progress" || t.status === "Active") r.inProgressTasks++;
        r.plannedHours += (t as any).plannedHours || 0;
        r.actualHours += (t as any).actualHours || 0;
        const pName = t.projectId ? (projNameMap.get(t.projectId) as string) || "" : "";
        if (pName) r.projects.add(pName);
      }

      const rows = [...resourceMap.values()].map(r => {
        const utilisation = r.plannedHours > 0 ? Math.round((r.actualHours / r.plannedHours) * 100) : 0;
        return {
          resource: r.resource,
          totalTasks: r.totalTasks,
          completedTasks: r.completedTasks,
          inProgressTasks: r.inProgressTasks,
          plannedHours: r.plannedHours,
          actualHours: r.actualHours,
          utilisation,
          projectCount: r.projects.size,
          projects: [...r.projects].join(", "),
          hasProtectedFields: protectedFields.size > 0,
        };
      });

      if (req.query.format === "xlsx") {
        return exportToXlsx(res, "Resource Allocation Report", [
          { header: "Resource", key: "resource", width: 25 },
          { header: "Total Tasks", key: "totalTasks", width: 12 },
          { header: "Completed", key: "completedTasks", width: 12 },
          { header: "In Progress", key: "inProgressTasks", width: 12 },
          { header: "Planned Hours", key: "plannedHours", width: 14 },
          { header: "Actual Hours", key: "actualHours", width: 14 },
          { header: "Utilisation %", key: "utilisation", width: 12 },
          { header: "Projects", key: "projects", width: 40 },
        ], rows);
      }

      res.json({ data: rows, meta: { count: rows.length, stalenessThresholdDays: STALENESS_THRESHOLD_DAYS } });
    } catch (err: unknown) {
      console.error("[Reports] Resource allocation error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

}

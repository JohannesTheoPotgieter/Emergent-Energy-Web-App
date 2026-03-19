import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { projectInfo, type ProjectInfo, smartImportRuns, normalizedCostLines, normalizedRevenueLines, workItems, manualEditFlags } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import ExcelJS from "exceljs";
import { requirePermission } from "./permission-middleware";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      req.user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role } as any;
      return next();
    }
  }
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  res.status(403).json({ error: "admin_required", message: "Admin access required" });
}

const INACTIVE_STATUSES = ["Cancelled", "Archived", "Complete", "Closed", "Handover Complete", "Completed"];

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
  };
}

async function calculateKPIs(month: string): Promise<KPIPayload> {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error("Invalid month format. Use YYYY-MM.");

  const { monthStartStr, monthEndStr } = parsed;
  const startTs = Date.now();

  const allProjects = await db.select().from(projectInfo);

  const activeProjects = allProjects.filter((p: ProjectInfo) => {
    if (!p.isActive) return false;
    const phase = (p.phase || "").trim();
    return !INACTIVE_STATUSES.some(s => s.toLowerCase() === phase.toLowerCase());
  });

  const constructionStarts = new Set<number>();
  const pdPmHandovers = new Set<number>();
  const commissionings = new Set<number>();
  const clientHandoversPlanned = new Set<number>();

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
    },
  };
}

export function registerReportRoutes(app: Express) {
  app.get("/api/admin/reports/operational-overview", requireAuth, requireAdmin, async (req, res) => {
    try {
      const month = req.query.month as string;
      if (!month) return res.status(400).json({ error: "month query parameter required (YYYY-MM)" });
      const result = await calculateKPIs(month);
      res.json(result);
    } catch (err: any) {
      console.error("[Reports] Error:", err.message);
      res.status(400).json({ error: err.message });
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

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter','Segoe UI',sans-serif;background:#fff}
.slide{position:relative;width:1100px;aspect-ratio:16/9;overflow:hidden}
.bar{position:absolute;right:0;top:0;bottom:0;width:64px;background:#1a5c3a}
.content{position:relative;z-index:1;padding:32px 80px 32px 40px;display:flex;flex-direction:column;height:100%}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;flex:1}
.footer{margin-top:auto;padding-top:16px;display:flex;justify-content:space-between;font-size:10px;color:#999}
</style></head><body>
<div class="slide">
  <div class="bar"></div>
  <div class="content">
    <div style="font-size:18px;font-weight:700;color:#1a5c3a;margin-bottom:4px">EMERGENT ENERGY</div>
    <h1 style="font-size:24px;font-weight:700;color:#1a5c3a;margin-top:16px">Operational Overview</h1>
    <p style="font-size:14px;color:#4a7c5e;margin-bottom:32px">${monthLabel}</p>
    <div class="grid">
      ${tile(data.kpis.activeProjects, "Active Projects")}
      ${tile(data.kpis.constructionStarts, "Construction Starts (Actual)")}
      ${tile(data.kpis.pdPmHandovers, "PD → PM Handovers")}
      ${tile(data.kpis.commissionings, "Commissionings")}
      ${tile(data.kpis.clientHandoversPlanned, "Client Handovers (Planned)")}
    </div>
    <div class="footer">
      <span>Generated: ${new Date(data.generatedAt).toLocaleString("en-ZA")}</span>
      <span style="color:#1a5c3a;font-weight:500">CONFIDENTIAL</span>
    </div>
  </div>
</div>
</body></html>`;

      const duration = Date.now() - startTs;
      console.log(`[Reports] PDF HTML generation for ${month} by user ${userId} took ${duration}ms`);

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `inline; filename="Operational Overview - ${monthLabel}.html"`);
      res.send(html);
    } catch (err: any) {
      console.error("[Reports] PDF error:", err.message);
      res.status(400).json({ error: err.message });
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
      .where(eq(smartImportRuns.status, "COMMITTED"))
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
    const flags = await db.select({ entityType: manualEditFlags.entityType, entityId: manualEditFlags.entityId })
      .from(manualEditFlags)
      .where(eq(manualEditFlags.isProtected, true));
    // Return a set of entity IDs that have protected flags
    return new Set(flags.map(f => `${f.entityType}::${f.entityId}`));
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

      let wiQuery = db.select().from(workItems)
        .where(and(
          eq(workItems.workstream, "PM"),
          eq(workItems.source, "SMART_IMPORT"),
          sql`${workItems.deletedAt} IS NULL`,
        ))
        .orderBy(workItems.projectId, workItems.sourceRow);

      let tasks = await wiQuery;

      if (projectFilter) {
        tasks = tasks.filter(t => t.projectId != null);
        const projIds = await db.select({ id: projectInfo.id }).from(projectInfo)
          .where(sql`${projectInfo.projectName} ILIKE ${'%' + projectFilter + '%'}`);
        const idSet = new Set(projIds.map(p => p.id));
        tasks = tasks.filter(t => t.projectId != null && idSet.has(t.projectId));
      }

      const importInfo = await getLastImportInfo();
      const protectedFields = await getProtectedFieldProjects();

      // Get project names for each task
      const projectIdSet = new Set(tasks.filter(t => t.projectId).map(t => t.projectId!));
      const projects = projectIdSet.size > 0
        ? await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo)
            .where(inArray(projectInfo.id, [...projectIdSet] as number[]))
        : [];
      const projNameMap = new Map(projects.map(p => [p.id, p.projectName]));

      const rows = tasks.map(t => {
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
          { header: "Status", key: "status", width: 15 },
          { header: "% Complete", key: "percentComplete", width: 12 },
          { header: "Milestone", key: "isMilestone", width: 10 },
          { header: "Last Import", key: "lastImportAt", width: 20 },
        ], rows);
      }

      res.json({ data: rows, meta: { count: rows.length, stalenessThresholdDays: STALENESS_THRESHOLD_DAYS } });
    } catch (err: any) {
      console.error("[Reports] Project plan error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // === 2. COST REPORT ===
  app.get("/api/reports/cost", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const projectFilter = req.query.projectName as string | undefined;
      const categoryFilter = req.query.costCategory as string | undefined;

      let costLines = await db.select().from(normalizedCostLines);

      if (projectFilter) {
        costLines = costLines.filter(c => c.projectName?.toLowerCase().includes(projectFilter.toLowerCase()));
      }
      if (categoryFilter) {
        costLines = costLines.filter(c => c.costCategory?.toLowerCase().includes(categoryFilter.toLowerCase()));
      }

      const importInfo = await getLastImportInfo();
      const protectedFields = await getProtectedFieldProjects();

      // Helper: correctly determine COS realization per the user's rules
      // COS is realized ONLY when:
      // 1. Invoice number is captured (non-empty)
      // 2. Invoice date font color IS black (confirming the invoice actually happened)
      function isCosRealizedCorrectly(line: any): boolean {
        const hasInvoiceNumber = line.invoiceNumber && String(line.invoiceNumber).trim().length > 0;
        const invoiceDateIsBlack = line.invoiceDateConfirmed === true;
        return hasInvoiceNumber && invoiceDateIsBlack;
      }

      // Helper: determine payment status
      // Payment has NOT happened if font color is NOT black
      function isPaymentConfirmed(line: any): boolean {
        return line.paidDateConfirmed === true;
      }

      const rows = costLines.map(c => {
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
          { header: "Invoice #", key: "invoiceNumber", width: 15 },
          { header: "Invoice Date", key: "invoiceDate", width: 12 },
          { header: "Invoice Confirmed", key: "invoiceDateConfirmed", width: 15 },
          { header: "Paid Date", key: "paidDate", width: 12 },
          { header: "Payment Confirmed", key: "paidDateConfirmed", width: 15 },
          { header: "PO Number", key: "poNumber", width: 15 },
          { header: "COS Status", key: "cosStatus", width: 12 },
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
    } catch (err: any) {
      console.error("[Reports] Cost report error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // === 3. QUALITY REPORT ===
  // Quality is tracked via RAG status on projects. No separate quality_metrics table exists.
  app.get("/api/reports/quality", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const projectFilter = req.query.projectName as string | undefined;

      const projects = await db.select().from(projectInfo);
      let filtered = projects;
      if (projectFilter) {
        filtered = projects.filter(p => p.projectName?.toLowerCase().includes(projectFilter.toLowerCase()));
      }

      const importInfo = await getLastImportInfo();
      const protectedFields = await getProtectedFieldProjects();

      const rows = filtered.map(p => {
        const lastImport = importInfo.get(p.projectName);
        const staleness = checkStaleness(lastImport?.committedAt);

        return {
          projectName: p.projectName,
          phase: (p as any).phase || (p as any).executionPhase || null,
          ragStatus: (p as any).ragStatus || (p as any).rag || null,
          sizeKwp: p.sizeKwp,
          pd: p.pd,
          pm: p.pm,
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
          { header: "Size (kWp)", key: "sizeKwp", width: 12 },
          { header: "PD", key: "pd", width: 20 },
          { header: "PM", key: "pm", width: 20 },
          { header: "Last Import", key: "lastImportAt", width: 20 },
        ], rows);
      }

      res.json({ data: rows, meta: { count: rows.length, stalenessThresholdDays: STALENESS_THRESHOLD_DAYS } });
    } catch (err: any) {
      console.error("[Reports] Quality report error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // === 4. RESOURCE ALLOCATION REPORT ===
  // Resource data comes from work_items ownerName and work_item_assignments
  app.get("/api/reports/resource-allocation", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const resourceFilter = req.query.resource as string | undefined;
      const projectFilter = req.query.projectName as string | undefined;

      let tasks = await db.select().from(workItems)
        .where(and(
          eq(workItems.workstream, "PM"),
          sql`${workItems.deletedAt} IS NULL`,
          sql`${workItems.ownerName} IS NOT NULL`,
        ));

      if (resourceFilter) {
        tasks = tasks.filter(t => t.ownerName?.toLowerCase().includes(resourceFilter.toLowerCase()));
      }

      const projectIdSet = new Set(tasks.filter(t => t.projectId).map(t => t.projectId!));
      const projects = projectIdSet.size > 0
        ? await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo)
            .where(inArray(projectInfo.id, [...projectIdSet] as number[]))
        : [];
      const projNameMap = new Map(projects.map(p => [p.id, p.projectName]));

      if (projectFilter) {
        tasks = tasks.filter(t => {
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
    } catch (err: any) {
      console.error("[Reports] Resource allocation error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

}

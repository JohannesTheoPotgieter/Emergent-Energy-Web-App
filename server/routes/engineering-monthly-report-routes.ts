/**
 * Engineering Monthly Report API Routes
 */

import type { Express } from "express";
import { db } from "../db";
import { monthlyReportSnapshots, users } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requirePermission } from "../permission-middleware";
import { generateEngineeringReportData } from "../services/engineering-monthly-report-service";
import { requireAuth, validateMonth, computeKpiDeltas, computeReportFreshness } from "./monthly-report-shared";
import { getEngineeringDrilldownRows, writeDrilldownExcel } from "../services/report-drilldown-service";
import { parseIntParam } from "../lib/req-params";
import { logAuditFromReq } from "../audit-logger";

const REPORT_TYPE = "engineering";

async function getSnapshotById(id: number) {
  const [snapshot] = await db.select().from(monthlyReportSnapshots)
    .where(and(eq(monthlyReportSnapshots.id, id), eq(monthlyReportSnapshots.reportType, REPORT_TYPE)))
    .limit(1);
  return snapshot;
}

async function getOrCreateSnapshot(month: string) {
  const [existing] = await db.select().from(monthlyReportSnapshots)
    .where(and(eq(monthlyReportSnapshots.reportType, REPORT_TYPE), eq(monthlyReportSnapshots.reportMonth, month)))
    .limit(1);

  if (existing) return existing;

  const data = await generateEngineeringReportData(month);
  const [inserted] = await db.insert(monthlyReportSnapshots).values({
    reportType: REPORT_TYPE,
    reportMonth: month,
    status: "draft",
    data,
    generatedAt: new Date(),
  }).returning();

  return inserted;
}

async function resolveUserNames(userIds: Set<number>): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (userIds.size > 0) {
    const rows = await db.select({ id: users.id, name: users.name }).from(users);
    for (const u of rows) names.set(u.id, u.name);
  }
  return names;
}

export function registerEngineeringMonthlyReportRoutes(app: Express) {
  // GET monthly report
  app.get("/api/reports/engineering/monthly", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const monthCheck = validateMonth(req.query.month as string);
      if (!monthCheck.valid) return res.status(400).json({ error: monthCheck.error });

      const snapshot = await getOrCreateSnapshot(req.query.month as string);

      let reviewedByName = null;
      let publishedByName = null;
      if (snapshot.reviewedBy) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, snapshot.reviewedBy)).limit(1);
        reviewedByName = u?.name || null;
      }
      if (snapshot.publishedBy) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, snapshot.publishedBy)).limit(1);
        publishedByName = u?.name || null;
      }

      const freshness = await computeReportFreshness(snapshot.regeneratedAt ?? snapshot.generatedAt);

      res.json({
        id: snapshot.id,
        reportType: snapshot.reportType,
        reportMonth: snapshot.reportMonth,
        status: snapshot.status,
        data: snapshot.data,
        generatedAt: snapshot.generatedAt,
        regeneratedAt: snapshot.regeneratedAt,
        reviewedBy: reviewedByName,
        reviewedAt: snapshot.reviewedAt,
        publishedBy: publishedByName,
        publishedAt: snapshot.publishedAt,
        freshness,
      });
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // GET history
  app.get("/api/reports/engineering/monthly/history", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const snapshots = await db.select({
        id: monthlyReportSnapshots.id,
        reportMonth: monthlyReportSnapshots.reportMonth,
        status: monthlyReportSnapshots.status,
        generatedAt: monthlyReportSnapshots.generatedAt,
        regeneratedAt: monthlyReportSnapshots.regeneratedAt,
        reviewedBy: monthlyReportSnapshots.reviewedBy,
        reviewedAt: monthlyReportSnapshots.reviewedAt,
        publishedBy: monthlyReportSnapshots.publishedBy,
        publishedAt: monthlyReportSnapshots.publishedAt,
      }).from(monthlyReportSnapshots)
        .where(eq(monthlyReportSnapshots.reportType, REPORT_TYPE))
        .orderBy(desc(monthlyReportSnapshots.reportMonth));

      const allUserIds = new Set<number>();
      for (const s of snapshots) {
        if (s.reviewedBy) allUserIds.add(s.reviewedBy);
        if (s.publishedBy) allUserIds.add(s.publishedBy);
      }
      const userNames = await resolveUserNames(allUserIds);

      const history = snapshots.map((s: any) => ({
        ...s,
        reviewedByName: s.reviewedBy ? (userNames.get(s.reviewedBy) || null) : null,
        publishedByName: s.publishedBy ? (userNames.get(s.publishedBy) || null) : null,
      }));

      res.json({ data: history });
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] History error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // POST review
  app.post("/api/reports/engineering/monthly/:id/review", requireAuth, requirePermission("reports", "edit"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "User ID required" });

      const snapshot = await getSnapshotById(id);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status !== "draft") return res.status(409).json({ error: "Report must be in draft status to review" });

      await db.update(monthlyReportSnapshots).set({
        status: "reviewed",
        reviewedBy: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      logAuditFromReq(req, {
        entityType: "monthly_report",
        entityId: String(id),
        action: "review",
        changesJson: {
          report_type: REPORT_TYPE,
          report_month: snapshot.reportMonth,
          from_status: "draft",
          to_status: "reviewed",
        },
      });

      res.json({ success: true, status: "reviewed" });
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Review error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // POST publish (requires publish permission; enforces segregation of duties)
  app.post("/api/reports/engineering/monthly/:id/publish", requireAuth, requirePermission("reports", "publish" as any), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "User ID required" });

      const snapshot = await getSnapshotById(id);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status !== "reviewed") return res.status(409).json({ error: "Report must be in reviewed status to publish" });
      if (snapshot.reviewedBy === userId) return res.status(403).json({ error: "Publisher must be different from reviewer (segregation of duties)" });

      await db.update(monthlyReportSnapshots).set({
        status: "published",
        publishedBy: userId,
        publishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      logAuditFromReq(req, {
        entityType: "monthly_report",
        entityId: String(id),
        action: "publish",
        changesJson: {
          report_type: REPORT_TYPE,
          report_month: snapshot.reportMonth,
          from_status: "reviewed",
          to_status: "published",
        },
      });

      res.json({ success: true, status: "published" });
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Publish error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // POST revert
  app.post("/api/reports/engineering/monthly/:id/revert", requireAuth, requirePermission("reports", "publish" as any), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const snapshot = await getSnapshotById(id);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status === "published") return res.status(409).json({ error: "Published reports cannot be reverted" });
      if (snapshot.status !== "reviewed") return res.status(409).json({ error: "Only reviewed reports can be reverted" });

      await db.update(monthlyReportSnapshots).set({
        status: "draft",
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      logAuditFromReq(req, {
        entityType: "monthly_report",
        entityId: String(id),
        action: "revert",
        changesJson: {
          report_type: REPORT_TYPE,
          report_month: snapshot.reportMonth,
          from_status: "reviewed",
          to_status: "draft",
        },
      });

      res.json({ success: true, status: "draft" });
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Revert error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // POST regenerate
  app.post("/api/reports/engineering/monthly/:id/regenerate", requireAuth, requirePermission("reports", "edit"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const snapshot = await getSnapshotById(id);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status !== "draft") return res.status(409).json({ error: "Only draft reports can be regenerated" });

      const data = await generateEngineeringReportData(snapshot.reportMonth);
      await db.update(monthlyReportSnapshots).set({
        data,
        regeneratedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      logAuditFromReq(req, {
        entityType: "monthly_report",
        entityId: String(id),
        action: "regenerate",
        changesJson: {
          report_type: REPORT_TYPE,
          report_month: snapshot.reportMonth,
          status: "draft",
        },
      });

      const [updated] = await db.select().from(monthlyReportSnapshots).where(and(eq(monthlyReportSnapshots.id, id), eq(monthlyReportSnapshots.reportType, REPORT_TYPE))).limit(1);
      res.json({
        id: updated.id,
        reportMonth: updated.reportMonth,
        status: updated.status,
        data: updated.data,
        generatedAt: updated.generatedAt,
        regeneratedAt: updated.regeneratedAt,
      });
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Regenerate error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // GET export PDF
  app.get("/api/reports/engineering/monthly/:id/export/pdf", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const snapshot = await getSnapshotById(id);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });

      const { generateReportPdf } = await import("../services/monthly-report-pdf-service");
      const pdfBuffer = await generateReportPdf(REPORT_TYPE, snapshot.data as any, snapshot.reportMonth);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Engineering_Monthly_Report_${snapshot.reportMonth}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] PDF export error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // GET export Excel
  app.get("/api/reports/engineering/monthly/:id/export/excel", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const snapshot = await getSnapshotById(id);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });

      const { generateReportExcel } = await import("../services/monthly-report-excel-service");
      await generateReportExcel(REPORT_TYPE, snapshot.data as any, snapshot.reportMonth, res);
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Excel export error:", (err instanceof Error ? err.message : String(err)));
      if (!res.headersSent) throw err;
    }
  });

  // GET comparison (with server-side deltas)
  app.get("/api/reports/engineering/monthly/compare", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const checkA = validateMonth(req.query.monthA as string);
      const checkB = validateMonth(req.query.monthB as string);
      if (!checkA.valid) return res.status(400).json({ error: `monthA: ${checkA.error}` });
      if (!checkB.valid) return res.status(400).json({ error: `monthB: ${checkB.error}` });

      const monthA = req.query.monthA as string;
      const monthB = req.query.monthB as string;

      const [snapshotA] = await db.select().from(monthlyReportSnapshots)
        .where(and(eq(monthlyReportSnapshots.reportType, REPORT_TYPE), eq(monthlyReportSnapshots.reportMonth, monthA)))
        .limit(1);
      const [snapshotB] = await db.select().from(monthlyReportSnapshots)
        .where(and(eq(monthlyReportSnapshots.reportType, REPORT_TYPE), eq(monthlyReportSnapshots.reportMonth, monthB)))
        .limit(1);

      if (!snapshotA) return res.status(404).json({ error: `No report available for ${monthA}. Generate it first.` });
      if (!snapshotB) return res.status(404).json({ error: `No report available for ${monthB}. Generate it first.` });

      const kpisA = (snapshotA.data as any)?.kpis || {};
      const kpisB = (snapshotB.data as any)?.kpis || {};

      res.json({
        monthA: { month: monthA, status: snapshotA.status, data: snapshotA.data },
        monthB: { month: monthB, status: snapshotB.status, data: snapshotB.data },
        deltas: computeKpiDeltas(kpisA, kpisB),
      });
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Compare error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // GET per-project drill-down
  app.get("/api/reports/engineering/monthly/:id/project/:projectId", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const projectId = parseIntParam(req.params.projectId);

      const snapshot = await getSnapshotById(id);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });

      const data = snapshot.data as any;

      const projectData = {
        tasks: data.tasks?.perProject?.find((t: any) => t.projectId === projectId) || null,
        deliverables: data.deliverables?.register?.filter((d: any) => d.projectId === projectId) || [],
        stageGates: data.stageGates?.filter((s: any) => s.projectId === projectId) || [],
        approvals: data.approvals?.filter((a: any) => a.projectId === projectId) || [],
      };

      res.json(projectData);
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Project drill-down error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });

  // Shared KPI/chart/exception drill-down
  app.get("/api/reports/engineering/monthly/:reportId/drilldown", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const reportId = parseIntParam(req.params.reportId);
      const [snapshot] = await db.select().from(monthlyReportSnapshots)
        .where(and(eq(monthlyReportSnapshots.id, reportId), eq(monthlyReportSnapshots.reportType, REPORT_TYPE)))
        .limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });

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

      const result = await getEngineeringDrilldownRows(filters);
      const payload = { ...result, appliedFilters: filters };

      if ((req.query.format as string) === "xlsx") {
        return writeDrilldownExcel(res, `engineering_monthly_drilldown_${snapshot.reportMonth}.xlsx`, payload);
      }
      res.json(payload);
    } catch (err: unknown) {
      console.error("[Engineering Monthly Report] Drill-down error:", (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  });
}

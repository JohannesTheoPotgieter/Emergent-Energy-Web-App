/**
 * PM Monthly Report API Routes
 */

import type { Express } from "express";
import { db } from "../db";
import { monthlyReportSnapshots, users } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requirePermission } from "../permission-middleware";
import { generatePmReportData } from "../services/pm-monthly-report-service";
import { generateReportPdf } from "../services/monthly-report-pdf-service";
import { generateReportExcel } from "../services/monthly-report-excel-service";
import { requireAuth, validateMonth, computeKpiDeltas } from "./monthly-report-shared";

const REPORT_TYPE = "pm";

async function getOrCreateSnapshot(month: string) {
  const [existing] = await db.select().from(monthlyReportSnapshots)
    .where(and(eq(monthlyReportSnapshots.reportType, REPORT_TYPE), eq(monthlyReportSnapshots.reportMonth, month)))
    .limit(1);

  if (existing) return existing;

  const data = await generatePmReportData(month);
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

export function registerPmMonthlyReportRoutes(app: Express) {
  // GET monthly report (generate or retrieve)
  app.get("/api/reports/pm/monthly", requireAuth, requirePermission("reports", "view"), async (req, res) => {
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
      });
    } catch (err: any) {
      console.error("[PM Monthly Report] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET report history
  app.get("/api/reports/pm/monthly/history", requireAuth, requirePermission("reports", "view"), async (req, res) => {
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

      const history = snapshots.map(s => ({
        ...s,
        reviewedByName: s.reviewedBy ? (userNames.get(s.reviewedBy) || null) : null,
        publishedByName: s.publishedBy ? (userNames.get(s.publishedBy) || null) : null,
      }));

      res.json({ data: history });
    } catch (err: any) {
      console.error("[PM Monthly Report] History error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST review
  app.post("/api/reports/pm/monthly/:id/review", requireAuth, requirePermission("reports", "edit"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "User ID required" });

      const [snapshot] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status !== "draft") return res.status(409).json({ error: "Report must be in draft status to review" });

      await db.update(monthlyReportSnapshots).set({
        status: "reviewed",
        reviewedBy: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      res.json({ success: true, status: "reviewed" });
    } catch (err: any) {
      console.error("[PM Monthly Report] Review error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST publish (requires publish permission; enforces segregation of duties)
  app.post("/api/reports/pm/monthly/:id/publish", requireAuth, requirePermission("reports", "publish" as any), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "User ID required" });

      const [snapshot] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status !== "reviewed") return res.status(409).json({ error: "Report must be in reviewed status to publish" });
      if (snapshot.reviewedBy === userId) return res.status(403).json({ error: "Publisher must be different from reviewer (segregation of duties)" });

      await db.update(monthlyReportSnapshots).set({
        status: "published",
        publishedBy: userId,
        publishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      res.json({ success: true, status: "published" });
    } catch (err: any) {
      console.error("[PM Monthly Report] Publish error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST revert to draft
  app.post("/api/reports/pm/monthly/:id/revert", requireAuth, requirePermission("reports", "publish" as any), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [snapshot] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status === "published") return res.status(409).json({ error: "Published reports cannot be reverted" });
      if (snapshot.status !== "reviewed") return res.status(409).json({ error: "Only reviewed reports can be reverted to draft" });

      await db.update(monthlyReportSnapshots).set({
        status: "draft",
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      res.json({ success: true, status: "draft" });
    } catch (err: any) {
      console.error("[PM Monthly Report] Revert error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST regenerate (draft only)
  app.post("/api/reports/pm/monthly/:id/regenerate", requireAuth, requirePermission("reports", "edit"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [snapshot] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });
      if (snapshot.status !== "draft") return res.status(409).json({ error: "Only draft reports can be regenerated" });

      const data = await generatePmReportData(snapshot.reportMonth);
      await db.update(monthlyReportSnapshots).set({
        data,
        regeneratedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(monthlyReportSnapshots.id, id));

      const [updated] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      res.json({
        id: updated.id,
        reportMonth: updated.reportMonth,
        status: updated.status,
        data: updated.data,
        generatedAt: updated.generatedAt,
        regeneratedAt: updated.regeneratedAt,
      });
    } catch (err: any) {
      console.error("[PM Monthly Report] Regenerate error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET export PDF
  app.get("/api/reports/pm/monthly/:id/export/pdf", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [snapshot] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });

      const pdfBuffer = await generateReportPdf(REPORT_TYPE, snapshot.data as any, snapshot.reportMonth);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="PM_Monthly_Report_${snapshot.reportMonth}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("[PM Monthly Report] PDF export error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET export Excel
  app.get("/api/reports/pm/monthly/:id/export/excel", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [snapshot] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });

      await generateReportExcel(REPORT_TYPE, snapshot.data as any, snapshot.reportMonth, res);
    } catch (err: any) {
      console.error("[PM Monthly Report] Excel export error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // GET comparison (with server-side computed deltas)
  app.get("/api/reports/pm/monthly/compare", requireAuth, requirePermission("reports", "view"), async (req, res) => {
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
    } catch (err: any) {
      console.error("[PM Monthly Report] Compare error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET per-project drill-down
  app.get("/api/reports/pm/monthly/:id/project/:projectId", requireAuth, requirePermission("reports", "view"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const projectId = parseInt(req.params.projectId);

      const [snapshot] = await db.select().from(monthlyReportSnapshots).where(eq(monthlyReportSnapshots.id, id)).limit(1);
      if (!snapshot) return res.status(404).json({ error: "Report not found" });

      const data = snapshot.data as any;

      const projectData = {
        projectStatus: data.projectStatus?.find((p: any) => p.projectId === projectId) || null,
        financials: {
          revenue: data.financials?.revenueSummary?.find((r: any) => r.projectId === projectId) || null,
          cost: data.financials?.costSummary?.find((c: any) => c.projectId === projectId) || null,
          grossProfit: data.financials?.grossProfit?.find((g: any) => g.projectId === projectId) || null,
        },
        tasks: data.tasks?.perProject?.find((t: any) => t.projectId === projectId) || null,
        raidItems: data.raidItems?.items?.filter((r: any) => r.projectId === projectId) || [],
        quality: data.quality?.qcProgress?.find((q: any) => q.projectId === projectId) || null,
        procurement: data.procurement?.filter((p: any) => p.projectId === projectId) || [],
      };

      res.json(projectData);
    } catch (err: any) {
      console.error("[PM Monthly Report] Project drill-down error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

/**
 * D5: Board pack PDF generation endpoint.
 * Aggregates portfolio data and generates a downloadable PDF report.
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { db } from "../db";
import { sql } from "drizzle-orm";
import PDFDocument from "pdfkit";

const router = Router();

router.get("/api/reports/board-pack", requireAuth, async (_req: Request, res: Response) => {
  try {
    // Fetch portfolio summary data
    const projectsResult = await db.execute(sql`
      SELECT
        pi.project_name,
        pi.pm,
        pes.phase,
        pes.rag_status,
        prs.planned_revenue,
        prs.actual_revenue,
        prs.planned_expenditure,
        prs.actual_expenditure,
        prs.current_vo_total
      FROM project_info pi
      LEFT JOIN project_execution_state pes ON pes.project_id = pi.id
      LEFT JOIN project_revenue_summary prs ON prs.project_id = pi.id AND prs.effective_to IS NULL
      WHERE pi.deleted_at IS NULL
        AND pes.is_active = true
      ORDER BY pi.project_name
    `);
    const projects = (projectsResult as any).rows || [];

    // Aggregates
    let totalRevenue = 0, totalActualRevenue = 0, totalExpenses = 0, totalActualExpenses = 0, totalVo = 0;
    const ragCounts: Record<string, number> = { Green: 0, Amber: 0, Red: 0 };
    const phaseCounts: Record<string, number> = {};

    for (const p of projects) {
      totalRevenue += Number(p.planned_revenue || 0);
      totalActualRevenue += Number(p.actual_revenue || 0);
      totalExpenses += Number(p.planned_expenditure || 0);
      totalActualExpenses += Number(p.actual_expenditure || 0);
      totalVo += Number(p.current_vo_total || 0);
      const rag = p.rag_status || "Green";
      ragCounts[rag] = (ragCounts[rag] || 0) + 1;
      const phase = p.phase || "Unknown";
      phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
    }

    // Generate PDF
    const doc = new PDFDocument({ size: "A4", margin: 50, info: {
      Title: "Portfolio Board Pack",
      Author: "Emergent Energy",
    }});

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="board-pack-${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);

    // Title
    doc.fontSize(20).font("Helvetica-Bold").text("Portfolio Board Pack", { align: "center" });
    doc.fontSize(10).font("Helvetica").text(`Generated: ${new Date().toLocaleDateString("en-ZA")}`, { align: "center" });
    doc.moveDown(2);

    // Executive Summary
    doc.fontSize(14).font("Helvetica-Bold").text("Executive Summary");
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Active Projects: ${projects.length}`);
    doc.text(`RAG Status: ${ragCounts.Green || 0} Green, ${ragCounts.Amber || 0} Amber, ${ragCounts.Red || 0} Red`);
    doc.text(`Planned Revenue: R ${(totalRevenue / 1_000_000).toFixed(1)}M`);
    doc.text(`Actual Revenue: R ${(totalActualRevenue / 1_000_000).toFixed(1)}M (${totalRevenue > 0 ? ((totalActualRevenue / totalRevenue) * 100).toFixed(1) : 0}% realised)`);
    doc.text(`Actual Expenses: R ${(totalActualExpenses / 1_000_000).toFixed(1)}M`);
    const margin = totalActualRevenue > 0 ? ((totalActualRevenue - totalActualExpenses) / totalActualRevenue * 100).toFixed(1) : "0.0";
    doc.text(`Portfolio Margin: ${margin}%`);
    doc.text(`VO Exposure: R ${(totalVo / 1_000_000).toFixed(1)}M`);
    doc.moveDown(1.5);

    // Phase Distribution
    doc.fontSize(14).font("Helvetica-Bold").text("Phase Distribution");
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica");
    for (const [phase, count] of Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])) {
      doc.text(`  ${phase}: ${count} projects`);
    }
    doc.moveDown(1.5);

    // Project Table
    doc.fontSize(14).font("Helvetica-Bold").text("Project Status");
    doc.moveDown(0.5);

    // Table header
    const tableTop = doc.y;
    const colX = [50, 200, 280, 330, 410];
    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Project", colX[0], tableTop, { width: 145 });
    doc.text("PM", colX[1], tableTop, { width: 75 });
    doc.text("Phase", colX[2], tableTop, { width: 45 });
    doc.text("RAG", colX[3], tableTop, { width: 75 });
    doc.text("Revenue", colX[4], tableTop, { width: 80 });

    doc.moveTo(50, tableTop + 12).lineTo(545, tableTop + 12).stroke();
    let y = tableTop + 16;

    doc.font("Helvetica").fontSize(7);
    for (const p of projects.slice(0, 40)) { // Limit to 40 for page space
      if (y > 750) {
        doc.addPage();
        y = 50;
      }
      const name = (p.project_name || "").replace(/_Tracker.*$/i, "").replace(/_/g, " ").slice(0, 30);
      doc.text(name, colX[0], y, { width: 145 });
      doc.text((p.pm || "—").slice(0, 15), colX[1], y, { width: 75 });
      doc.text((p.phase || "—").slice(0, 12), colX[2], y, { width: 45 });
      doc.text(p.rag_status || "—", colX[3], y, { width: 75 });
      const rev = Number(p.actual_revenue || 0);
      doc.text(rev > 0 ? `R ${(rev / 1000).toFixed(0)}K` : "—", colX[4], y, { width: 80 });
      y += 11;
    }

    doc.end();
  } catch (err) {
    console.error("[BoardPack] PDF generation failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate board pack" });
    }
  }
});

export function registerBoardPackRoutes(app: Express) {
  app.use(router);
}

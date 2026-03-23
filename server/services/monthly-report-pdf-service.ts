/**
 * Monthly Report PDF Generation Service
 * Uses pdfkit to generate branded multi-page PDF reports.
 */

import PDFDocument from "pdfkit";
import { getMonthLabel } from "./pm-monthly-report-service";

const EE_GREEN = "#1a5c3a";
const EE_GREEN_LIGHT = "#4a7c5e";
const WHITE = "#ffffff";
const GREY = "#666666";
const LIGHT_GREY = "#f5f5f5";
const RED = "#DC3545";
const AMBER = "#FFC107";
const GREEN = "#28A745";

function ragColor(rag: string | null): string {
  const upper = (rag || "").toUpperCase();
  if (upper === "RED") return RED;
  if (upper === "AMBER") return AMBER;
  if (upper === "GREEN") return GREEN;
  return GREY;
}

function formatCurrency(val: number): string {
  return `R ${val.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(val: number): string {
  return `${val.toFixed(1)}%`;
}

export async function generateReportPdf(reportType: string, data: any, month: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const monthLabel = getMonthLabel(month);
    const title = reportType === "pm" ? "Project Management Monthly Report" : "Engineering Monthly Report";

    // ===== PAGE 1: Cover =====
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(EE_GREEN);
    doc.fillColor(WHITE);
    doc.fontSize(14).text("EMERGENT ENERGY", 40, 80, { align: "left" });
    doc.moveDown(4);
    doc.fontSize(28).text(title, 40, 200, { align: "center", width: doc.page.width - 80 });
    doc.moveDown(1);
    doc.fontSize(18).text(monthLabel, { align: "center" });
    doc.moveDown(2);
    doc.fontSize(11).text(`Generated: ${new Date().toLocaleDateString("en-ZA")}`, { align: "center" });
    doc.fontSize(11).text(`Status: ${data.meta?.status || "Draft"}`, { align: "center" });
    doc.moveDown(8);
    doc.fontSize(9).fillColor(WHITE).text("CONFIDENTIAL", 40, doc.page.height - 60, { align: "center", width: doc.page.width - 80 });

    // ===== PAGE 2: KPI Dashboard =====
    doc.addPage();
    doc.fillColor(EE_GREEN).fontSize(16).text("Key Performance Indicators", 40, 40);
    doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).strokeColor(EE_GREEN).stroke();

    const kpis = data.kpis || {};
    const kpiItems = reportType === "pm" ? [
      { label: "Active Projects", value: String(kpis.activeProjects ?? 0) },
      { label: "Total Contract Value", value: formatCurrency(kpis.totalContractValue ?? 0) },
      { label: "Construction Starts", value: String(kpis.constructionStarts ?? 0) },
      { label: "Commissionings", value: String(kpis.commissionings ?? 0) },
      { label: "GP Margin", value: formatPct(kpis.blendedGpMarginPct ?? 0) },
      { label: "Projects at Risk", value: String(kpis.projectsAtRisk ?? 0) },
    ] : [
      { label: "Total Eng Tasks", value: String(kpis.totalEngineeringTasks ?? 0) },
      { label: "Completed This Month", value: String(kpis.tasksCompletedThisMonth ?? 0) },
      { label: "Completion Rate", value: formatPct(kpis.completionRate ?? 0) },
      { label: "Deliverables Approved", value: String(kpis.deliverablesApproved ?? 0) },
      { label: "Open Blockers", value: String(kpis.openBlockers ?? 0) },
    ];

    let kpiY = 80;
    const kpiColWidth = (doc.page.width - 120) / 3;
    kpiItems.forEach((kpi, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 40 + col * (kpiColWidth + 20);
      const y = kpiY + row * 70;

      doc.roundedRect(x, y, kpiColWidth, 55, 6).fill(EE_GREEN);
      doc.fillColor(WHITE).fontSize(20).text(kpi.value, x + 10, y + 8, { width: kpiColWidth - 20, align: "center" });
      doc.fontSize(8).text(kpi.label, x + 10, y + 34, { width: kpiColWidth - 20, align: "center" });
    });

    // ===== PAGE 3+: Tables =====
    if (reportType === "pm") {
      // Financial Summary
      if (data.financials?.grossProfit?.length > 0) {
        doc.addPage();
        doc.fillColor(EE_GREEN).fontSize(16).text("Financial Summary — Gross Profit", 40, 40);
        doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).strokeColor(EE_GREEN).stroke();

        const headers = ["Project", "Revenue", "Cost", "GP", "GP %"];
        const colWidths = [180, 90, 90, 90, 60];
        let tableY = 75;

        // Header row
        let hx = 40;
        doc.rect(40, tableY, doc.page.width - 80, 18).fill(EE_GREEN);
        headers.forEach((h, i) => {
          doc.fillColor(WHITE).fontSize(8).text(h, hx + 4, tableY + 4, { width: colWidths[i] - 8 });
          hx += colWidths[i];
        });
        tableY += 18;

        // Data rows
        const gpRows = (data.financials.grossProfit || []).slice(0, 30);
        for (let ri = 0; ri < gpRows.length; ri++) {
          if (tableY > doc.page.height - 60) { doc.addPage(); tableY = 40; }
          const r = gpRows[ri];
          if (ri % 2 === 0) doc.rect(40, tableY, doc.page.width - 80, 16).fill(LIGHT_GREY);
          let rx = 40;
          const vals = [
            r.projectName?.substring(0, 30) || "",
            formatCurrency(r.revenue || 0),
            formatCurrency(r.cost || 0),
            formatCurrency(r.grossProfit || 0),
            formatPct(r.gpMarginPct || 0),
          ];
          vals.forEach((v, i) => {
            doc.fillColor("#333").fontSize(7).text(v, rx + 4, tableY + 3, { width: colWidths[i] - 8 });
            rx += colWidths[i];
          });
          tableY += 16;
        }
      }

      // Project Status
      if (data.projectStatus?.length > 0) {
        doc.addPage();
        doc.fillColor(EE_GREEN).fontSize(16).text("Project Status Overview", 40, 40);
        doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).strokeColor(EE_GREEN).stroke();

        const headers = ["Project", "Phase", "RAG", "PM", "Health"];
        const colWidths = [180, 100, 60, 100, 70];
        let tableY = 75;

        let hx = 40;
        doc.rect(40, tableY, doc.page.width - 80, 18).fill(EE_GREEN);
        headers.forEach((h, i) => {
          doc.fillColor(WHITE).fontSize(8).text(h, hx + 4, tableY + 4, { width: colWidths[i] - 8 });
          hx += colWidths[i];
        });
        tableY += 18;

        const psRows = (data.projectStatus || []).slice(0, 35);
        for (let ri = 0; ri < psRows.length; ri++) {
          if (tableY > doc.page.height - 60) { doc.addPage(); tableY = 40; }
          const r = psRows[ri];
          if (ri % 2 === 0) doc.rect(40, tableY, doc.page.width - 80, 16).fill(LIGHT_GREY);
          let rx = 40;
          const vals = [
            r.projectName?.substring(0, 30) || "",
            r.phase || "—",
            r.ragStatus || "—",
            r.pm || "—",
            r.healthScore ? r.healthScore.toFixed(1) : "—",
          ];
          vals.forEach((v, i) => {
            const color = i === 2 ? ragColor(r.ragStatus) : "#333";
            doc.fillColor(color).fontSize(7).text(v, rx + 4, tableY + 3, { width: colWidths[i] - 8 });
            rx += colWidths[i];
          });
          tableY += 16;
        }
      }
    } else {
      // Engineering: Task Completion
      if (data.tasks?.perProject?.length > 0) {
        doc.addPage();
        doc.fillColor(EE_GREEN).fontSize(16).text("Engineering Task Completion", 40, 40);
        doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).strokeColor(EE_GREEN).stroke();

        const headers = ["Project", "Total", "Done", "In Prog", "Overdue", "Done %"];
        const colWidths = [200, 60, 60, 60, 60, 60];
        let tableY = 75;

        let hx = 40;
        doc.rect(40, tableY, doc.page.width - 80, 18).fill(EE_GREEN);
        headers.forEach((h, i) => {
          doc.fillColor(WHITE).fontSize(8).text(h, hx + 4, tableY + 4, { width: colWidths[i] - 8 });
          hx += colWidths[i];
        });
        tableY += 18;

        const rows = (data.tasks.perProject || []).slice(0, 35);
        for (let ri = 0; ri < rows.length; ri++) {
          if (tableY > doc.page.height - 60) { doc.addPage(); tableY = 40; }
          const r = rows[ri];
          if (ri % 2 === 0) doc.rect(40, tableY, doc.page.width - 80, 16).fill(LIGHT_GREY);
          let rx = 40;
          const vals = [r.projectName || "", String(r.totalTasks), String(r.completed), String(r.inProgress), String(r.overdue), formatPct(r.completionPct || 0)];
          vals.forEach((v, i) => {
            doc.fillColor("#333").fontSize(7).text(v, rx + 4, tableY + 3, { width: colWidths[i] - 8 });
            rx += colWidths[i];
          });
          tableY += 16;
        }
      }

      // Deliverables
      if (data.deliverables?.register?.length > 0) {
        doc.addPage();
        doc.fillColor(EE_GREEN).fontSize(16).text("Deliverable Register", 40, 40);
        doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).strokeColor(EE_GREEN).stroke();

        const headers = ["Project", "Deliverable", "Type", "Status", "Owner"];
        const colWidths = [140, 140, 80, 80, 80];
        let tableY = 75;

        let hx = 40;
        doc.rect(40, tableY, doc.page.width - 80, 18).fill(EE_GREEN);
        headers.forEach((h, i) => {
          doc.fillColor(WHITE).fontSize(8).text(h, hx + 4, tableY + 4, { width: colWidths[i] - 8 });
          hx += colWidths[i];
        });
        tableY += 18;

        const rows = (data.deliverables.register || []).slice(0, 35);
        for (let ri = 0; ri < rows.length; ri++) {
          if (tableY > doc.page.height - 60) { doc.addPage(); tableY = 40; }
          const r = rows[ri];
          if (ri % 2 === 0) doc.rect(40, tableY, doc.page.width - 80, 16).fill(LIGHT_GREY);
          let rx = 40;
          const vals = [r.projectName?.substring(0, 25) || "", r.title?.substring(0, 25) || "", r.type || "", r.status || "", r.ownerName || "—"];
          vals.forEach((v, i) => {
            doc.fillColor("#333").fontSize(7).text(v, rx + 4, tableY + 3, { width: colWidths[i] - 8 });
            rx += colWidths[i];
          });
          tableY += 16;
        }
      }
    }

    // Footer on last page
    doc.fillColor(GREY).fontSize(8)
      .text(`Page ${doc.bufferedPageRange().count}`, 40, doc.page.height - 40, { align: "center", width: doc.page.width - 80 })
      .text("Confidential — Emergent Energy", 40, doc.page.height - 28, { align: "center", width: doc.page.width - 80 });

    doc.end();
  });
}

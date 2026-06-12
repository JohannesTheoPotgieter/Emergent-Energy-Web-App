/**
 * Revenue Tracking / milestone block — header-signature detection + FLAG.
 *
 * The Revenue Tracking ledger is the cash/AR source and is SEPARATE from
 * recognised revenue. Across trackers the milestone block does NOT sit in a
 * fixed position, so the importer locates it by HEADER SIGNATURE
 * (Milestone / Invoice / Date / Amount / Received) wherever it sits — and when
 * it cannot be confidently located it FLAGS "milestone block not found" rather
 * than silently skipping it (a silent skip under-counts inflows invisibly).
 *
 * These tests build real workbooks and exercise the real detector + preview.
 */

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { detectSections } from "../../../server/lib/import/detector";
import { runSmartImportPreview } from "../../../server/lib/import/index";

function milestoneHeader(): string[] {
  return [
    "Payment Milestone",
    "No.",
    "%",
    "Value (excl. VAT)",
    "VAT",
    "Invoice Number",
    "Invoice Raised Date",
    "Planned Payment Date",
    "Payment Received Date",
    "In Bank Date",
  ];
}

function addMilestoneBlock(ws: ExcelJS.Worksheet): void {
  ws.addRow(milestoneHeader());
  ws.addRow(["Deposit", "1", "20", "200000", "30000", "INV-001", "2026-01-15", "2026-01-30", "2026-02-10", "2026-02-12"]);
  ws.addRow(["Delivery", "2", "40", "400000", "60000", "INV-002", "2026-02-20", "2026-03-05", "", ""]);
  ws.addRow(["Commissioning", "3", "40", "400000", "60000", "", "", "", "", ""]);
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A minimal Project Plan sheet so PLAN claims it (the real-tracker shape). */
function addPlanSheet(wb: ExcelJS.Workbook, name = "Project Plan"): void {
  const ws = wb.addWorksheet(name);
  ws.addRow(["No.", "Task", "Planned Start", "Planned End", "Duration", "Actual Start", "Actual End", "Status"]);
  ws.addRow(["1", "Site establishment", "2026-01-05", "2026-01-12", "7", "2026-01-06", "2026-01-13", "100%"]);
  ws.addRow(["2", "Module install", "2026-01-13", "2026-02-20", "38", "", "", "10%"]);
}

describe("milestone block detection — located by header signature wherever it sits", () => {
  it("finds the milestone block in a NON-revenue-named sheet, at a non-top position", async () => {
    const wb = new ExcelJS.Workbook();
    addPlanSheet(wb); // realistic: PLAN claims the plan sheet ...
    // ... and the milestone block sits on a sheet whose NAME is not a revenue
    // anchor, a few rows down — so REVENUE must rely on the header signature.
    const ws = wb.addWorksheet("Commercials");
    ws.addRow(["Emergent Energy — Commercial Summary"]);
    ws.addRow([]);
    ws.addRow(["Some preamble", "ignore me"]);
    addMilestoneBlock(ws);

    const detection = detectSections(wb);

    const revenue = detection.sections.find((s) => s.section === "REVENUE");
    expect(revenue, "REVENUE block should be located by header signature").toBeDefined();
    expect(revenue!.sheetName).toBe("Commercials");
    expect(detection.missingSections).not.toContain("REVENUE");
  });

  it("preview raises NO milestone-not-found flag when the block is present", async () => {
    const wb = new ExcelJS.Workbook();
    addPlanSheet(wb);
    const ws = wb.addWorksheet("Revenue Tracking");
    addMilestoneBlock(ws);

    const preview = await runSmartImportPreview(await toBuffer(wb), "Seshego_Tracker.xlsx");
    const flag = preview.normalization.issues.find((i) => i.issueType === "milestone_block_not_found");
    expect(flag).toBeUndefined();
    expect(preview.detection.missingSections).not.toContain("REVENUE");
  });
});

describe("milestone block detection — FLAG, never silently skip", () => {
  it("flags 'milestone block not found' when no milestone block exists in any sheet", async () => {
    const wb = new ExcelJS.Workbook();
    // Only an expenditure-shaped sheet — no milestone header signature anywhere.
    const ws = wb.addWorksheet("Expenditure Breakdown");
    ws.addRow(["Product/Service", "Description of Work", "Supplier", "Budget Total", "Actual Total", "PO Number", "Invoice Number"]);
    ws.addRow(["Panels", "Supply 500kWp", "Acme Solar", "1000000", "980000", "PO-1", "INV-9"]);

    const detection = detectSections(wb);
    expect(detection.missingSections).toContain("REVENUE");

    const preview = await runSmartImportPreview(await toBuffer(wb), "NoMilestones_Tracker.xlsx");
    const flag = preview.normalization.issues.find((i) => i.issueType === "milestone_block_not_found");
    expect(flag, "a milestone-not-found flag must be surfaced").toBeDefined();
    expect(flag!.section).toBe("REVENUE");
    expect(flag!.message).toContain("NoMilestones_Tracker.xlsx");
    // The flag forces operator review — it is not a silent skip.
    expect(preview.needsReview).toBe(true);
  });
});

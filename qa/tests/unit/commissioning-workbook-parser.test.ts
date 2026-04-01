import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseCommissioningWorkbook,
  mapRawToDisplayStatus,
  isCompleteForGate,
  calculateBlockers,
  calculateOverallStatus,
  calculateCompletionPercent,
} from "../../../server/services/commissioning-workbook-parser";
import type { CommissioningSection, CommissioningDisplayStatus } from "@shared/schema/commissioning-source";

// ===================== TEST HELPERS =====================

const REQUIRED_SHEETS = ["QA List", "Techsitter Report", "Communication Report", "Inspection Report", "Testing Report", "O&M Handover"];
const INFORMATIONAL_SHEETS = ["Cover Page", "Project Information", "Final Completion Certificate"];
const ALL_SHEETS = [...REQUIRED_SHEETS, ...INFORMATIONAL_SHEETS];

async function createWorkbook(opts: {
  sheets?: string[];
  sectionStatuses?: Record<string, { status: string; by: string; date: string }>;
  omChecklist?: { row: number; doc: string; status: string; comments: string }[];
  projectInfo?: { D6?: string; D9?: string; D17?: string };
  finalCompletion?: { D23?: string; D24?: string; D25?: string; D26?: string; D27?: string };
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheets = opts.sheets || ALL_SHEETS;

  for (const name of sheets) {
    const ws = wb.addWorksheet(name);

    // Add approval cells per workbook contract
    const statuses = opts.sectionStatuses?.[name];
    if (statuses) {
      // Use label approach — place labels in cells
      if (name === "QA List") {
        ws.getCell("H4").value = "Approved By";
        ws.getCell("I4").value = statuses.by;
        ws.getCell("H5").value = "Approval Date";
        ws.getCell("I5").value = statuses.date;
        ws.getCell("H6").value = "Status";
        ws.getCell("I6").value = statuses.status;
      } else if (name === "Techsitter Report") {
        ws.getCell("D4").value = "Approved By";
        ws.getCell("E4").value = statuses.by;
        ws.getCell("D5").value = "Approval Date";
        ws.getCell("E5").value = statuses.date;
        ws.getCell("D6").value = "Status";
        ws.getCell("E6").value = statuses.status;
      } else if (name === "Communication Report") {
        ws.getCell("G5").value = "Approved By";
        ws.getCell("H5").value = statuses.by;
        ws.getCell("G6").value = "Approval Date";
        ws.getCell("H6").value = statuses.date;
        ws.getCell("G7").value = "Status";
        ws.getCell("H7").value = statuses.status;
      } else if (name === "Inspection Report") {
        ws.getCell("K5").value = "Approved By";
        ws.getCell("L5").value = statuses.by;
        ws.getCell("K6").value = "Approval Date";
        ws.getCell("L6").value = statuses.date;
        ws.getCell("K7").value = "Status";
        ws.getCell("L7").value = statuses.status;
      } else if (name === "Testing Report") {
        ws.getCell("I5").value = "Approved By";
        ws.getCell("J5").value = statuses.by;
        ws.getCell("I6").value = "Approval Date";
        ws.getCell("J6").value = statuses.date;
        ws.getCell("I7").value = "Status";
        ws.getCell("J7").value = statuses.status;
      } else if (name === "O&M Handover") {
        ws.getCell("F5").value = "Approved By";
        ws.getCell("G5").value = statuses.by;
        ws.getCell("F6").value = "Approval Date";
        ws.getCell("G6").value = statuses.date;
        ws.getCell("F7").value = "Status";
        ws.getCell("G7").value = statuses.status;
      }
    }

    // O&M Handover checklist
    if (name === "O&M Handover" && opts.omChecklist) {
      for (const item of opts.omChecklist) {
        ws.getRow(item.row).getCell(3).value = item.doc;
        ws.getRow(item.row).getCell(4).value = item.status;
        ws.getRow(item.row).getCell(5).value = item.comments;
      }
    }

    // Project Information
    if (name === "Project Information" && opts.projectInfo) {
      if (opts.projectInfo.D6) ws.getCell("D6").value = opts.projectInfo.D6;
      if (opts.projectInfo.D9) ws.getCell("D9").value = opts.projectInfo.D9;
      if (opts.projectInfo.D17) ws.getCell("D17").value = opts.projectInfo.D17;
    }

    // Final Completion Certificate
    if (name === "Final Completion Certificate" && opts.finalCompletion) {
      if (opts.finalCompletion.D23) ws.getCell("D23").value = opts.finalCompletion.D23;
      if (opts.finalCompletion.D24) ws.getCell("D24").value = opts.finalCompletion.D24;
      if (opts.finalCompletion.D25) ws.getCell("D25").value = opts.finalCompletion.D25;
      if (opts.finalCompletion.D26) ws.getCell("D26").value = opts.finalCompletion.D26;
      if (opts.finalCompletion.D27) ws.getCell("D27").value = opts.finalCompletion.D27;
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ===================== STATUS NORMALIZER TESTS =====================

describe("mapRawToDisplayStatus", () => {
  it("maps approved/complete/done to complete", () => {
    expect(mapRawToDisplayStatus("Approved")).toBe("complete");
    expect(mapRawToDisplayStatus("Complete")).toBe("complete");
    expect(mapRawToDisplayStatus("Done")).toBe("complete");
    expect(mapRawToDisplayStatus("Passed")).toBe("complete");
    expect(mapRawToDisplayStatus("Yes")).toBe("complete");
    expect(mapRawToDisplayStatus("Signed")).toBe("complete");
  });

  it("maps N/A to not_applicable, NOT not_started", () => {
    expect(mapRawToDisplayStatus("N/A")).toBe("not_applicable");
    expect(mapRawToDisplayStatus("n/a")).toBe("not_applicable");
    expect(mapRawToDisplayStatus("NA")).toBe("not_applicable");
  });

  it("maps awaiting values to awaiting_external", () => {
    expect(mapRawToDisplayStatus("Awaiting feeder")).toBe("awaiting_external");
    expect(mapRawToDisplayStatus("Awaiting client")).toBe("awaiting_external");
    expect(mapRawToDisplayStatus("Awaiting municipality")).toBe("awaiting_external");
    expect(mapRawToDisplayStatus("Awaiting Eskom")).toBe("awaiting_external");
  });

  it("maps empty/null to not_started", () => {
    expect(mapRawToDisplayStatus("")).toBe("not_started");
    expect(mapRawToDisplayStatus(undefined)).toBe("not_started");
  });

  it("maps blocked/failed/rejected to blocked", () => {
    expect(mapRawToDisplayStatus("Blocked")).toBe("blocked");
    expect(mapRawToDisplayStatus("Failed")).toBe("blocked");
    expect(mapRawToDisplayStatus("Rejected")).toBe("blocked");
  });

  it("maps in_progress variants", () => {
    expect(mapRawToDisplayStatus("In Progress")).toBe("in_progress");
    expect(mapRawToDisplayStatus("Pending")).toBe("in_progress");
    expect(mapRawToDisplayStatus("Submitted")).toBe("in_progress");
  });
});

describe("isCompleteForGate", () => {
  it("returns true for complete and not_applicable", () => {
    expect(isCompleteForGate("complete")).toBe(true);
    expect(isCompleteForGate("not_applicable")).toBe(true);
  });

  it("returns false for everything else", () => {
    expect(isCompleteForGate("in_progress")).toBe(false);
    expect(isCompleteForGate("awaiting_external")).toBe(false);
    expect(isCompleteForGate("not_started")).toBe(false);
    expect(isCompleteForGate("blocked")).toBe(false);
    expect(isCompleteForGate("unknown")).toBe(false);
  });
});

// ===================== WORKBOOK VALIDATION TESTS =====================

describe("parseCommissioningWorkbook — validation", () => {
  it("HARD FAILS when workbook has no matching sheets", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1");
    wb.addWorksheet("Data");
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseCommissioningWorkbook(buffer);
    expect(result.parseStatus).toBe("failed");
    expect(result.sections).toEqual([]);
    expect(result.warnings[0]).toContain("does not match commissioning contract");
    expect(result.warnings[0]).toContain("Required sheets found: 0/6");
  });

  it("HARD FAILS when only 5 of 6 required sheets present and total < 8", async () => {
    const buffer = await createWorkbook({
      sheets: ["QA List", "Techsitter Report", "Communication Report", "Inspection Report", "Testing Report"],
    });
    const result = await parseCommissioningWorkbook(buffer);
    expect(result.parseStatus).toBe("failed");
  });

  it("PASSES when all 6 required sheets present", async () => {
    const buffer = await createWorkbook({ sheets: REQUIRED_SHEETS });
    const result = await parseCommissioningWorkbook(buffer);
    expect(result.parseStatus).not.toBe("failed");
  });

  it("PASSES when 8 of 9 total sheets present (missing 1 required)", async () => {
    // Missing Techsitter Report but has 8 others
    const sheets = ALL_SHEETS.filter(s => s !== "Techsitter Report");
    expect(sheets.length).toBe(8);
    const buffer = await createWorkbook({ sheets });
    const result = await parseCommissioningWorkbook(buffer);
    expect(result.parseStatus).not.toBe("failed");
  });

  it("returns failed for invalid buffer", async () => {
    const result = await parseCommissioningWorkbook(Buffer.from("not xlsx"));
    expect(result.parseStatus).toBe("failed");
  });
});

// ===================== SECTION PARSING TESTS =====================

describe("parseCommissioningWorkbook — section parsing", () => {
  it("parses all 9 sections from well-formed workbook", async () => {
    const allStatuses: Record<string, { status: string; by: string; date: string }> = {};
    for (const s of REQUIRED_SHEETS) {
      allStatuses[s] = { status: "Approved", by: "John", date: "2026-03-01" };
    }
    const buffer = await createWorkbook({ sectionStatuses: allStatuses });
    const result = await parseCommissioningWorkbook(buffer);

    expect(result.parseStatus).not.toBe("failed");
    expect(result.sections.length).toBe(9);

    const qaList = result.sections.find(s => s.sectionKey === "qa_list");
    expect(qaList?.displayStatus).toBe("complete");
    expect(qaList?.isCompleteForGate).toBe(true);
    expect(qaList?.approvedBy).toBe("John");
  });

  it("marks missing sheet section as unknown", async () => {
    const sheets = ALL_SHEETS.filter(s => s !== "Techsitter Report");
    const buffer = await createWorkbook({ sheets });
    const result = await parseCommissioningWorkbook(buffer);

    const ts = result.sections.find(s => s.sectionKey === "techsitter_report");
    expect(ts?.displayStatus).toBe("unknown");
    expect(ts?.isCompleteForGate).toBe(false);
    expect(result.warnings.some(w => w.includes("Techsitter Report"))).toBe(true);
  });

  it("maps empty status cells to not_started", async () => {
    const buffer = await createWorkbook({});
    const result = await parseCommissioningWorkbook(buffer);

    const qaList = result.sections.find(s => s.sectionKey === "qa_list");
    // No status set → not_started
    expect(["not_started", "unknown"]).toContain(qaList?.displayStatus);
  });

  it("informational sections are not_applicable and not blockers", async () => {
    const buffer = await createWorkbook({});
    const result = await parseCommissioningWorkbook(buffer);

    const cover = result.sections.find(s => s.sectionKey === "cover_page");
    expect(cover?.isRequired).toBe(false);
    expect(cover?.isCompleteForGate).toBe(true);
  });
});

// ===================== LABEL LOOKUP + DRIFT TESTS =====================

describe("parseCommissioningWorkbook — label lookup and drift", () => {
  it("finds status via label lookup even at non-standard cell", async () => {
    const wb = new ExcelJS.Workbook();
    for (const name of ALL_SHEETS) wb.addWorksheet(name);

    // Place Techsitter status at G8 with label at G7 (drift from E6)
    const ts = wb.getWorksheet("Techsitter Report")!;
    ts.getCell("G7").value = "Status";
    ts.getCell("H7").value = "Approved";
    ts.getCell("G4").value = "Approved By";
    ts.getCell("H4").value = "Engineer A";

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseCommissioningWorkbook(buffer);

    const section = result.sections.find(s => s.sectionKey === "techsitter_report");
    expect(section?.displayStatus).toBe("complete");
    expect(section?.approvedBy).toBe("Engineer A");
  });
});

// ===================== O&M HANDOVER CHECKLIST + SSEG =====================

describe("parseCommissioningWorkbook — O&M Handover checklist", () => {
  it("parses checklist rows 6-27 and extracts SSEG", async () => {
    const buffer = await createWorkbook({
      omChecklist: [
        { row: 6, doc: "As-Built Drawings", status: "Yes", comments: "" },
        { row: 10, doc: "Warranty Certificates", status: "No", comments: "Pending" },
        { row: 18, doc: "SSEG Application", status: "Approved", comments: "" },
        { row: 19, doc: "SSEG Approval", status: "Awaiting Municipality", comments: "Submitted" },
      ],
    });

    const result = await parseCommissioningWorkbook(buffer);
    expect(result.omHandoverChecklist.length).toBe(4);
    expect(result.omHandoverChecklist[0].documentName).toBe("As-Built Drawings");
    expect(result.ssegStatus.application).toBe("Approved");
    expect(result.ssegStatus.approval).toBe("Awaiting Municipality");
  });
});

// ===================== PROJECT INFORMATION =====================

describe("parseCommissioningWorkbook — Project Information", () => {
  it("extracts metadata from fixed cells", async () => {
    const buffer = await createWorkbook({
      projectInfo: { D6: "Test Project", D9: "123 Solar St", D17: "2026-06-15" },
    });
    const result = await parseCommissioningWorkbook(buffer);

    expect(result.projectInfo.workbookProjectName).toBe("Test Project");
    expect(result.projectInfo.siteAddress).toBe("123 Solar St");
    expect(result.projectInfo.commissioningDate).toBe("2026-06-15");
  });
});

// ===================== FINAL COMPLETION CROSS-CHECK =====================

describe("parseCommissioningWorkbook — Final Completion", () => {
  it("reads D23-D27 cross-check values", async () => {
    const buffer = await createWorkbook({
      finalCompletion: {
        D23: "Complete", D24: "Complete", D25: "Pending",
        D26: "Complete", D27: "Approved",
      },
    });
    const result = await parseCommissioningWorkbook(buffer);

    expect(result.finalCompletionCrossCheck.omHandover).toBe("Complete");
    expect(result.finalCompletionCrossCheck.techsitter).toBe("Pending");
    expect(result.finalCompletionCrossCheck.testing).toBe("Approved");
  });
});

// ===================== BLOCKER CALCULATION =====================

describe("calculateBlockers", () => {
  it("returns blockers for incomplete required sections", () => {
    const sections: CommissioningSection[] = [
      { sectionKey: "qa_list", sectionName: "QA List", displayStatus: "complete", isCompleteForGate: true, isRequired: true },
      { sectionKey: "techsitter_report", sectionName: "Techsitter Report", displayStatus: "in_progress", isCompleteForGate: false, isRequired: true, rawStatus: "In Progress" },
      { sectionKey: "communication_report", sectionName: "Communication Report", displayStatus: "not_applicable", isCompleteForGate: true, isRequired: true },
      { sectionKey: "cover_page", sectionName: "Cover Page", displayStatus: "not_applicable", isCompleteForGate: true, isRequired: false },
    ];
    const blockers = calculateBlockers(sections);
    expect(blockers.length).toBe(1);
    expect(blockers[0]).toContain("Techsitter Report");
  });

  it("returns empty when all required sections are gate-complete", () => {
    const sections: CommissioningSection[] = REQUIRED_SHEETS.map(name => ({
      sectionKey: name.toLowerCase().replace(/\s/g, "_"),
      sectionName: name,
      displayStatus: "complete" as CommissioningDisplayStatus,
      isCompleteForGate: true,
      isRequired: true,
    }));
    expect(calculateBlockers(sections)).toEqual([]);
  });

  it("treats N/A as gate-complete (not a blocker)", () => {
    const sections: CommissioningSection[] = [
      { sectionKey: "qa_list", sectionName: "QA List", displayStatus: "not_applicable", isCompleteForGate: true, isRequired: true },
    ];
    expect(calculateBlockers(sections)).toEqual([]);
  });
});

// ===================== OVERALL STATUS + COMPLETION =====================

describe("calculateOverallStatus", () => {
  it("returns complete when all required are gate-complete", () => {
    const sections: CommissioningSection[] = REQUIRED_SHEETS.map(name => ({
      sectionKey: name, sectionName: name, displayStatus: "complete" as CommissioningDisplayStatus,
      isCompleteForGate: true, isRequired: true,
    }));
    expect(calculateOverallStatus(sections)).toBe("complete");
  });

  it("returns blocked if any required is blocked", () => {
    const sections: CommissioningSection[] = [
      { sectionKey: "a", sectionName: "A", displayStatus: "blocked", isCompleteForGate: false, isRequired: true },
      { sectionKey: "b", sectionName: "B", displayStatus: "complete", isCompleteForGate: true, isRequired: true },
    ];
    expect(calculateOverallStatus(sections)).toBe("blocked");
  });

  it("returns in_progress if any required is awaiting_external", () => {
    const sections: CommissioningSection[] = [
      { sectionKey: "a", sectionName: "A", displayStatus: "awaiting_external", isCompleteForGate: false, isRequired: true },
      { sectionKey: "b", sectionName: "B", displayStatus: "complete", isCompleteForGate: true, isRequired: true },
    ];
    expect(calculateOverallStatus(sections)).toBe("in_progress");
  });
});

describe("calculateCompletionPercent", () => {
  it("calculates from required sections only", () => {
    const sections: CommissioningSection[] = [
      { sectionKey: "a", sectionName: "A", displayStatus: "complete", isCompleteForGate: true, isRequired: true },
      { sectionKey: "b", sectionName: "B", displayStatus: "complete", isCompleteForGate: true, isRequired: true },
      { sectionKey: "c", sectionName: "C", displayStatus: "not_started", isCompleteForGate: false, isRequired: true },
      { sectionKey: "d", sectionName: "D", displayStatus: "not_applicable", isCompleteForGate: true, isRequired: false },
    ];
    // 2 of 3 required = 67%
    expect(calculateCompletionPercent(sections)).toBe(67);
  });

  it("returns 100 when all required are complete or N/A", () => {
    const sections: CommissioningSection[] = [
      { sectionKey: "a", sectionName: "A", displayStatus: "complete", isCompleteForGate: true, isRequired: true },
      { sectionKey: "b", sectionName: "B", displayStatus: "not_applicable", isCompleteForGate: true, isRequired: true },
    ];
    expect(calculateCompletionPercent(sections)).toBe(100);
  });
});

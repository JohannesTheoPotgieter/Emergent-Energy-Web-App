import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseCommissioningWorkbook,
  extractSsegStatus,
  calculateBlockers,
  calculateCompletionPercent,
} from "../../../server/services/commissioning-workbook-parser";
import type { CommissioningSection } from "@shared/schema";

/** Helper: create a workbook buffer with a Compliance sheet matching the tracker format */
async function createComplianceWorkbook(sections: {
  name: string;
  headerRow: number;
  items: { description: string; status: string; approvedBy: string; date: string; comments: string }[];
}[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compliance");

  let currentRow = 1;
  for (const section of sections) {
    // Section header row (merged)
    const headerRow = ws.getRow(currentRow);
    headerRow.getCell(2).value = section.name;
    headerRow.getCell(3).value = section.name;
    currentRow += 2;

    // Data header row
    const dataHeader = ws.getRow(currentRow);
    dataHeader.getCell(2).value = " Description";
    dataHeader.getCell(3).value = "Status";
    dataHeader.getCell(4).value = "Approved By";
    dataHeader.getCell(5).value = "Date";
    dataHeader.getCell(6).value = "Results / Comments ";
    currentRow++;

    // Data rows
    for (const item of section.items) {
      const row = ws.getRow(currentRow);
      row.getCell(2).value = item.description;
      row.getCell(3).value = item.status;
      row.getCell(4).value = item.approvedBy;
      row.getCell(5).value = item.date;
      row.getCell(6).value = item.comments;
      currentRow++;
    }

    currentRow += 3; // gap between sections
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Helper: create a workbook buffer with no recognizable commissioning data */
async function createEmptyWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Sheet1");
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("commissioning-workbook-parser", () => {
  describe("parseCommissioningWorkbook", () => {
    it("parses HSE and SSEG sections from Compliance sheet", async () => {
      const buffer = await createComplianceWorkbook([
        {
          name: "HSE",
          headerRow: 3,
          items: [
            { description: "NOC", status: "Approved", approvedBy: "DOL", date: "2026-01-15", comments: "" },
            { description: "7.1 Agreement", status: "Approved", approvedBy: "EE", date: "2026-01-20", comments: "" },
            { description: "13.2 Agreement", status: "In Process", approvedBy: "", date: "", comments: "Awaiting docs" },
          ],
        },
        {
          name: "SSEG",
          headerRow: 12,
          items: [
            { description: "SSEG Application", status: "In Process", approvedBy: "", date: "", comments: "Submitted" },
            { description: "PTI", status: "", approvedBy: "", date: "", comments: "" },
            { description: "Commissioning Approval", status: "", approvedBy: "", date: "", comments: "" },
          ],
        },
      ]);

      const result = await parseCommissioningWorkbook(buffer);

      expect(result.parseStatus).toBe("success");
      expect(result.sections.length).toBe(2);
      expect(result.sections[0].sectionKey).toBe("hse");
      expect(result.sections[0].sectionName).toBe("HSE");
      expect(result.sections[0].items.length).toBe(3);
      expect(result.sections[1].sectionKey).toBe("sseg");
      expect(result.sections[1].sectionName).toBe("SSEG");
      expect(result.sections[1].items.length).toBe(3);
    });

    it("returns failed status for workbook with no commissioning data", async () => {
      const buffer = await createEmptyWorkbook();
      const result = await parseCommissioningWorkbook(buffer);

      expect(result.parseStatus).toBe("failed");
      expect(result.sections.length).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("returns failed status for invalid buffer", async () => {
      const buffer = Buffer.from("not a valid xlsx");
      const result = await parseCommissioningWorkbook(buffer);

      expect(result.parseStatus).toBe("failed");
      expect(result.sections.length).toBe(0);
    });

    it("handles all items approved as complete section status", async () => {
      const buffer = await createComplianceWorkbook([
        {
          name: "HSE",
          headerRow: 3,
          items: [
            { description: "NOC", status: "Approved", approvedBy: "DOL", date: "2026-01-15", comments: "" },
            { description: "7.1 Agreement", status: "Approved", approvedBy: "EE", date: "2026-01-20", comments: "" },
          ],
        },
      ]);

      const result = await parseCommissioningWorkbook(buffer);
      expect(result.sections[0].displayStatus).toBe("complete");
    });

    it("handles mixed statuses as in_progress", async () => {
      const buffer = await createComplianceWorkbook([
        {
          name: "HSE",
          headerRow: 3,
          items: [
            { description: "NOC", status: "Approved", approvedBy: "DOL", date: "", comments: "" },
            { description: "7.1 Agreement", status: "In Process", approvedBy: "", date: "", comments: "" },
          ],
        },
      ]);

      const result = await parseCommissioningWorkbook(buffer);
      expect(result.sections[0].displayStatus).toBe("in_progress");
    });

    it("handles template drift with different header positions", async () => {
      // Create workbook where header appears at different row
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Compliance");

      // HSE section starting at row 5 instead of typical row 2
      ws.getRow(5).getCell(2).value = "HSE";
      ws.getRow(5).getCell(3).value = "HSE";
      ws.getRow(7).getCell(2).value = " Description";
      ws.getRow(7).getCell(3).value = "Status";
      ws.getRow(7).getCell(4).value = "Approved By";
      ws.getRow(7).getCell(5).value = "Date";
      ws.getRow(7).getCell(6).value = "Results / Comments";
      ws.getRow(8).getCell(2).value = "Test Item";
      ws.getRow(8).getCell(3).value = "Done";

      const arrayBuffer = await wb.xlsx.writeBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await parseCommissioningWorkbook(buffer);
      expect(result.sections.length).toBeGreaterThanOrEqual(1);
      expect(result.sections[0].sectionKey).toBe("hse");
    });
  });

  describe("extractSsegStatus", () => {
    it("extracts SSEG fields from parsed sections", () => {
      const sections: CommissioningSection[] = [
        {
          sectionKey: "sseg",
          sectionName: "SSEG",
          items: [
            { description: "SSEG Application", status: "In Process" },
            { description: "PTI", status: "Approved" },
            { description: "Commissioning Approval", status: "" },
            { description: "NERSA Registration", status: "Pending" },
          ],
        },
      ];

      const result = extractSsegStatus(sections);
      expect(result.application).toBe("In Process");
      expect(result.pti).toBe("Approved");
      expect(result.commissioningApproval).toBe("Not Started");
      expect(result.nersaRegistration).toBe("Pending");
    });

    it("returns empty object when no SSEG section", () => {
      const result = extractSsegStatus([]);
      expect(result).toEqual({});
    });
  });

  describe("calculateBlockers", () => {
    it("identifies incomplete sections as blockers", () => {
      const sections: CommissioningSection[] = [
        { sectionKey: "hse", sectionName: "HSE", items: [{ description: "A", status: "Approved" }], displayStatus: "complete" },
        { sectionKey: "sseg", sectionName: "SSEG", items: [{ description: "B", status: "" }], displayStatus: "not_started" },
      ];

      const blockers = calculateBlockers(sections);
      expect(blockers.length).toBe(1);
      expect(blockers[0]).toContain("SSEG");
    });

    it("returns empty when all complete", () => {
      const sections: CommissioningSection[] = [
        { sectionKey: "hse", sectionName: "HSE", items: [{ description: "A", status: "Approved" }], displayStatus: "complete" },
      ];

      const blockers = calculateBlockers(sections);
      expect(blockers.length).toBe(0);
    });
  });

  describe("calculateCompletionPercent", () => {
    it("calculates correct percentage", () => {
      const sections: CommissioningSection[] = [
        {
          sectionKey: "hse",
          sectionName: "HSE",
          items: [
            { description: "A", status: "Approved" },
            { description: "B", status: "In Process" },
            { description: "C", status: "Approved" },
            { description: "D", status: "" },
          ],
        },
      ];

      const pct = calculateCompletionPercent(sections);
      expect(pct).toBe(50); // 2 out of 4
    });

    it("returns 0 for empty sections", () => {
      expect(calculateCompletionPercent([])).toBe(0);
    });

    it("returns 100 when all items complete", () => {
      const sections: CommissioningSection[] = [
        {
          sectionKey: "hse",
          sectionName: "HSE",
          items: [
            { description: "A", status: "Approved" },
            { description: "B", status: "Complete" },
          ],
        },
      ];

      expect(calculateCompletionPercent(sections)).toBe(100);
    });
  });
});

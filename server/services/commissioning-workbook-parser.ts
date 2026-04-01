/**
 * Commissioning Workbook Parser Service
 *
 * Reads the Compliance sheet (or future dedicated commissioning workbook)
 * from an .xlsx/.xlsm buffer and extracts summary section data for the
 * commissioning control tower dashboard.
 *
 * Rules:
 * - No macro execution
 * - Label-based lookup with fallback cell mapping
 * - Handles template drift by scanning for section headers
 * - Emits warnings for missing/drifted fields instead of crashing
 */
import ExcelJS from "exceljs";
import type { CommissioningSection, CommissioningSectionItem } from "@shared/schema/commissioning-source";

export interface CommissioningParseResult {
  sections: CommissioningSection[];
  warnings: string[];
  parseStatus: "success" | "partial" | "failed";
  parseMessage: string;
}

/** Extract cell value as plain string */
function cellToString(cell: ExcelJS.Cell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) {
    return v.toISOString().split("T")[0];
  }
  if (typeof v === "object") {
    // Handle formula results
    if ("result" in v && v.result !== undefined) {
      return typeof v.result === "string" ? v.result.trim() : String(v.result);
    }
    // Handle rich text
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((rt: any) => rt.text || "").join("").trim();
    }
  }
  return String(v).trim();
}

/** Normalize label for matching — lowercase, strip whitespace */
function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Known section header labels we scan for */
const SECTION_MARKERS: { label: string; key: string; displayName: string }[] = [
  { label: "hse", key: "hse", displayName: "HSE" },
  { label: "sseg", key: "sseg", displayName: "SSEG" },
  { label: "qalist", key: "qa_list", displayName: "QA List" },
  { label: "coverpage", key: "cover_page", displayName: "Cover Page" },
  { label: "projectinformation", key: "project_information", displayName: "Project Information" },
  { label: "techsitterreport", key: "techsitter_report", displayName: "Techsitter Report" },
  { label: "communicationreport", key: "communication_report", displayName: "Communication Report" },
  { label: "inspectionreport", key: "inspection_report", displayName: "Inspection Report" },
  { label: "testingreport", key: "testing_report", displayName: "Testing Report" },
  { label: "omhandover", key: "om_handover", displayName: "O&M Handover" },
  { label: "oandmhandover", key: "om_handover", displayName: "O&M Handover" },
  { label: "finalcompletioncertificate", key: "final_completion", displayName: "Final Completion Certificate" },
  { label: "finalcompletion", key: "final_completion", displayName: "Final Completion Certificate" },
];

/** Detect column mapping from a header row */
interface ColumnMap {
  descriptionCol: number;
  statusCol: number;
  approvedByCol: number;
  dateCol: number;
  commentsCol: number;
}

function detectHeaderColumns(ws: ExcelJS.Worksheet, rowNum: number): ColumnMap | null {
  const row = ws.getRow(rowNum);
  const map: ColumnMap = { descriptionCol: -1, statusCol: -1, approvedByCol: -1, dateCol: -1, commentsCol: -1 };

  for (let c = 1; c <= 20; c++) {
    const val = normalizeLabel(cellToString(row.getCell(c)));
    if (val.includes("description")) map.descriptionCol = c;
    else if (val === "status") map.statusCol = c;
    else if (val.includes("approvedby") || val.includes("approved")) map.approvedByCol = c;
    else if (val === "date") map.dateCol = c;
    else if (val.includes("result") || val.includes("comment")) map.commentsCol = c;
  }

  if (map.descriptionCol > 0 && map.statusCol > 0) return map;
  return null;
}

/** Determine display status from raw status string */
function mapDisplayStatus(raw: string): CommissioningSection["displayStatus"] {
  const n = normalizeLabel(raw);
  if (!n || n === "notstarted" || n === "na" || n === "notapplicable") return "not_started";
  if (n === "approved" || n === "complete" || n === "completed" || n === "done" || n === "passed") return "complete";
  if (n === "inprogress" || n === "inprocess" || n === "pending" || n === "submitted" || n === "awaiting") return "in_progress";
  if (n === "blocked" || n === "failed" || n === "rejected") return "blocked";
  if (raw.trim()) return "in_progress"; // any non-empty value = some progress
  return "not_started";
}

/** Parse a single section from a block of rows */
function parseSection(
  ws: ExcelJS.Worksheet,
  sectionKey: string,
  sectionName: string,
  headerRow: number,
  colMap: ColumnMap,
  endRow: number,
): CommissioningSection {
  const items: CommissioningSectionItem[] = [];
  let overallRaw = "";
  let approvedBy = "";
  let approvalDate = "";
  let commentSummary = "";

  for (let r = headerRow + 1; r <= endRow; r++) {
    const row = ws.getRow(r);
    const desc = cellToString(row.getCell(colMap.descriptionCol));
    if (!desc) continue;

    const status = cellToString(row.getCell(colMap.statusCol));
    const approved = colMap.approvedByCol > 0 ? cellToString(row.getCell(colMap.approvedByCol)) : "";
    const date = colMap.dateCol > 0 ? cellToString(row.getCell(colMap.dateCol)) : "";
    const comments = colMap.commentsCol > 0 ? cellToString(row.getCell(colMap.commentsCol)) : "";

    items.push({ description: desc, status, approvedBy: approved, date, comments });

    if (status && !overallRaw) overallRaw = status;
    if (approved && !approvedBy) approvedBy = approved;
    if (date && !approvalDate) approvalDate = date;
    if (comments) commentSummary = commentSummary ? `${commentSummary}; ${comments}` : comments;
  }

  // Compute overall status from items
  const statuses = items.map((i) => mapDisplayStatus(i.status || ""));
  let displayStatus: CommissioningSection["displayStatus"] = "not_started";
  if (statuses.some((s) => s === "blocked")) displayStatus = "blocked";
  else if (statuses.every((s) => s === "complete")) displayStatus = items.length > 0 ? "complete" : "not_started";
  else if (statuses.some((s) => s === "in_progress" || s === "complete")) displayStatus = "in_progress";

  return {
    sectionKey,
    sectionName,
    items,
    rawStatus: overallRaw,
    displayStatus,
    approvedBy: approvedBy || undefined,
    approvalDate: approvalDate || undefined,
    commentSummary: commentSummary.substring(0, 500) || undefined,
  };
}

/** Try to parse the Compliance sheet (current tracker format) */
function parseComplianceSheet(ws: ExcelJS.Worksheet, warnings: string[]): CommissioningSection[] {
  const sections: CommissioningSection[] = [];
  const sectionStarts: { key: string; name: string; headerRow: number; colMap: ColumnMap }[] = [];

  // Scan for section headers and their data header rows
  const seenSectionRows = new Set<number>();
  for (let r = 1; r <= Math.min(ws.rowCount, 200); r++) {
    if (seenSectionRows.has(r)) continue;
    const row = ws.getRow(r);

    // Check for section marker (merged header rows like "HSE" or "SSEG")
    let foundMarkerOnRow = false;
    for (let c = 1; c <= 10 && !foundMarkerOnRow; c++) {
      const val = cellToString(row.getCell(c));
      if (!val) continue;
      const norm = normalizeLabel(val);

      for (const marker of SECTION_MARKERS) {
        if (norm === marker.label) {
          // Dedupe: skip if we already found this section key
          if (sectionStarts.some((s) => s.key === marker.key)) break;

          // Look for the data header row (Description, Status, ...) below this marker
          for (let hr = r + 1; hr <= Math.min(r + 5, ws.rowCount); hr++) {
            const colMap = detectHeaderColumns(ws, hr);
            if (colMap) {
              sectionStarts.push({ key: marker.key, name: marker.displayName, headerRow: hr, colMap });
              seenSectionRows.add(r);
              foundMarkerOnRow = true;
              break;
            }
          }
          break;
        }
      }
    }
  }

  if (sectionStarts.length === 0) {
    warnings.push("No recognized section headers found in Compliance sheet");
    return sections;
  }

  // Parse each section (end row = next section start or end of data)
  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i];
    const endRow = i + 1 < sectionStarts.length
      ? sectionStarts[i + 1].headerRow - 3 // leave gap for next section header
      : Math.min(start.headerRow + 50, ws.rowCount);

    sections.push(parseSection(ws, start.key, start.name, start.headerRow, start.colMap, endRow));
  }

  return sections;
}

/** Try to parse a dedicated commissioning workbook with named sheets */
function parseDedicatedWorkbook(wb: ExcelJS.Workbook, warnings: string[]): CommissioningSection[] {
  const sections: CommissioningSection[] = [];
  const sheetNames = wb.worksheets.map((ws) => ws.name);

  for (const marker of SECTION_MARKERS) {
    // Find sheet by normalized name match
    const matchingSheet = wb.worksheets.find((ws) => {
      const norm = normalizeLabel(ws.name);
      return norm === marker.label || norm.includes(marker.label);
    });

    if (!matchingSheet) continue;

    // Try to find header row in the sheet
    let colMap: ColumnMap | null = null;
    let headerRow = -1;
    for (let r = 1; r <= Math.min(matchingSheet.rowCount, 20); r++) {
      colMap = detectHeaderColumns(matchingSheet, r);
      if (colMap) {
        headerRow = r;
        break;
      }
    }

    if (colMap && headerRow > 0) {
      sections.push(
        parseSection(matchingSheet, marker.key, marker.displayName, headerRow, colMap, Math.min(headerRow + 100, matchingSheet.rowCount))
      );
    } else {
      warnings.push(`Sheet "${matchingSheet.name}" found but no data header row detected`);
    }
  }

  return sections;
}

/**
 * Main parser entry point.
 * Accepts a buffer (from SharePoint download or manual upload).
 * Tries dedicated workbook format first, then falls back to Compliance sheet in tracker.
 */
export async function parseCommissioningWorkbook(buffer: Buffer): Promise<CommissioningParseResult> {
  const warnings: string[] = [];

  let wb: ExcelJS.Workbook;
  try {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
  } catch (err) {
    return {
      sections: [],
      warnings: [`Failed to load workbook: ${err instanceof Error ? err.message : String(err)}`],
      parseStatus: "failed",
      parseMessage: "Could not open workbook file",
    };
  }

  const sheetNames = wb.worksheets.map((ws) => ws.name);

  // Strategy 1: Try dedicated commissioning workbook (sheets named after sections)
  const dedicatedSections = parseDedicatedWorkbook(wb, warnings);
  if (dedicatedSections.length >= 3) {
    return {
      sections: dedicatedSections,
      warnings,
      parseStatus: warnings.length > 0 ? "partial" : "success",
      parseMessage: `Parsed ${dedicatedSections.length} sections from dedicated workbook (${sheetNames.length} sheets)`,
    };
  }

  // Strategy 2: Parse Compliance sheet from tracker workbook
  const complianceSheet = wb.worksheets.find((ws) => normalizeLabel(ws.name) === "compliance");
  if (complianceSheet) {
    const sections = parseComplianceSheet(complianceSheet, warnings);
    if (sections.length > 0) {
      return {
        sections,
        warnings,
        parseStatus: warnings.length > 0 ? "partial" : "success",
        parseMessage: `Parsed ${sections.length} sections from Compliance sheet`,
      };
    }
  }

  // Strategy 3: Scan all sheets for any recognizable section data
  for (const ws of wb.worksheets) {
    if (normalizeLabel(ws.name) === "compliance") continue; // already tried
    const sections = parseComplianceSheet(ws, warnings);
    if (sections.length > 0) {
      return {
        sections,
        warnings,
        parseStatus: "partial",
        parseMessage: `Parsed ${sections.length} sections from sheet "${ws.name}" (non-standard location)`,
      };
    }
  }

  return {
    sections: [],
    warnings: [...warnings, `No commissioning data found. Sheets present: ${sheetNames.join(", ")}`],
    parseStatus: "failed",
    parseMessage: "No recognizable commissioning sections found in workbook",
  };
}

/** Extract SSEG status from parsed sections */
export function extractSsegStatus(sections: CommissioningSection[]): Record<string, string> {
  const ssegSection = sections.find((s) => s.sectionKey === "sseg");
  if (!ssegSection) return {};

  const result: Record<string, string> = {};
  for (const item of ssegSection.items) {
    const norm = normalizeLabel(item.description);
    if (norm.includes("ssegapplication")) result.application = item.status || "Not Started";
    else if (norm === "pti") result.pti = item.status || "Not Started";
    else if (norm.includes("commissioningapproval")) result.commissioningApproval = item.status || "Not Started";
    else if (norm.includes("nersaregistration") || norm.includes("nersa")) result.nersaRegistration = item.status || "Not Started";
  }
  return result;
}

/** Calculate completion blockers from sections */
export function calculateBlockers(sections: CommissioningSection[]): string[] {
  const blockers: string[] = [];

  for (const section of sections) {
    if (section.displayStatus === "blocked") {
      blockers.push(`${section.sectionName}: blocked`);
    } else if (section.displayStatus === "not_started") {
      blockers.push(`${section.sectionName}: not started`);
    } else if (section.displayStatus === "in_progress") {
      const incomplete = section.items.filter((i: CommissioningSectionItem) => {
        const ds = mapDisplayStatus(i.status || "");
        return ds !== "complete";
      });
      if (incomplete.length > 0) {
        blockers.push(`${section.sectionName}: ${incomplete.length} item(s) incomplete`);
      }
    }
  }

  return blockers;
}

/** Calculate overall completion percentage */
export function calculateCompletionPercent(sections: CommissioningSection[]): number {
  let total = 0;
  let completed = 0;
  for (const section of sections) {
    for (const item of section.items) {
      total++;
      if (mapDisplayStatus(item.status || "") === "complete") completed++;
    }
  }
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

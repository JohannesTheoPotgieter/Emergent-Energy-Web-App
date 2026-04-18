/**
 * Commissioning Workbook Parser Service
 *
 * Parses commissioning workbooks aligned to the workbook contract:
 *   QA List, Cover Page, Project Information, Techsitter Report,
 *   Communication Report, Inspection Report, Testing Report,
 *   O&M Handover, Final Completion Certificate
 *
 * Rules:
 * - No macro execution
 * - Label-based lookup first, fixed-cell fallback second
 * - Hard fail if workbook does not match contract (unless tracker_compliance format)
 * - Separate displayStatus (UI) from isCompleteForGate (blocker logic)
 * - N/A maps to not_applicable, NOT to not_started
 */
import ExcelJS from "exceljs";
import type {
  CommissioningSection,
  CommissioningDisplayStatus,
  OmHandoverChecklistItem,
} from "@shared/schema/commissioning-source";

// ===================== SECTION REGISTRY =====================

interface SectionDef {
  key: string;
  sheetName: string;
  approvalCells: { by: string; date: string; status: string } | null;
  isRequired: boolean;
}

const SECTION_DEFS: SectionDef[] = [
  { key: "qa_list", sheetName: "QA List", approvalCells: { by: "I4", date: "I5", status: "I6" }, isRequired: true },
  { key: "cover_page", sheetName: "Cover Page", approvalCells: null, isRequired: false },
  { key: "project_information", sheetName: "Project Information", approvalCells: null, isRequired: false },
  { key: "techsitter_report", sheetName: "Techsitter Report", approvalCells: { by: "E4", date: "E5", status: "E6" }, isRequired: true },
  { key: "communication_report", sheetName: "Communication Report", approvalCells: { by: "H5", date: "H6", status: "H7" }, isRequired: true },
  { key: "inspection_report", sheetName: "Inspection Report", approvalCells: { by: "L5", date: "L6", status: "L7" }, isRequired: true },
  { key: "testing_report", sheetName: "Testing Report", approvalCells: { by: "J5", date: "J6", status: "J7" }, isRequired: true },
  { key: "om_handover", sheetName: "O&M Handover", approvalCells: { by: "G5", date: "G6", status: "G7" }, isRequired: true },
  { key: "final_completion_certificate", sheetName: "Final Completion Certificate", approvalCells: null, isRequired: false },
];

const REQUIRED_SHEET_KEYS = SECTION_DEFS.filter((s) => s.isRequired).map((s) => s.key);

// ===================== PARSE RESULT =====================

export interface CommissioningParseResult {
  sections: CommissioningSection[];
  projectInfo: {
    workbookProjectName?: string;
    siteAddress?: string;
    commissioningDate?: string;
  };
  omHandoverChecklist: OmHandoverChecklistItem[];
  ssegStatus: { application?: string; approval?: string };
  finalCompletionCrossCheck: Record<string, string>;
  warnings: string[];
  parseStatus: "success" | "partial" | "failed";
  parseMessage: string;
}

// ===================== CELL HELPERS =====================

function cellToString(cell: ExcelJS.Cell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().split("T")[0];
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) {
      if (v.result instanceof Date) return v.result.toISOString().split("T")[0];
      return typeof v.result === "string" ? v.result.trim() : String(v.result);
    }
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((rt: any) => rt.text || "").join("").trim();
    }
  }
  return String(v).trim();
}

function readCellByRef(ws: ExcelJS.Worksheet, ref: string): string {
  try {
    const cell = ws.getCell(ref);
    return cellToString(cell);
  } catch {
    return "";
  }
}

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ===================== SHEET MATCHING =====================

function findWorksheet(wb: ExcelJS.Workbook, sheetName: string): ExcelJS.Worksheet | null {
  const target = normalizeLabel(sheetName);
  // Exact match first
  for (const ws of wb.worksheets) {
    if (normalizeLabel(ws.name) === target) return ws;
  }
  // Contains match (handles minor drift like extra spaces)
  for (const ws of wb.worksheets) {
    if (normalizeLabel(ws.name).includes(target) || target.includes(normalizeLabel(ws.name))) return ws;
  }
  return null;
}

// ===================== STATUS NORMALIZER =====================

export function mapRawToDisplayStatus(raw: string | undefined): CommissioningDisplayStatus {
  if (!raw || !raw.trim()) return "not_started";
  const n = normalizeLabel(raw);

  if (["na", "notapplicable", "n/a"].includes(n) || n === "notapplicable") return "not_applicable";
  if (["approved", "complete", "completed", "done", "passed", "yes", "signed"].includes(n)) return "complete";
  if (["inprogress", "inprocess", "pending", "submitted", "partial"].includes(n)) return "in_progress";
  if (n.startsWith("awaiting") || n.includes("external") || n.includes("feeder") || n.includes("municipality") || n.includes("eskom") || n.includes("client")) {
    return "awaiting_external";
  }
  if (["blocked", "failed", "rejected"].includes(n)) return "blocked";
  if (["notstarted"].includes(n)) return "not_started";
  // Any other non-empty value — conservative in_progress
  return "unknown";
}

export function isCompleteForGate(displayStatus: CommissioningDisplayStatus): boolean {
  return displayStatus === "complete" || displayStatus === "not_applicable";
}

// ===================== LABEL LOOKUP =====================

interface ApprovalValues {
  approvedBy: string;
  approvalDate: string;
  rawStatus: string;
}

function labelLookup(ws: ExcelJS.Worksheet, maxRow: number = 15): Partial<ApprovalValues> {
  const result: Partial<ApprovalValues> = {};

  for (let r = 1; r <= Math.min(ws.rowCount, maxRow); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.min(20, ws.columnCount || 20); c++) {
      const val = cellToString(row.getCell(c));
      if (!val) continue;
      const norm = normalizeLabel(val);

      if (!result.approvedBy && (norm.includes("approvedby") || norm === "approvedby")) {
        // Read from cell to the right or below
        const right = cellToString(row.getCell(c + 1));
        if (right) { result.approvedBy = right; continue; }
        const below = cellToString(ws.getRow(r + 1).getCell(c));
        if (below) { result.approvedBy = below; }
      }
      if (!result.approvalDate && (norm.includes("approvaldate") || norm.includes("approveddate") || norm === "date")) {
        const right = cellToString(row.getCell(c + 1));
        if (right) { result.approvalDate = right; continue; }
        const below = cellToString(ws.getRow(r + 1).getCell(c));
        if (below) { result.approvalDate = below; }
      }
      if (!result.rawStatus && norm === "status") {
        const right = cellToString(row.getCell(c + 1));
        if (right) { result.rawStatus = right; continue; }
        const below = cellToString(ws.getRow(r + 1).getCell(c));
        if (below) { result.rawStatus = below; }
      }
    }
  }

  return result;
}

// ===================== SECTION PARSER =====================

function parseSection(wb: ExcelJS.Workbook, def: SectionDef, warnings: string[]): CommissioningSection {
  const ws = findWorksheet(wb, def.sheetName);

  if (!ws) {
    warnings.push(`Sheet "${def.sheetName}" not found`);
    return {
      sectionKey: def.key,
      sectionName: def.sheetName,
      displayStatus: "unknown",
      isCompleteForGate: false,
      isRequired: def.isRequired,
    };
  }

  if (!def.approvalCells) {
    // Informational section — just record presence
    return {
      sectionKey: def.key,
      sectionName: def.sheetName,
      displayStatus: "not_applicable",
      isCompleteForGate: true,
      isRequired: false,
    };
  }

  // Tier 1: Label lookup
  const fromLabel = labelLookup(ws);

  // Tier 2: Fixed-cell fallback
  const approvedBy = fromLabel.approvedBy || readCellByRef(ws, def.approvalCells.by);
  const approvalDate = fromLabel.approvalDate || readCellByRef(ws, def.approvalCells.date);
  const rawStatus = fromLabel.rawStatus || readCellByRef(ws, def.approvalCells.status);

  if (!rawStatus) {
    warnings.push(`${def.sheetName}: status not found via label lookup or fallback cell ${def.approvalCells.status}`);
  }

  const displayStatus = mapRawToDisplayStatus(rawStatus);

  return {
    sectionKey: def.key,
    sectionName: def.sheetName,
    rawStatus: rawStatus || undefined,
    displayStatus,
    isCompleteForGate: isCompleteForGate(displayStatus),
    isRequired: def.isRequired,
    approvedBy: approvedBy || undefined,
    approvalDate: approvalDate || undefined,
  };
}

// ===================== O&M HANDOVER CHECKLIST =====================

function parseOmHandoverChecklist(wb: ExcelJS.Workbook, warnings: string[]): {
  checklist: OmHandoverChecklistItem[];
  sseg: { application?: string; approval?: string };
} {
  const ws = findWorksheet(wb, "O&M Handover");
  if (!ws) {
    return { checklist: [], sseg: {} };
  }

  const checklist: OmHandoverChecklistItem[] = [];
  const sseg: { application?: string; approval?: string } = {};

  for (let r = 6; r <= 27; r++) {
    const row = ws.getRow(r);
    const docName = cellToString(row.getCell(3)); // Column C
    const status = cellToString(row.getCell(4));   // Column D
    const comments = cellToString(row.getCell(5)); // Column E

    if (!docName) continue;

    checklist.push({ documentName: docName, status, comments });

    const norm = normalizeLabel(docName);
    if (norm.includes("ssegapplication") || norm === "ssegapplication") {
      sseg.application = status || "Not Started";
    }
    if (norm.includes("ssegapproval") || norm === "ssegapproval") {
      sseg.approval = status || "Not Started";
    }
  }

  return { checklist, sseg };
}

// ===================== PROJECT INFORMATION =====================

function parseProjectInformation(wb: ExcelJS.Workbook): {
  workbookProjectName?: string;
  siteAddress?: string;
  commissioningDate?: string;
} {
  const ws = findWorksheet(wb, "Project Information");
  if (!ws) return {};

  // Label lookup first, then fixed-cell fallback
  let projectName = "";
  let siteAddress = "";
  let commDate = "";

  for (let r = 1; r <= Math.min(ws.rowCount, 25); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 10; c++) {
      const val = cellToString(row.getCell(c));
      const norm = normalizeLabel(val);
      if (norm.includes("projectname") && !projectName) {
        projectName = cellToString(row.getCell(c + 1)) || cellToString(ws.getRow(r).getCell(4));
      }
      if ((norm.includes("siteaddress") || norm.includes("address")) && !siteAddress) {
        siteAddress = cellToString(row.getCell(c + 1)) || cellToString(ws.getRow(r).getCell(4));
      }
      if ((norm.includes("commissioningdate") || norm.includes("commissioning")) && !commDate) {
        commDate = cellToString(row.getCell(c + 1)) || cellToString(ws.getRow(r).getCell(4));
      }
    }
  }

  return {
    workbookProjectName: projectName || readCellByRef(ws, "D6") || undefined,
    siteAddress: siteAddress || readCellByRef(ws, "D9") || undefined,
    commissioningDate: commDate || readCellByRef(ws, "D17") || undefined,
  };
}

// ===================== FINAL COMPLETION CROSS-CHECK =====================

function parseFinalCompletionCrossCheck(wb: ExcelJS.Workbook): Record<string, string> {
  const ws = findWorksheet(wb, "Final Completion Certificate");
  if (!ws) return {};
  return {
    omHandover: readCellByRef(ws, "D23"),
    communication: readCellByRef(ws, "D24"),
    techsitter: readCellByRef(ws, "D25"),
    inspection: readCellByRef(ws, "D26"),
    testing: readCellByRef(ws, "D27"),
  };
}

// ===================== VALIDATION =====================

function validateWorkbookContract(wb: ExcelJS.Workbook): {
  pass: boolean;
  requiredFound: number;
  totalFound: number;
  matched: string[];
  missing: string[];
  actualSheets: string[];
} {
  const actualSheets = wb.worksheets.map((ws) => ws.name);
  const matched: string[] = [];
  const missing: string[] = [];

  for (const def of SECTION_DEFS) {
    if (findWorksheet(wb, def.sheetName)) {
      matched.push(def.sheetName);
    } else {
      missing.push(def.sheetName);
    }
  }

  const requiredFound = SECTION_DEFS.filter(
    (d) => d.isRequired && matched.includes(d.sheetName)
  ).length;

  const totalFound = matched.length;

  // PASS if all 6 required sheets found, OR at least 8 of 9 total
  const pass = requiredFound === 6 || totalFound >= 8;

  return { pass, requiredFound, totalFound, matched, missing, actualSheets };
}

// ===================== BLOCKER CALCULATION =====================

export function calculateBlockers(sections: CommissioningSection[]): string[] {
  const blockers: string[] = [];
  for (const s of sections) {
    if (s.isRequired && !s.isCompleteForGate) {
      blockers.push(`${s.sectionName}: ${s.rawStatus || "not started"}`);
    }
  }
  return blockers;
}

export function calculateOverallStatus(sections: CommissioningSection[]): CommissioningDisplayStatus {
  const required = sections.filter((s) => s.isRequired);
  if (required.some((s) => s.displayStatus === "blocked")) return "blocked";
  if (required.every((s) => s.isCompleteForGate)) return "complete";
  if (required.some((s) => s.displayStatus === "in_progress" || s.displayStatus === "awaiting_external")) return "in_progress";
  return "not_started";
}

export function calculateCompletionPercent(sections: CommissioningSection[]): number {
  const required = sections.filter((s) => s.isRequired);
  if (required.length === 0) return 0;
  const completed = required.filter((s) => s.isCompleteForGate).length;
  return Math.round((completed / required.length) * 100);
}

// ===================== MAIN PARSER =====================

export async function parseCommissioningWorkbook(
  buffer: Buffer,
  sourceFormat: string = "commissioning_workbook",
): Promise<CommissioningParseResult> {
  const warnings: string[] = [];
  const emptyResult: CommissioningParseResult = {
    sections: [],
    projectInfo: {},
    omHandoverChecklist: [],
    ssegStatus: {},
    finalCompletionCrossCheck: {},
    warnings,
    parseStatus: "failed",
    parseMessage: "",
  };

  let wb: ExcelJS.Workbook;
  try {
    wb = new ExcelJS.Workbook();
    // ExcelJS declares `interface Buffer extends ArrayBuffer` globally, creating a merge
    // conflict with @types/node's generic Buffer in TS6/ES2024. Cast is safe at runtime.
    await wb.xlsx.load(buffer as Buffer & ArrayBuffer);
  } catch (err: unknown) {
    emptyResult.warnings.push(`Failed to load workbook: ${err instanceof Error ? err.message : String(err)}`);
    emptyResult.parseMessage = "Could not open workbook file";
    return emptyResult;
  }

  // Validation gate
  if (sourceFormat === "commissioning_workbook") {
    const v = validateWorkbookContract(wb);
    if (!v.pass) {
      return {
        ...emptyResult,
        warnings: [
          `Workbook does not match commissioning contract. Required sheets found: ${v.requiredFound}/6. Total matched: ${v.totalFound}/9. Missing: [${v.missing.join(", ")}]. Found: [${v.actualSheets.join(", ")}].`,
        ],
        parseStatus: "failed",
        parseMessage: `Workbook validation failed: ${v.requiredFound}/6 required sheets, ${v.totalFound}/9 total.`,
      };
    }
  }

  // Parse each section
  const sections: CommissioningSection[] = [];
  for (const def of SECTION_DEFS) {
    sections.push(parseSection(wb, def, warnings));
  }

  // Parse O&M Handover checklist + SSEG
  const { checklist: omHandoverChecklist, sseg: ssegStatus } = parseOmHandoverChecklist(wb, warnings);

  // Parse Project Information
  const projectInfo = parseProjectInformation(wb);

  // Parse Final Completion cross-check
  const finalCompletionCrossCheck = parseFinalCompletionCrossCheck(wb);

  const hasWarnings = warnings.length > 0;
  const sectionCount = sections.filter((s) => s.displayStatus !== "unknown" || !s.isRequired).length;

  return {
    sections,
    projectInfo,
    omHandoverChecklist,
    ssegStatus,
    finalCompletionCrossCheck,
    warnings,
    parseStatus: hasWarnings ? "partial" : "success",
    parseMessage: `Parsed ${sectionCount} sections from commissioning workbook.${hasWarnings ? ` ${warnings.length} warning(s).` : ""}`,
  };
}

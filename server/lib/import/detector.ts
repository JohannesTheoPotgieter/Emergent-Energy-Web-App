// @ts-nocheck
import ExcelJS from "exceljs";
import { SECTION_ANCHORS, getSynonymsForSection } from "./synonyms";
import { normalizeHeader, getCellRawValue, worksheetToArray, parseDate, parseNumber } from "./utils";

/** Known template layout variants — extensible chain of pattern checks */
export type LayoutVariant = "EE_STANDARD" | "MONDI_LEGACY" | "UNKNOWN";

export interface DetectedSection {
  section: "PLAN" | "REVENUE" | "EXPENDITURE";
  sheetName: string;
  headerRowIndex: number;
  dataStartRowIndex: number;
  dataEndRowIndex: number;
  detectedHeaders: { colIndex: number; rawHeader: string; normalizedHeader: string }[];
  budgetHeaders?: { colIndex: number; rawHeader: string; normalizedHeader: string }[];
  /** Column range for budget (left) pane, if dual-pane detected */
  budgetColRange?: { start: number; end: number };
  /** Column range for actual (right) pane, if dual-pane detected */
  actualColRange?: { start: number; end: number };
  /** Detected template layout variant for this section */
  layoutVariant?: LayoutVariant;
  confidence: number;
}

export interface DetectionResult {
  sections: DetectedSection[];
  unmatched: { sheetName: string; reason: string }[];
  projectInfo: {
    name: string | null;
    sizeKwp: string | null;
    pd: string | null;
    pm: string | null;
    contractValue: string | null;
    phase: string | null;
    pdHandoverDate: string | null;
    constructionStartDate: string | null;
    commissioningDate: string | null;
    omHandoverDate: string | null;
    clientHandoverDate: string | null;
  } | null;
  /** Multi-project tracker info (e.g., FY 2026 Adhoc) */
  multiProject?: {
    isMultiProject: boolean;
    subProjects: string[];
  };
}

function isExcludedSheet(sheetName: string): boolean {
  const norm = sheetName.toLowerCase().trim();
  const suffixPattern = /[\s\-_]+old$/;
  const bracketPattern = /\(old\)/;
  return suffixPattern.test(norm) || bracketPattern.test(norm) || norm.includes("backup") || norm.includes("archive") || norm.includes("copy of");
}

function fuzzySheetMatch(sheetName: string, candidates: string[]): boolean {
  const norm = sheetName.toLowerCase().trim();
  if (isExcludedSheet(sheetName)) return false;
  for (const candidate of candidates) {
    const normCandidate = candidate.toLowerCase().trim();
    if (norm === normCandidate) return true;
    if (norm.includes(normCandidate) || normCandidate.includes(norm)) return true;
  }
  return false;
}

function getAllSynonymPhrases(section: string): string[] {
  const synonyms = getSynonymsForSection(section);
  const phrases: string[] = [];
  for (const values of Object.values(synonyms)) {
    phrases.push(...values);
  }
  return phrases;
}

function scoreRowAsHeader(row: any[], anchorPhrases: string[], allSynonymPhrases: string[]): number {
  if (!row || row.length === 0) return 0;

  let anchorHits = 0;
  let synonymHits = 0;
  const normalizedCells = row.map(cell => normalizeHeader(cell));

  for (const phrase of anchorPhrases) {
    const normPhrase = normalizeHeader(phrase);
    for (const cell of normalizedCells) {
      if (cell && cell.includes(normPhrase)) {
        anchorHits++;
        break;
      }
    }
  }

  for (const phrase of allSynonymPhrases) {
    const normPhrase = normalizeHeader(phrase);
    for (const cell of normalizedCells) {
      if (cell && cell.includes(normPhrase)) {
        synonymHits++;
        break;
      }
    }
  }

  return anchorHits * 2 + synonymHits;
}

/**
 * Detects a "pane gap" in a header row — an empty column sitting between two
 * populated header regions.  Used to split dual-pane layouts such as
 * Expenditure Breakdown (budget left, actual right).
 * Returns the 0-based column index of the gap, or -1 if none found.
 */
export function findPaneGapColumn(headerRow: any[]): number {
  // Build a bitmap of populated columns
  const populated: boolean[] = headerRow.map(
    cell => cell != null && String(cell).trim() !== ""
  );

  // Walk through and find the first empty column that has populated columns
  // on BOTH sides (at least 2 populated before and 2 after).
  for (let c = 1; c < populated.length - 1; c++) {
    if (populated[c]) continue; // not a gap

    // Count populated columns before the gap
    let beforeCount = 0;
    for (let b = 0; b < c; b++) {
      if (populated[b]) beforeCount++;
    }

    // Count populated columns after the gap
    let afterCount = 0;
    for (let a = c + 1; a < populated.length; a++) {
      if (populated[a]) afterCount++;
    }

    if (beforeCount >= 2 && afterCount >= 2) {
      return c;
    }
  }

  return -1;
}

function findHeaderRow(
  data: any[][],
  sectionKey: string,
  maxScanRows: number = 30
): { rowIndex: number; headers: { colIndex: number; rawHeader: string; normalizedHeader: string }[] } | null {
  const anchor = SECTION_ANCHORS[sectionKey];
  if (!anchor) return null;

  const allSynonyms = getAllSynonymPhrases(sectionKey);
  let bestRowIndex = -1;
  let bestScore = 0;

  const scanLimit = Math.min(data.length, maxScanRows);
  for (let i = 0; i < scanLimit; i++) {
    const row = data[i];
    if (!row) continue;

    const nonEmpty = row.filter(c => c != null && String(c).trim() !== "").length;
    if (nonEmpty < 3) continue;

    const score = scoreRowAsHeader(row, anchor.anchorPhrases, allSynonyms);
    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = i;
    }
  }

  if (bestRowIndex < 0 || bestScore < 1) return null;

  let actualSectionStartCol = -1;
  if (sectionKey === "EXPENDITURE") {
    // Method 1: Scan for "actual expenditure" label above header row
    for (let scanRow = 0; scanRow < Math.min(data.length, bestRowIndex); scanRow++) {
      const scanRowData = data[scanRow];
      if (!scanRowData) continue;
      for (let c = 0; c < scanRowData.length; c++) {
        const cellText = String(scanRowData[c] || "").toLowerCase().trim();
        if (cellText.includes("actual expenditure breakdown") || cellText.includes("actual expenditure")) {
          actualSectionStartCol = c;
          break;
        }
      }
      if (actualSectionStartCol >= 0) break;
    }

    // Method 2: Detect pane gap — an empty column between two populated header regions
    if (actualSectionStartCol < 0) {
      const headerRow = data[bestRowIndex];
      if (headerRow) {
        const gapCol = findPaneGapColumn(headerRow);
        if (gapCol >= 0) {
          // The actual pane starts at the first populated column after the gap
          for (let c = gapCol + 1; c < headerRow.length; c++) {
            if (headerRow[c] != null && String(headerRow[c]).trim() !== "") {
              actualSectionStartCol = c;
              break;
            }
          }
        }
      }
    }
  }

  const headerRow = data[bestRowIndex];
  const headers: { colIndex: number; rawHeader: string; normalizedHeader: string }[] = [];
  const budgetHeaders: { colIndex: number; rawHeader: string; normalizedHeader: string }[] = [];
  for (let c = 0; c < headerRow.length; c++) {
    const raw = headerRow[c];
    if (raw == null || String(raw).trim() === "") continue;
    if (actualSectionStartCol >= 0 && c < actualSectionStartCol) {
      budgetHeaders.push({
        colIndex: c,
        rawHeader: String(raw),
        normalizedHeader: normalizeHeader(raw),
      });
    } else {
      headers.push({
        colIndex: c,
        rawHeader: String(raw),
        normalizedHeader: normalizeHeader(raw),
      });
    }
  }

  return { rowIndex: bestRowIndex, headers, budgetHeaders: budgetHeaders.length > 0 ? budgetHeaders : undefined };
}

function isTerminatorRow(row: any[]): boolean {
  const firstCellStr = String(row[0] || "").toLowerCase().trim();
  const joinedStr = row.slice(0, Math.min(5, row.length)).map(c => String(c || "").toLowerCase().trim()).join(" ");
  return (
    joinedStr.includes("end of sheet") ||
    joinedStr.includes("sub total") ||
    joinedStr.startsWith("total") ||
    firstCellStr === "total" ||
    firstCellStr.startsWith("key")
  );
}

function hasDataAhead(data: any[][], fromRow: number, lookAhead: number): boolean {
  const limit = Math.min(fromRow + lookAhead, data.length);
  for (let j = fromRow; j < limit; j++) {
    const r = data[j];
    if (!r) continue;
    const nonEmpty = r.filter(c => c != null && String(c).trim() !== "").length;
    if (nonEmpty >= 2) return true;
  }
  return false;
}

function findDataEndRow(data: any[][], startRow: number, colCount: number): number {
  const MAX_EMPTY_ROWS = 3;
  const LOOK_AHEAD = 50;
  let consecutiveEmpty = 0;

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_EMPTY_ROWS) {
        if (hasDataAhead(data, i + 1, LOOK_AHEAD)) {
          continue;
        }
        return i - consecutiveEmpty + 1;
      }
      continue;
    }

    const nonEmpty = row.filter(c => c != null && String(c).trim() !== "").length;
    if (nonEmpty === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_EMPTY_ROWS) {
        if (hasDataAhead(data, i + 1, LOOK_AHEAD)) {
          continue;
        }
        return i - consecutiveEmpty + 1;
      }
      continue;
    }

    consecutiveEmpty = 0;

    if (isTerminatorRow(row)) {
      if (hasDataAhead(data, i + 1, LOOK_AHEAD)) {
        continue;
      }
      return i;
    }
  }

  return data.length;
}

function computeConfidence(
  sectionKey: string,
  headers: { colIndex: number; rawHeader: string; normalizedHeader: string }[],
  nameMatched: boolean
): number {
  const anchor = SECTION_ANCHORS[sectionKey];
  if (!anchor) return 0;

  const normalizedHeaders = headers.map(h => h.normalizedHeader);

  let anchorHits = 0;
  for (const phrase of anchor.anchorPhrases) {
    const normPhrase = normalizeHeader(phrase);
    if (normalizedHeaders.some(h => h.includes(normPhrase))) {
      anchorHits++;
    }
  }
  const anchorScore = anchor.anchorPhrases.length > 0
    ? anchorHits / anchor.anchorPhrases.length
    : 1;

  const synonyms = getSynonymsForSection(sectionKey);
  let requiredHits = 0;
  for (const reqField of anchor.requiredFields) {
    const fieldSynonyms = synonyms[reqField] || [];
    const found = fieldSynonyms.some(syn => {
      const normSyn = syn.toLowerCase().trim();
      return normalizedHeaders.some(h => h.includes(normSyn));
    });
    if (found) requiredHits++;
  }
  const requiredScore = anchor.requiredFields.length > 0
    ? requiredHits / anchor.requiredFields.length
    : 1;

  const nameBonus = nameMatched ? 0.1 : 0;

  return Math.min(1, anchorScore * requiredScore + nameBonus);
}

/**
 * Detects the Project Plan template layout variant by inspecting metadata
 * cells.  Designed as an extensible chain — add new patterns here.
 */
export function detectPlanLayoutVariant(ws: ExcelJS.Worksheet): LayoutVariant {
  const cell = (r: number, c: number): string => {
    const v = getCellRawValue(ws.getRow(r).getCell(c));
    return v ? String(v).toLowerCase().trim() : "";
  };

  // LAYOUT A — "EE Standard": C2 contains "PROJECT PLAN", C3 contains "PROJECT SIZE"
  if (cell(2, 3).includes("project plan") && cell(3, 3).includes("project size")) {
    return "EE_STANDARD";
  }

  // LAYOUT B — "Mondi/Legacy": A1 contains "Project Plan", B5 contains "Project Start" or B6 contains "Project Name"
  if (cell(1, 1).includes("project plan") && (cell(5, 2).includes("project start") || cell(6, 2).includes("project name"))) {
    return "MONDI_LEGACY";
  }

  // Fallback: check for EE Standard header pattern in rows 2-7
  for (let r = 2; r <= 7; r++) {
    const c3 = cell(r, 3);
    if (c3.includes("project plan") || c3.includes("project size") || c3.includes("project developer")) {
      return "EE_STANDARD";
    }
  }

  // Fallback: check for Mondi pattern in rows 1-6
  if (cell(1, 1).includes("project") || cell(5, 2).includes("project") || cell(6, 2).includes("project")) {
    const headerRow8 = cell(8, 1);
    if (headerRow8.includes("wbs")) {
      return "MONDI_LEGACY";
    }
  }

  return "UNKNOWN";
}

function extractProjectInfo(
  ws: ExcelJS.Worksheet,
  headerRowIndex: number = 50
): DetectionResult["projectInfo"] {
  const maxRow = Math.min(headerRowIndex, ws.rowCount);
  const maxCol = Math.min(ws.columnCount, 15);

  function findLabeledValue(labels: string[], mode: "text" | "number" | "date" = "text"): string | null {
    for (let r = 1; r <= maxRow; r++) {
      const wsRow = ws.getRow(r);
      for (let c = 1; c <= maxCol; c++) {
        const cellVal = getCellRawValue(wsRow.getCell(c));
        if (!cellVal) continue;
        const cellText = String(cellVal).toLowerCase().trim();
        const matchedLabel = labels.find(label => cellText.includes(label.toLowerCase()));
        if (!matchedLabel) continue;

        const afterLabel = String(cellVal).trim();
        const labelIdx = afterLabel.toLowerCase().indexOf(matchedLabel.toLowerCase());
        if (labelIdx >= 0) {
          const rawAfter = afterLabel.substring(labelIdx + matchedLabel.length);
          const firstChar = rawAfter.charAt(0);
          if (!firstChar || !/[a-zA-Z0-9]/.test(firstChar)) {
            let inlineVal = rawAfter.replace(/^[\s:;\-–]+/, "").trim();
            if (inlineVal.length > 0 && mode === "text") {
              return inlineVal;
            }
            if (inlineVal.length > 0 && mode === "number") {
              const n = parseNumber(inlineVal);
              if (n) return n;
            }
            if (inlineVal.length > 0 && mode === "date") {
              const d = parseDate(inlineVal);
              if (d) return d;
            }
          }
        }

        for (let dc = 1; dc <= 4; dc++) {
          if (c + dc > maxCol) break;
          const valueCell = getCellRawValue(wsRow.getCell(c + dc));
          if (valueCell == null || String(valueCell).trim() === "") continue;
          if (mode === "date") {
            const d = parseDate(valueCell);
            if (d) return d;
          } else if (mode === "number") {
            const n = parseNumber(valueCell);
            if (n) return n;
          } else {
            return String(valueCell).trim();
          }
        }
        if (r + 1 <= maxRow) {
          const belowVal = getCellRawValue(ws.getRow(r + 1).getCell(c));
          if (belowVal != null && String(belowVal).trim() !== "") {
            if (mode === "date") {
              const d = parseDate(belowVal);
              if (d) return d;
            } else if (mode === "number") {
              const n = parseNumber(belowVal);
              if (n) return n;
            } else {
              return String(belowVal).trim();
            }
          }
        }
      }
    }
    return null;
  }

  const name = findLabeledValue(["project name", "project plan", "project:", "site name", "project title"]);
  const sizeKwp = findLabeledValue(["size", "kwp", "capacity", "system size"], "number");
  const pd = findLabeledValue(["project director", "project developer", "pd:", "pd name"]);
  const pm = findLabeledValue(["project managers", "project manager", "pm:", "pm name"]);
  const contractValue = findLabeledValue(["contract value", "contract amount", "total contract", "project value"], "number");
  const phase = findLabeledValue(["phase", "execution phase", "current phase", "project phase"]);

  const pdHandoverDate = findLabeledValue(["pd handover", "handover date", "design handover"], "date");
  const constructionStartDate = findLabeledValue(["construction start", "construction commencement", "site start"], "date");
  const commissioningDate = findLabeledValue(["commissioning", "commissioning date"], "date");
  const omHandoverDate = findLabeledValue(["o&m handover", "om handover", "o & m handover", "handover to mam", "mam handover"], "date");
  const clientHandoverDate = findLabeledValue(["client handover", "final handover", "practical completion"], "date");

  return {
    name,
    sizeKwp,
    pd,
    pm,
    contractValue,
    phase,
    pdHandoverDate,
    constructionStartDate,
    commissioningDate,
    omHandoverDate,
    clientHandoverDate,
  };
}

function deriveKeyDatesFromPlan(
  ws: ExcelJS.Worksheet,
  dataStartRow: number,
  dataEndRow: number,
  headers: { colIndex: number; normalizedHeader: string }[]
): Partial<Record<"constructionStartDate" | "commissioningDate" | "omHandoverDate" | "clientHandoverDate" | "pdHandoverDate", string>> {
  const result: Record<string, string | null> = {};

  const taskCol = headers.find(h =>
    ["task", "description", "activity", "high level programme", "programme", "milestone", "item"].includes(h.normalizedHeader)
  );

  const dateColCandidates = headers.filter(h =>
    ["planned start", "planned_start", "start date", "start", "actual start", "actual_start",
     "planned end", "planned_end", "end date", "end", "actual end", "actual_end"].includes(h.normalizedHeader)
  );
  const startCol = dateColCandidates.find(h => h.normalizedHeader.includes("actual") && h.normalizedHeader.includes("start"))
    || dateColCandidates.find(h => h.normalizedHeader.includes("start"));
  const endCol = dateColCandidates.find(h => h.normalizedHeader.includes("actual") && h.normalizedHeader.includes("end"))
    || dateColCandidates.find(h => h.normalizedHeader.includes("end"));

  if (!taskCol || (!startCol && !endCol)) return result;

  const milestonePatterns: { key: string; patterns: string[]; useEnd: boolean }[] = [
    { key: "constructionStartDate", patterns: ["site establishment", "construction start", "construction commencement"], useEnd: false },
    { key: "commissioningDate", patterns: ["commissioning"], useEnd: false },
    { key: "omHandoverDate", patterns: ["o&m handover", "om handover", "o & m handover", "handover to matriarch", "handover to o&m", "handover to mam", "mam handover"], useEnd: false },
    { key: "clientHandoverDate", patterns: ["handover to client", "client handover", "practical completion", "final handover"], useEnd: false },
    { key: "pdHandoverDate", patterns: ["project charter handover", "pd handover", "design handover", "handover documentation"], useEnd: false },
  ];

  for (let r = dataStartRow; r <= Math.min(dataEndRow, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const taskVal = getCellRawValue(row.getCell(taskCol.colIndex + 1));
    if (!taskVal) continue;
    const taskText = String(taskVal).toLowerCase().trim();

    for (const milestone of milestonePatterns) {
      if (result[milestone.key]) continue;
      const matched = milestone.patterns.some(p => taskText === p || taskText.includes(p));
      if (!matched) continue;

      const col = milestone.useEnd ? (endCol || startCol) : (startCol || endCol);
      if (!col) continue;
      const dateVal = getCellRawValue(row.getCell(col.colIndex + 1));
      if (dateVal) {
        const d = parseDate(dateVal);
        if (d) result[milestone.key] = d;
      }
    }
  }

  return result;
}

/**
 * Returns true if the sheet name is a generic name (Sheet1, Sheet2, etc.)
 * that should be deprioritized when a dedicated sheet exists.
 */
export function isGenericSheetName(sheetName: string): boolean {
  return /^sheet\s*\d+$/i.test(sheetName.trim());
}

/**
 * Computes a sheet name confidence adjustment:
 * - Dedicated section keyword matches get a bonus
 * - Generic sheet names (Sheet1, Sheet2, Sheet3) get a penalty
 */
export function sheetNameConfidenceAdjustment(sheetName: string, sectionKey: string): number {
  const norm = sheetName.toLowerCase().trim();

  // Penalty for generic sheet names
  if (isGenericSheetName(sheetName)) {
    return -30;
  }

  // Bonus for dedicated section keyword matches
  const dedicatedNames: Record<string, string[]> = {
    PLAN: ["project plan", "programme", "schedule"],
    REVENUE: ["revenue tracking", "revenue"],
    EXPENDITURE: ["expenditure breakdown", "expenditure"],
  };

  const keywords = dedicatedNames[sectionKey] || [];
  for (const kw of keywords) {
    if (norm.includes(kw) || kw.includes(norm)) {
      return 50;
    }
  }

  return 0;
}

/**
 * Scans plan data for "Project Activities - {name}" parent rows to detect
 * multi-project (ad-hoc) trackers. Returns array of sub-project names.
 */
export function detectMultiProjectSubProjects(
  data: any[][],
  dataStartRow: number,
  dataEndRow: number
): string[] {
  const subProjects: string[] = [];
  const pattern = /^project\s+activit(?:y|ies)\s*[-–—:]\s*(.+)/i;

  for (let i = dataStartRow; i < Math.min(dataEndRow, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    // Check columns B (1) and C (2) for the parent row pattern
    for (const colIdx of [1, 2, 0]) {
      const cell = row[colIdx];
      if (!cell) continue;
      const text = String(cell).trim();
      const match = text.match(pattern);
      if (match) {
        const name = match[1].trim();
        if (name && !subProjects.includes(name)) {
          subProjects.push(name);
        }
        break;
      }
    }
  }

  return subProjects;
}

export function detectSections(workbook: ExcelJS.Workbook): DetectionResult {
  const sections: DetectedSection[] = [];
  const unmatched: { sheetName: string; reason: string }[] = [];
  let projectInfo: DetectionResult["projectInfo"] = null;

  const claimedSheets = new Set<string>();

  console.log(`[Detector] Workbook has ${workbook.worksheets.length} sheets: ${workbook.worksheets.map(ws => ws.name).join(", ")}`);

  // Pass 1: Match sections by sheet name AND content
  for (const sectionKey of Object.keys(SECTION_ANCHORS)) {
    const anchor = SECTION_ANCHORS[sectionKey];

    // Collect ALL candidates for this section to enable priority comparison
    const allCandidates: {
      ws: ExcelJS.Worksheet;
      headerResult: NonNullable<ReturnType<typeof findHeaderRow>>;
      confidence: number;
      effectiveConfidence: number;
      dataStartRow: number;
      dataEndRow: number;
      nameMatched: boolean;
    }[] = [];

    for (const ws of workbook.worksheets) {
      if (claimedSheets.has(ws.name)) continue;
      if (isExcludedSheet(ws.name)) continue;

      const nameMatched = fuzzySheetMatch(ws.name, anchor.sheetNames);

      const data = worksheetToArray(ws);
      if (data.length === 0) continue;

      const headerResult = findHeaderRow(data, sectionKey, nameMatched ? 100 : 30);

      if (headerResult) {
        const dataStartRow = headerResult.rowIndex + 1;
        const dataEndRow = findDataEndRow(data, dataStartRow, data[0]?.length || 0);
        const confidence = computeConfidence(sectionKey, headerResult.headers, nameMatched);
        const sheetAdj = sheetNameConfidenceAdjustment(ws.name, sectionKey);
        const effectiveConfidence = (nameMatched ? confidence + 0.5 : confidence) + sheetAdj;

        console.log(`[Detector] ${sectionKey}: sheet "${ws.name}" nameMatch=${nameMatched}, headerRow=${headerResult.rowIndex}, headers=${headerResult.headers.length}, confidence=${confidence.toFixed(2)}, sheetAdj=${sheetAdj}, effective=${effectiveConfidence.toFixed(2)}`);

        allCandidates.push({ ws, headerResult, confidence, effectiveConfidence, dataStartRow, dataEndRow, nameMatched });
      } else if (nameMatched) {
        console.log(`[Detector] ${sectionKey}: sheet "${ws.name}" nameMatch=true but no header row found (data rows: ${data.length}), trying relaxed scan`);
        const relaxedResult = findHeaderRow(data, sectionKey, 200);
        if (relaxedResult) {
          const dataStartRow = relaxedResult.rowIndex + 1;
          const dataEndRow = findDataEndRow(data, dataStartRow, data[0]?.length || 0);
          const confidence = computeConfidence(sectionKey, relaxedResult.headers, true);
          const sheetAdj = sheetNameConfidenceAdjustment(ws.name, sectionKey);
          const effectiveConfidence = confidence + 0.5 + sheetAdj;
          console.log(`[Detector] ${sectionKey}: sheet "${ws.name}" relaxed scan found headerRow=${relaxedResult.rowIndex}, confidence=${confidence.toFixed(2)}, sheetAdj=${sheetAdj}, effective=${effectiveConfidence.toFixed(2)}`);
          allCandidates.push({ ws, headerResult: relaxedResult, confidence, effectiveConfidence, dataStartRow, dataEndRow, nameMatched: true });
        }
      }
    }

    // Sort candidates by effective confidence (highest first)
    allCandidates.sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);

    const bestCandidate = allCandidates.length > 0 ? allCandidates[0] : null;

    // Log skipped generic sheets that were superseded by a dedicated sheet
    if (bestCandidate && allCandidates.length > 1) {
      for (let i = 1; i < allCandidates.length; i++) {
        const loser = allCandidates[i];
        if (isGenericSheetName(loser.ws.name)) {
          const dataRows = loser.dataEndRow - loser.dataStartRow;
          const winnerDataRows = bestCandidate.dataEndRow - bestCandidate.dataStartRow;
          unmatched.push({
            sheetName: loser.ws.name,
            reason: `Superseded by dedicated '${bestCandidate.ws.name}' sheet (${winnerDataRows} rows vs ${dataRows} rows)`,
          });
          console.log(`[Detector] ${sectionKey}: skipping "${loser.ws.name}" — superseded by "${bestCandidate.ws.name}" (${winnerDataRows} rows vs ${dataRows} rows)`);
          claimedSheets.add(loser.ws.name);
        }
      }
    }

    if (bestCandidate) {
      // Compute budget/actual column ranges from the split headers
      let budgetColRange: DetectedSection["budgetColRange"];
      let actualColRange: DetectedSection["actualColRange"];

      if (bestCandidate.headerResult.budgetHeaders && bestCandidate.headerResult.budgetHeaders.length > 0) {
        const bh = bestCandidate.headerResult.budgetHeaders;
        budgetColRange = { start: bh[0].colIndex, end: bh[bh.length - 1].colIndex };
        const ah = bestCandidate.headerResult.headers;
        if (ah.length > 0) {
          actualColRange = { start: ah[0].colIndex, end: ah[ah.length - 1].colIndex };
        }
        console.log(`[Detector] ${sectionKey}: dual-pane detected — budget cols ${budgetColRange.start}-${budgetColRange.end}, actual cols ${actualColRange?.start}-${actualColRange?.end}`);
      } else if (sectionKey === "EXPENDITURE") {
        console.log(`[Detector] ${sectionKey}: WARNING — no pane gap detected, treating as single-table mode`);
      }

      // Detect layout variant for PLAN sections
      let layoutVariant: LayoutVariant | undefined;
      if (sectionKey === "PLAN") {
        layoutVariant = detectPlanLayoutVariant(bestCandidate.ws);
        console.log(`[Detector] PLAN: layout variant detected as "${layoutVariant}"`);
      }

      sections.push({
        section: sectionKey as DetectedSection["section"],
        sheetName: bestCandidate.ws.name,
        headerRowIndex: bestCandidate.headerResult.rowIndex,
        dataStartRowIndex: bestCandidate.dataStartRow,
        dataEndRowIndex: bestCandidate.dataEndRow,
        detectedHeaders: bestCandidate.headerResult.headers,
        budgetHeaders: bestCandidate.headerResult.budgetHeaders,
        budgetColRange,
        actualColRange,
        layoutVariant,
        confidence: bestCandidate.confidence,
      });

      claimedSheets.add(bestCandidate.ws.name);

      if (sectionKey === "PLAN") {
        projectInfo = extractProjectInfo(bestCandidate.ws, bestCandidate.headerResult.rowIndex);
        const derivedDates = deriveKeyDatesFromPlan(
          bestCandidate.ws,
          bestCandidate.dataStartRow,
          bestCandidate.dataEndRow,
          bestCandidate.headerResult.headers
        );
        if (projectInfo) {
          for (const [key, val] of Object.entries(derivedDates)) {
            if (val && !(projectInfo as any)[key]) {
              (projectInfo as any)[key] = val;
            }
          }
        }
      }
    } else {
      console.log(`[Detector] ${sectionKey}: no candidate found in any sheet`);
    }
  }

  // Pass 2: Any unclaimed sheets — try to match by content only
  for (const ws of workbook.worksheets) {
    if (claimedSheets.has(ws.name)) continue;

    if (isExcludedSheet(ws.name)) {
      unmatched.push({ sheetName: ws.name, reason: "Excluded (old/backup/archive)" });
      continue;
    }

    const data = worksheetToArray(ws);
    if (data.length === 0) {
      unmatched.push({ sheetName: ws.name, reason: "Empty sheet" });
      continue;
    }

    let bestSection: string | null = null;
    let bestScore = 0;
    let bestHeader: ReturnType<typeof findHeaderRow> = null;

    for (const sectionKey of Object.keys(SECTION_ANCHORS)) {
      const alreadyClaimed = sections.some(s => s.section === sectionKey);
      if (alreadyClaimed) continue;

      const headerResult = findHeaderRow(data, sectionKey);
      if (headerResult) {
        const anchor = SECTION_ANCHORS[sectionKey];
        const allSynonyms = getAllSynonymPhrases(sectionKey);
        const score = scoreRowAsHeader(data[headerResult.rowIndex], anchor.anchorPhrases, allSynonyms);

        if (score > bestScore) {
          bestScore = score;
          bestSection = sectionKey;
          bestHeader = headerResult;
        }
      }
    }

    if (bestSection && bestHeader && bestScore >= 2) {
      const dataStartRow = bestHeader.rowIndex + 1;
      const dataEndRow = findDataEndRow(data, dataStartRow, data[0]?.length || 0);
      const confidence = computeConfidence(bestSection, bestHeader.headers, false);

      sections.push({
        section: bestSection as DetectedSection["section"],
        sheetName: ws.name,
        headerRowIndex: bestHeader.rowIndex,
        dataStartRowIndex: dataStartRow,
        dataEndRowIndex: dataEndRow,
        detectedHeaders: bestHeader.headers,
        confidence,
      });

      claimedSheets.add(ws.name);

      if (bestSection === "PLAN" && !projectInfo) {
        projectInfo = extractProjectInfo(ws, bestHeader.rowIndex);
      }
    } else {
      unmatched.push({
        sheetName: ws.name,
        reason: bestSection
          ? `Low confidence match to ${bestSection} (score: ${bestScore})`
          : "No matching section detected",
      });
    }
  }

  // Multi-project detection: check for "Project Activities - {name}" parent rows in PLAN data
  let multiProject: DetectionResult["multiProject"];
  const planSection = sections.find(s => s.section === "PLAN");
  if (planSection) {
    const planWs = workbook.getWorksheet(planSection.sheetName);
    if (planWs) {
      const planData = worksheetToArray(planWs);
      const subProjects = detectMultiProjectSubProjects(planData, planSection.dataStartRowIndex, planSection.dataEndRowIndex);
      if (subProjects.length >= 2) {
        multiProject = { isMultiProject: true, subProjects };
        console.log(`[Detector] Multi-project tracker detected: ${subProjects.length} sub-projects: ${subProjects.join(", ")}`);
      }
    }
  }

  // Filename-based signal: "adhoc" or "ad hoc" in any detected project name
  if (!multiProject && projectInfo?.name) {
    const nameLower = projectInfo.name.toLowerCase();
    if (nameLower.includes("adhoc") || nameLower.includes("ad hoc") || nameLower.includes("ad-hoc")) {
      // Mark as potential multi-project but with empty sub-projects until confirmed by data
      console.log(`[Detector] Filename/project name suggests ad-hoc tracker but no sub-project rows detected`);
    }
  }

  console.log(`[Detector] Final: ${sections.length} sections detected, ${unmatched.length} unmatched`);
  return { sections, unmatched, projectInfo, multiProject };
}

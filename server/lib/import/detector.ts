import ExcelJS from "exceljs";
import { SECTION_ANCHORS, getSynonymsForSection } from "./synonyms";
import { normalizeHeader, getCellRawValue, worksheetToArray, parseDate, parseNumber } from "./utils";

export interface DetectedSection {
  section: "PLAN" | "REVENUE" | "EXPENDITURE";
  sheetName: string;
  headerRowIndex: number;
  dataStartRowIndex: number;
  dataEndRowIndex: number;
  detectedHeaders: { colIndex: number; rawHeader: string; normalizedHeader: string }[];
  budgetHeaders?: { colIndex: number; rawHeader: string; normalizedHeader: string }[];
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
}

function fuzzySheetMatch(sheetName: string, candidates: string[]): boolean {
  const norm = sheetName.toLowerCase().trim();
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

function findDataEndRow(data: any[][], startRow: number, colCount: number): number {
  const MAX_EMPTY_ROWS = 3;
  let consecutiveEmpty = 0;

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_EMPTY_ROWS) return i - MAX_EMPTY_ROWS;
      continue;
    }

    const nonEmpty = row.filter(c => c != null && String(c).trim() !== "").length;
    if (nonEmpty === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_EMPTY_ROWS) return i - MAX_EMPTY_ROWS;
      continue;
    }

    consecutiveEmpty = 0;

    const firstCellStr = String(row[0] || "").toLowerCase().trim();
    const joinedStr = row.slice(0, Math.min(5, row.length)).map(c => String(c || "").toLowerCase().trim()).join(" ");

    if (
      joinedStr.includes("end of sheet") ||
      joinedStr.includes("sub total") ||
      joinedStr.startsWith("total") ||
      firstCellStr === "total" ||
      firstCellStr.startsWith("key")
    ) {
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

export function detectSections(workbook: ExcelJS.Workbook): DetectionResult {
  const sections: DetectedSection[] = [];
  const unmatched: { sheetName: string; reason: string }[] = [];
  let projectInfo: DetectionResult["projectInfo"] = null;

  const claimedSheets = new Set<string>();

  console.log(`[Detector] Workbook has ${workbook.worksheets.length} sheets: ${workbook.worksheets.map(ws => ws.name).join(", ")}`);

  // Pass 1: Match sections by sheet name AND content
  for (const sectionKey of Object.keys(SECTION_ANCHORS)) {
    const anchor = SECTION_ANCHORS[sectionKey];

    let bestCandidate: {
      ws: ExcelJS.Worksheet;
      headerResult: NonNullable<ReturnType<typeof findHeaderRow>>;
      confidence: number;
      dataStartRow: number;
      dataEndRow: number;
      nameMatched: boolean;
    } | null = null;

    for (const ws of workbook.worksheets) {
      if (claimedSheets.has(ws.name)) continue;

      const nameMatched = fuzzySheetMatch(ws.name, anchor.sheetNames);

      const data = worksheetToArray(ws);
      if (data.length === 0) continue;

      const headerResult = findHeaderRow(data, sectionKey, nameMatched ? 50 : 30);

      if (headerResult) {
        const dataStartRow = headerResult.rowIndex + 1;
        const dataEndRow = findDataEndRow(data, dataStartRow, data[0]?.length || 0);
        const confidence = computeConfidence(sectionKey, headerResult.headers, nameMatched);

        console.log(`[Detector] ${sectionKey}: sheet "${ws.name}" nameMatch=${nameMatched}, headerRow=${headerResult.rowIndex}, headers=${headerResult.headers.length}, confidence=${confidence.toFixed(2)}`);

        const effectiveConfidence = nameMatched ? confidence + 0.2 : confidence;

        if (!bestCandidate || effectiveConfidence > (bestCandidate.nameMatched ? bestCandidate.confidence + 0.2 : bestCandidate.confidence)) {
          bestCandidate = { ws, headerResult, confidence, dataStartRow, dataEndRow, nameMatched };
        }
      } else if (nameMatched) {
        console.log(`[Detector] ${sectionKey}: sheet "${ws.name}" nameMatch=true but no header row found (data rows: ${data.length})`);
      }
    }

    if (bestCandidate) {
      sections.push({
        section: sectionKey as DetectedSection["section"],
        sheetName: bestCandidate.ws.name,
        headerRowIndex: bestCandidate.headerResult.rowIndex,
        dataStartRowIndex: bestCandidate.dataStartRow,
        dataEndRowIndex: bestCandidate.dataEndRow,
        detectedHeaders: bestCandidate.headerResult.headers,
        budgetHeaders: bestCandidate.headerResult.budgetHeaders,
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

  console.log(`[Detector] Final: ${sections.length} sections detected, ${unmatched.length} unmatched`);
  return { sections, unmatched, projectInfo };
}

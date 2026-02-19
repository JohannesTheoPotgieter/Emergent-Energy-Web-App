import ExcelJS from "exceljs";
import { SECTION_ANCHORS, getSynonymsForSection } from "./synonyms";
import { normalizeHeader, getCellRawValue, worksheetToArray, parseDate, parseNumber } from "./utils";

export interface DetectedSection {
  section: "PLAN" | "REVENUE" | "EXPENDITURE" | "CASHFLOW";
  sheetName: string;
  headerRowIndex: number;
  dataStartRowIndex: number;
  dataEndRowIndex: number;
  detectedHeaders: { colIndex: number; rawHeader: string; normalizedHeader: string }[];
  confidence: number;
}

export interface DetectionResult {
  sections: DetectedSection[];
  unmatched: { sheetName: string; reason: string }[];
  projectInfo: {
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
    const normPhrase = phrase.toLowerCase().trim();
    for (const cell of normalizedCells) {
      if (cell && cell.includes(normPhrase)) {
        anchorHits++;
        break;
      }
    }
  }

  for (const phrase of allSynonymPhrases) {
    const normPhrase = phrase.toLowerCase().trim();
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

  if (bestRowIndex < 0 || bestScore < 2) return null;

  const headerRow = data[bestRowIndex];
  const headers: { colIndex: number; rawHeader: string; normalizedHeader: string }[] = [];
  for (let c = 0; c < headerRow.length; c++) {
    const raw = headerRow[c];
    if (raw != null && String(raw).trim() !== "") {
      headers.push({
        colIndex: c,
        rawHeader: String(raw),
        normalizedHeader: normalizeHeader(raw),
      });
    }
  }

  return { rowIndex: bestRowIndex, headers };
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
    const normPhrase = phrase.toLowerCase().trim();
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
  ws: ExcelJS.Worksheet
): DetectionResult["projectInfo"] {
  function getCellValue(col: string, row: number): any {
    const cell = ws.getCell(`${col}${row}`);
    return getCellRawValue(cell);
  }

  function findLabeledDateValue(labels: string[]): string | null {
    const maxRow = Math.min(ws.rowCount, 50);
    const maxCol = Math.min(ws.columnCount, 11);

    for (let r = 1; r <= maxRow; r++) {
      const wsRow = ws.getRow(r);
      for (let c = 1; c <= maxCol; c++) {
        const cellVal = getCellRawValue(wsRow.getCell(c));
        if (cellVal) {
          const cellText = String(cellVal).toLowerCase().trim();
          for (const label of labels) {
            if (cellText.includes(label.toLowerCase())) {
              for (let dc = 1; dc <= 4; dc++) {
                if (c + dc <= ws.columnCount) {
                  const valueCell = getCellRawValue(wsRow.getCell(c + dc));
                  if (valueCell) {
                    const dateVal = parseDate(valueCell);
                    if (dateVal) return dateVal;
                  }
                }
              }
              if (r + 1 <= maxRow) {
                const belowRow = ws.getRow(r + 1);
                const belowVal = getCellRawValue(belowRow.getCell(c));
                if (belowVal) {
                  const dateVal = parseDate(belowVal);
                  if (dateVal) return dateVal;
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  const sizeKwp = parseNumber(getCellValue("E", 3));
  const pd = getCellValue("E", 4);
  const pm = getCellValue("E", 5);
  const contractValue = parseNumber(getCellValue("E", 6));
  const phase = getCellValue("E", 7);

  const pdHandoverDate = parseDate(getCellValue("E", 8)) || findLabeledDateValue(["pd handover", "handover date"]);
  const constructionStartDate = parseDate(getCellValue("E", 9)) || findLabeledDateValue(["construction start", "start date"]);
  const commissioningDate = parseDate(getCellValue("E", 10)) || findLabeledDateValue(["commissioning"]);
  const omHandoverDate = parseDate(getCellValue("E", 11)) || findLabeledDateValue(["o&m handover", "om handover"]);
  const clientHandoverDate = parseDate(getCellValue("E", 12)) || findLabeledDateValue(["client handover"]);

  return {
    sizeKwp,
    pd: pd ? String(pd) : null,
    pm: pm ? String(pm) : null,
    contractValue,
    phase: phase ? String(phase) : null,
    pdHandoverDate,
    constructionStartDate,
    commissioningDate,
    omHandoverDate,
    clientHandoverDate,
  };
}

export function detectSections(workbook: ExcelJS.Workbook): DetectionResult {
  const sections: DetectedSection[] = [];
  const unmatched: { sheetName: string; reason: string }[] = [];
  let projectInfo: DetectionResult["projectInfo"] = null;

  const claimedSheets = new Set<string>();

  for (const sectionKey of Object.keys(SECTION_ANCHORS)) {
    const anchor = SECTION_ANCHORS[sectionKey];

    let bestCandidate: {
      ws: ExcelJS.Worksheet;
      headerResult: NonNullable<ReturnType<typeof findHeaderRow>>;
      confidence: number;
      dataStartRow: number;
      dataEndRow: number;
    } | null = null;

    for (const ws of workbook.worksheets) {
      if (claimedSheets.has(ws.name)) continue;

      const nameMatched = fuzzySheetMatch(ws.name, anchor.sheetNames);
      if (!nameMatched) continue;

      const data = worksheetToArray(ws);
      const headerResult = findHeaderRow(data, sectionKey);

      if (headerResult) {
        const dataStartRow = headerResult.rowIndex + 1;
        const dataEndRow = findDataEndRow(data, dataStartRow, data[0]?.length || 0);
        const confidence = computeConfidence(sectionKey, headerResult.headers, true);

        if (!bestCandidate || confidence > bestCandidate.confidence) {
          bestCandidate = { ws, headerResult, confidence, dataStartRow, dataEndRow };
        }
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
        confidence: bestCandidate.confidence,
      });

      claimedSheets.add(bestCandidate.ws.name);

      if (sectionKey === "PLAN") {
        projectInfo = extractProjectInfo(bestCandidate.ws);
      }
    }
  }

  for (const ws of workbook.worksheets) {
    if (claimedSheets.has(ws.name)) continue;

    const data = worksheetToArray(ws);
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

    if (bestSection && bestHeader && bestScore >= 3) {
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
        projectInfo = extractProjectInfo(ws);
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

  return { sections, unmatched, projectInfo };
}

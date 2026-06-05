import ExcelJS from "exceljs";
import { detectSections, type DetectionResult } from "./detector";
import { mapColumns, type MappingResult } from "./mapper";
import { normalizeData, type NormalizationResult } from "./normalizer";

export interface SmartImportPreview {
  detection: DetectionResult;
  mappings: MappingResult[];
  normalization: NormalizationResult;
  hasBlockers: boolean;
  needsReview: boolean;
}

export async function runSmartImportPreview(
  buffer: Buffer,
  fileName: string,
  /**
   * Previously-learned column mappings for this file's template profile.
   * When supplied, `mapColumns` prefers them over synonym/fuzzy matching so a
   * tracker whose columns were corrected once is not re-questioned on re-import.
   * Optional — callers without DB context (or a fresh template) pass nothing.
   */
  learnedMappings?: { section: string; sourceHeader: string; canonicalField: string; confidenceWeight: number }[],
): Promise<SmartImportPreview> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS declares `interface Buffer extends ArrayBuffer` globally, creating a merge
    // conflict with @types/node's generic Buffer in TS6/ES2024. Cast is safe at runtime.
    await workbook.xlsx.load(buffer as Buffer & ArrayBuffer);
  } catch (parseErr: any) {
    const isXlsm = fileName.toLowerCase().endsWith(".xlsm");
    if (isXlsm) {
      try {
        await (workbook as any).xlsx.load(buffer, { ignoreNodes: ['dataValidations'] });
      } catch {
        throw new Error(`PARSE_ERROR: The file "${fileName}" appears to be corrupt or is not a valid Excel file. Please re-export it from Excel and try again.`);
      }
    } else {
      throw new Error(`PARSE_ERROR: The file "${fileName}" appears to be corrupt or is not a valid Excel file. Please re-export it from Excel and try again.`);
    }
  }

  const detection = detectSections(workbook);

  const mappings = detection.sections.map(section => mapColumns(section, workbook, learnedMappings));

  const normalization = normalizeData(detection, mappings, workbook);

  const hasBlockers = normalization.issues.some(i => i.severity === "BLOCKER");
  const lowConfidence = mappings.some(m => m.overallConfidence < 0.7);
  const needsReview = hasBlockers || lowConfidence || normalization.issues.length > 0;

  return { detection, mappings, normalization, hasBlockers, needsReview };
}

export { type DetectedSection, type DetectionResult, type LayoutVariant } from "./detector";
export { type ColumnMapping, type MappingResult } from "./mapper";
export { type NormalizationResult } from "./normalizer";

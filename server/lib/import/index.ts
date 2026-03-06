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

export async function runSmartImportPreview(buffer: Buffer, fileName: string): Promise<SmartImportPreview> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
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

  const mappings = detection.sections.map(section => mapColumns(section, workbook));

  const normalization = normalizeData(detection, mappings, workbook);

  const hasBlockers = normalization.issues.some(i => i.severity === "BLOCKER");
  const lowConfidence = mappings.some(m => m.overallConfidence < 0.7);
  const needsReview = hasBlockers || lowConfidence || normalization.issues.length > 0;

  return { detection, mappings, normalization, hasBlockers, needsReview };
}

export { type DetectedSection, type DetectionResult } from "./detector";
export { type ColumnMapping, type MappingResult } from "./mapper";
export { type NormalizationResult } from "./normalizer";

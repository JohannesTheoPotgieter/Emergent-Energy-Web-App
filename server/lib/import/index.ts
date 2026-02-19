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
  await workbook.xlsx.load(buffer);

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

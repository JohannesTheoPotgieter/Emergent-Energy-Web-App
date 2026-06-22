import ExcelJS from "exceljs";
import { detectSections, type DetectionResult } from "./detector";
import { mapColumns, planActualPctGap, type MappingResult } from "./mapper";
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

  // FLAG, NEVER SKIP: if the Revenue Tracking / milestone block could not be
  // located by header signature in any sheet, surface an explicit import flag
  // so the operator does a one-time manual mapping. A silent skip would
  // under-count cash inflows invisibly (Revenue Tracking is the cash/AR source).
  if (detection.missingSections?.includes("REVENUE")) {
    normalization.issues.push({
      severity: "WARNING",
      section: "REVENUE",
      message: `Milestone block not found in "${fileName}" — the Revenue Tracking / milestone block (Milestone / Invoice / Date / Amount / Received) could not be located by header signature in any sheet. Map it manually before committing; it has NOT been skipped silently.`,
      suggestedAction:
        "Open the tracker and confirm a Revenue Tracking / milestone block exists, then map its sheet/columns. If this tracker genuinely has no milestone block, acknowledge the flag to proceed.",
      issueType: "milestone_block_not_found",
      issueFingerprint: `milestone_block_not_found:${fileName}`,
      payloadJson: { fileName, missingSections: detection.missingSections },
    });
  }

  // FLAG, NEVER SKIP: a plan that captured the expected-% column but NOT the
  // actual-% ("Status") column would silently import every task at 0% actual
  // (pct_complete defaults to 0), making a real schedule look like no progress.
  // A stale learned mapping or an unrecognised "Status" header can cause this
  // (pct_complete is not a required field, so it slips through). Surface it so
  // the operator maps the Status column instead of shipping zeros.
  const planMappingIdx = detection.sections.findIndex(s => s.section === "PLAN");
  if (planMappingIdx >= 0 && planActualPctGap(mappings[planMappingIdx])) {
    normalization.issues.push({
      severity: "WARNING",
      section: "PLAN",
      message: `Actual-progress column not mapped in "${fileName}" — the plan's "Status" (% complete) column was not recognised, so every task would import at 0% actual while the expected % imported fine. Map the actual-% / "Status" column before committing.`,
      suggestedAction: `In the column-mapping step map the plan's "Status" (or actual %) column to "% complete". A previously-learned mapping for this file may be binding "Status" to the wrong field — re-mapping here corrects it for future imports too.`,
      issueType: "plan_actual_pct_not_mapped",
      issueFingerprint: `plan_actual_pct_not_mapped:${fileName}`,
      payloadJson: { fileName, mappedFields: mappings[planMappingIdx].mappings.map(m => m.canonicalField) },
    });
  }

  const hasBlockers = normalization.issues.some(i => i.severity === "BLOCKER");
  const lowConfidence = mappings.some(m => m.overallConfidence < 0.7);
  const needsReview = hasBlockers || lowConfidence || normalization.issues.length > 0;

  return { detection, mappings, normalization, hasBlockers, needsReview };
}

export { type DetectedSection, type DetectionResult, type LayoutVariant } from "./detector";
export { type ColumnMapping, type MappingResult } from "./mapper";
export { type NormalizationResult } from "./normalizer";

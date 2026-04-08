/**
 * Smart Import v2 — Row Matcher
 *
 * Generates stable business keys for incoming and existing rows,
 * then matches them to produce row-level diff classifications.
 *
 * Row identity strategy (hardened from spec):
 *
 * PLAN:
 *   Primary:  projectId + subProjectName + taskNo
 *   Fallback: projectId + subProjectName + norm(taskName) + norm(phase)
 *
 * REVENUE:
 *   Primary:  projectId + subProjectName + milestoneNo  (NOT available from normalizer — see notes)
 *   Fallback: projectId + subProjectName + norm(milestoneName)
 *   Amount is compared as a field, never part of identity.
 *
 * EXPENDITURE:
 *   Primary:  projectId + invoiceNumber (when invoiceNumber exists and is non-empty)
 *   Fallback: projectId + subProjectName + norm(costCategory) + norm(counterpartyName) + norm(description)
 *   Budget and amount are compared as fields, never part of identity.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";
export type RowClassification = "NEW" | "CHANGED" | "UNCHANGED" | "MISSING_FROM_UPLOAD" | "CONFLICT_PLACEHOLDER";

export interface BusinessKey {
  /** The composite key string used for matching */
  key: string;
  /** Which key strategy was used */
  keyType: "PRIMARY" | "FALLBACK";
  /** Confidence in match quality */
  matchConfidence: MatchConfidence;
  /** Human-readable label for the row */
  rowLabel: string;
}

export interface MatchedRow<TFile = Record<string, any>, TExisting = Record<string, any>> {
  classification: RowClassification;
  businessKey: BusinessKey;
  /** Incoming row from the file (null for MISSING_FROM_UPLOAD) */
  fileRow: TFile | null;
  /** Index in the file's normalized array */
  fileIndex: number | null;
  /** Existing DB row (null for NEW) */
  existingRow: TExisting | null;
  /** Existing row DB id (null for NEW) */
  existingRowId: number | null;
  /** Fields that changed (only for CHANGED classification) */
  changedFields: ChangedField[];
  /** Planner warnings for this row */
  warnings: string[];
}

export interface ChangedField {
  fieldName: string;
  existingValue: string | null;
  fileValue: string | null;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Normalize a string for key comparison: lowercase, trim, collapse whitespace */
function norm(val: string | null | undefined): string {
  if (!val) return "";
  return val.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Build a composite key from parts, joining with "|" */
function compositeKey(...parts: string[]): string {
  return parts.join("|");
}

// ---------------------------------------------------------------------------
// PLAN key generation
// ---------------------------------------------------------------------------

export function planBusinessKey(
  projectId: number,
  row: { taskNo?: string | null; taskName: string; phase?: string | null; subProjectName?: string | null },
): BusinessKey {
  const sub = norm(row.subProjectName);

  // Primary: projectId + subProjectName + taskNo
  if (row.taskNo && row.taskNo.trim()) {
    return {
      key: compositeKey(String(projectId), sub, norm(row.taskNo)),
      keyType: "PRIMARY",
      matchConfidence: "HIGH",
      rowLabel: row.taskName || row.taskNo,
    };
  }

  // Fallback: projectId + subProjectName + norm(taskName) + norm(phase)
  const taskNameNorm = norm(row.taskName);
  if (!taskNameNorm) {
    return {
      key: compositeKey(String(projectId), sub, `__empty_task_${Math.random().toString(36).slice(2, 10)}`),
      keyType: "FALLBACK",
      matchConfidence: "LOW",
      rowLabel: "(empty task name)",
    };
  }

  return {
    key: compositeKey(String(projectId), sub, taskNameNorm, norm(row.phase)),
    keyType: "FALLBACK",
    matchConfidence: "LOW",
    rowLabel: row.taskName,
  };
}

// ---------------------------------------------------------------------------
// REVENUE key generation
// ---------------------------------------------------------------------------

export function revenueBusinessKey(
  projectId: number,
  row: {
    milestoneNo?: string | null;
    milestoneName?: string | null;
    description?: string | null;
    subProjectName?: string | null;
  },
): BusinessKey {
  const sub = norm(row.subProjectName);

  // The canonical table (normalizedRevenueLines) does NOT store milestoneNo,
  // so we cannot use it as the matching key when comparing file vs DB.
  // We always key on milestoneName for matching, but we upgrade confidence
  // to HIGH when milestoneNo is also available on the file row (proves the
  // milestone has a stable numeric identifier in the tracker).

  const hasMilestoneNo = !!(row.milestoneNo && row.milestoneNo.trim());

  const name = norm(row.milestoneName) || norm(row.description);
  if (!name) {
    return {
      key: compositeKey(String(projectId), sub, `__empty_rev_${Math.random().toString(36).slice(2, 10)}`),
      keyType: "FALLBACK",
      matchConfidence: "LOW",
      rowLabel: "(empty milestone name)",
    };
  }

  return {
    key: compositeKey(String(projectId), sub, name),
    keyType: hasMilestoneNo ? "PRIMARY" : "FALLBACK",
    matchConfidence: hasMilestoneNo ? "HIGH" : "MEDIUM",
    rowLabel: row.milestoneName || row.description || "",
  };
}

// ---------------------------------------------------------------------------
// EXPENDITURE key generation
// ---------------------------------------------------------------------------

export function expenditureBusinessKey(
  projectId: number,
  row: {
    invoiceNumber?: string | null;
    costCategory?: string | null;
    counterpartyName?: string | null;
    description?: string | null;
    subProjectName?: string | null;
  },
): BusinessKey {
  const sub = norm(row.subProjectName);

  // Primary: projectId + invoiceNumber (when non-empty)
  const inv = row.invoiceNumber?.trim();
  if (inv) {
    return {
      key: compositeKey(String(projectId), norm(inv)),
      keyType: "PRIMARY",
      matchConfidence: "HIGH",
      rowLabel: row.description || row.invoiceNumber || "",
    };
  }

  // Fallback: projectId + subProjectName + norm(costCategory) + norm(counterpartyName) + norm(description)
  const cat = norm(row.costCategory);
  const cp = norm(row.counterpartyName);
  const desc = norm(row.description);

  // Assess confidence based on how many fallback fields are populated
  const populatedCount = [cat, cp, desc].filter(Boolean).length;
  let confidence: MatchConfidence;
  if (populatedCount >= 3) {
    confidence = "MEDIUM";
  } else if (populatedCount >= 2) {
    confidence = "MEDIUM";
  } else {
    confidence = "LOW";
  }

  if (!desc && !cat && !cp) {
    return {
      key: compositeKey(String(projectId), sub, `__empty_cost_${Math.random().toString(36).slice(2, 10)}`),
      keyType: "FALLBACK",
      matchConfidence: "LOW",
      rowLabel: "(empty cost line)",
    };
  }

  return {
    key: compositeKey(String(projectId), sub, cat, cp, desc),
    keyType: "FALLBACK",
    matchConfidence: confidence,
    rowLabel: row.description || row.costCategory || "",
  };
}

// ---------------------------------------------------------------------------
// Field comparison helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a value for comparison.
 * Treats null, undefined, empty string, false, and 0 as equivalent empty values
 * to avoid false positives when comparing file vs DB rows.
 */
function normalizeForCompare(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "true" : "";
  if (typeof val === "number") return val === 0 ? "" : String(val);
  const s = String(val).trim();
  return s === "0" ? "" : s;
}

/** Compare two rows field-by-field, ignoring import metadata fields */
export function compareFields(
  fileRow: Record<string, any>,
  existingRow: Record<string, any>,
  compareFieldNames: string[],
): ChangedField[] {
  const changed: ChangedField[] = [];
  for (const field of compareFieldNames) {
    const fileVal = normalizeForCompare(fileRow[field]);
    const existingVal = normalizeForCompare(existingRow[field]);
    if (fileVal !== existingVal) {
      changed.push({
        fieldName: field,
        existingValue: existingVal || null,
        fileValue: fileVal || null,
      });
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Fields to compare per section (excluding identity and metadata fields)
// ---------------------------------------------------------------------------

export const PLAN_COMPARE_FIELDS = [
  "startDate", "endDate", "durationDays",
  "actualStartDate", "actualEndDate", "actualDurationDays",
  "owner", "status", "pctComplete", "expectedPctComplete",
  "comment", "isMilestone", "parentTaskNo",
];

export const REVENUE_COMPARE_FIELDS = [
  "amountExVat", "vat", "milestonePercent", "invoiceNumber", "invoiceDate",
  "expectedPaymentDate", "paidDate", "inBankDate", "status",
];

export const EXPENDITURE_COMPARE_FIELDS = [
  "amountExVat", "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
  "invoiceNumber", "invoiceDate", "approvedDate", "paidDate",
  "forecastPaymentDate", "poNumber", "costCategory", "status",
  "counterpartyName", "revenueRecognitionAmount",
];

// ---------------------------------------------------------------------------
// Main matching function
// ---------------------------------------------------------------------------

export type SectionType = "PLAN" | "REVENUE" | "EXPENDITURE";

/**
 * Match incoming file rows against existing DB rows and classify each row.
 *
 * @param section - Which section we're matching
 * @param projectId - The target project ID
 * @param fileRows - Normalized rows from the uploaded file
 * @param existingRows - Current active rows from the DB (effectiveTo IS NULL)
 * @returns Array of matched rows with classifications
 */
export function matchRows(
  section: SectionType,
  projectId: number,
  fileRows: Record<string, any>[],
  existingRows: Array<Record<string, any> & { id: number }>,
): MatchedRow[] {
  const results: MatchedRow[] = [];

  // Generate business keys for existing DB rows
  const existingByKey = new Map<string, Record<string, any> & { id: number }>();
  const existingKeyInfoMap = new Map<number, BusinessKey>();
  for (const row of existingRows) {
    const bk = generateBusinessKey(section, projectId, row);
    existingByKey.set(bk.key, row);
    existingKeyInfoMap.set(row.id, bk);
  }

  // Track which existing rows were matched
  const matchedExistingKeys = new Set<string>();

  // Pick the right compare fields for this section
  const compareFields_ = section === "PLAN" ? PLAN_COMPARE_FIELDS
    : section === "REVENUE" ? REVENUE_COMPARE_FIELDS
    : EXPENDITURE_COMPARE_FIELDS;

  // Process each file row
  for (let i = 0; i < fileRows.length; i++) {
    const fileRow = fileRows[i];
    const fileBk = generateBusinessKey(section, projectId, fileRow);
    const warnings: string[] = [];

    if (fileBk.matchConfidence === "LOW") {
      warnings.push(`Row "${fileBk.rowLabel}": matched using ${fileBk.keyType} key with LOW confidence. Verify identity is correct.`);
    }

    const existing = existingByKey.get(fileBk.key);
    if (existing) {
      matchedExistingKeys.add(fileBk.key);
      // Matched — determine if CHANGED or UNCHANGED
      const changed = compareFields(fileRow, existing, compareFields_);
      if (changed.length > 0) {
        results.push({
          classification: "CHANGED",
          businessKey: fileBk,
          fileRow,
          fileIndex: i,
          existingRow: existing,
          existingRowId: existing.id,
          changedFields: changed,
          warnings,
        });
      } else {
        results.push({
          classification: "UNCHANGED",
          businessKey: fileBk,
          fileRow,
          fileIndex: i,
          existingRow: existing,
          existingRowId: existing.id,
          changedFields: [],
          warnings,
        });
      }
    } else {
      // No match — NEW row
      results.push({
        classification: "NEW",
        businessKey: fileBk,
        fileRow,
        fileIndex: i,
        existingRow: null,
        existingRowId: null,
        changedFields: [],
        warnings,
      });
    }
  }

  // Find existing rows that were NOT matched → MISSING_FROM_UPLOAD
  for (const row of existingRows) {
    const bk = existingKeyInfoMap.get(row.id)!;
    if (!matchedExistingKeys.has(bk.key)) {
      results.push({
        classification: "MISSING_FROM_UPLOAD",
        businessKey: bk,
        fileRow: null,
        fileIndex: null,
        existingRow: row,
        existingRowId: row.id,
        changedFields: [],
        warnings: [],
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Key dispatch
// ---------------------------------------------------------------------------

export function generateBusinessKey(section: SectionType, projectId: number, row: Record<string, any>): BusinessKey {
  switch (section) {
    case "PLAN":
      return planBusinessKey(projectId, row as any);
    case "REVENUE":
      return revenueBusinessKey(projectId, row as any);
    case "EXPENDITURE":
      return expenditureBusinessKey(projectId, row as any);
  }
}

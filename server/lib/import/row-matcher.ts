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

import { normalizeWithFieldType, normalizeBasic } from "./value-normalization";

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
  /**
   * Unique-within-section identifier for this matched row. Stable across
   * preview → commit calls for the same file/DB state. For singletons equals
   * `businessKey.key`; for members of a duplicate-key group it is
   * disambiguated with `#pk<existingId>` (paired rows) or
   * `#new-<ordinal>` (unmatched NEW rows). Optional for backwards-compat
   * with hand-built test literals — consumers should fall back to
   * `businessKey.key` when absent.
   */
  rowUid?: string;
  /**
   * PLAN-only: the canonical external_ref value the executor should write to
   * `work_items.external_ref` for this row. Encodes project, section and
   * rowUid. Absent for REVENUE/EXPENDITURE (they are temporal and do not use
   * external_ref) and for legacy test fixtures.
   */
  canonicalExternalRef?: string;
  /**
   * True when the matcher detected more than one row on the file side
   * and/or DB side sharing the same business key. Surfaced to callers so
   * previews can warn the user that similarity pairing was applied.
   */
  inDuplicateGroup?: boolean;
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
 *
 * When a field name is supplied this delegates to the field-aware
 * normaliser, which adds numeric tolerance (|a−b| < 0.005 on Rand /
 * quantity / pct fields) and date-only normalisation (YYYY-MM-DD,
 * dropping time-of-day and timezone). Without a field name it falls
 * back to the legacy "treat null/undefined/0/blank as equivalent"
 * behaviour so the duplicate-group similarity scorer is unaffected.
 */
function normalizeForCompare(val: any, fieldName?: string): string {
  return fieldName
    ? normalizeWithFieldType(val, fieldName)
    : normalizeBasic(val);
}

/** Compare two rows field-by-field, ignoring import metadata fields */
export function compareFields(
  fileRow: Record<string, any>,
  existingRow: Record<string, any>,
  compareFieldNames: string[],
): ChangedField[] {
  const changed: ChangedField[] = [];
  for (const field of compareFieldNames) {
    const fileVal = normalizeForCompare(fileRow[field], field);
    const existingVal = normalizeForCompare(existingRow[field], field);
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

// 2026-05-07 — narrowed to align with the diff contract
// (`shared/excel-vs-app/contract.ts`). The conflict engine and
// the executor merge engine now operate on the same set of fields,
// so the planner cannot surface a conflict the executor wouldn't
// also produce, and vice-versa. See contract.ts for the rationale
// (dates, amounts, date-colour-confirmed flags only).

export const PLAN_COMPARE_FIELDS = [
  // Plan section uses normalizer field names (not work_items column
  // names); these map to the contract's tracked fields:
  //   normalizer.startDate / endDate / durationDays         → planned source
  //   normalizer.actualStartDate / actualEndDate / actualDurationDays → actual source
  // Both sides of the executor's `actual ?? planned` precedence flow
  // through these inputs, so changes to either trigger a diff.
  "startDate", "endDate", "durationDays",
  "actualStartDate", "actualEndDate", "actualDurationDays",
];

export const REVENUE_COMPARE_FIELDS = [
  // Amounts.
  "amountExVat", "vat",
  // Dates.
  "invoiceDate", "expectedPaymentDate", "paidDate", "inBankDate",
  // Date-colour signal: black = confirmed/realised, red = unconfirmed.
  "invoiceDateConfirmed", "paidDateConfirmed",
];

export const EXPENDITURE_COMPARE_FIELDS = [
  // Amounts.
  "amountExVat", "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
  "actualQty", "actualRate", "revenueRecognitionAmount",
  // Dates.
  "invoiceDate", "approvedDate", "paidDate", "forecastPaymentDate",
  // Date-colour signal: black = confirmed/realised, red = unconfirmed.
  "invoiceDateConfirmed", "paidDateConfirmed", "cosRealised", "cashflowConfirmed",
];

// ---------------------------------------------------------------------------
// Main matching function
// ---------------------------------------------------------------------------

export type SectionType = "PLAN" | "REVENUE" | "EXPENDITURE";

interface FileEntry {
  row: Record<string, any>;
  bk: BusinessKey;
  fileIndex: number;
  warnings: string[];
}

interface DbEntry {
  row: Record<string, any> & { id: number };
  bk: BusinessKey;
}

/**
 * Similarity fields used when pairing members of a duplicate-business-key
 * group. Each exact-equal field contributes one point to the pair score.
 * The greedy pair-off picks highest-scoring pairs first, so the chosen
 * pairing is the one that preserves as much content identity as possible.
 */
const SIMILARITY_FIELDS: Record<SectionType, string[]> = {
  PLAN: ["taskName", "startDate", "endDate", "durationDays", "owner", "sourceRow"],
  REVENUE: ["milestoneName", "description", "amountExVat", "invoiceNumber", "invoiceDate", "sourceRow"],
  EXPENDITURE: ["description", "costCategory", "counterpartyName", "amountExVat", "invoiceNumber", "invoiceDate", "poNumber", "sourceRow"],
};

function similarityScore(
  section: SectionType,
  fileRow: Record<string, any>,
  dbRow: Record<string, any>,
): number {
  let score = 0;
  for (const field of SIMILARITY_FIELDS[section]) {
    const a = normalizeForCompare(fileRow[field]);
    const b = normalizeForCompare(dbRow[field]);
    if (a !== "" && a === b) score += 1;
  }
  return score;
}

/**
 * Extract the `#pk<id>` suffix from an existing external_ref, if any.
 * Used as a strong identity hint: a DB row that already carries
 * `...#pk123` should pair preferentially with the file row currently at
 * that slot (even if pure content similarity ties with another).
 */
function extractPkSuffix(externalRef: string | null | undefined): number | null {
  if (!externalRef) return null;
  const m = /#pk(\d+)(?:#|$)/.exec(externalRef);
  return m ? Number(m[1]) : null;
}

/**
 * Deterministically pair N file entries with M DB entries that all share
 * the same business key. Uses a greedy highest-score-first match:
 *
 *   1. Compute similarity score for every (file, db) pair.
 *   2. Bonus-boost pairs whose DB row's existing external_ref already
 *      encodes a `#pk<dbId>` matching its own id (these should remain
 *      stable).
 *   3. Repeatedly pick the highest-scoring pair, remove both from
 *      consideration, until one side is exhausted.
 *   4. Surplus file entries → NEW; surplus db entries → MISSING_FROM_UPLOAD.
 *
 * This is O((N*M)^2) which is fine for the duplicate-group sizes we see in
 * real project trackers (typically 2–10 rows per group).
 */
function pairDuplicateGroup(
  section: SectionType,
  files: FileEntry[],
  dbs: DbEntry[],
): { pairs: Array<{ file: FileEntry; db: DbEntry }>; unpairedFiles: FileEntry[]; unpairedDbs: DbEntry[] } {
  const pairs: Array<{ file: FileEntry; db: DbEntry }> = [];
  const remainingFiles = [...files];
  const remainingDbs = [...dbs];

  while (remainingFiles.length > 0 && remainingDbs.length > 0) {
    let bestScore = -1;
    let bestFileIdx = -1;
    let bestDbIdx = -1;

    for (let i = 0; i < remainingFiles.length; i++) {
      for (let j = 0; j < remainingDbs.length; j++) {
        const f = remainingFiles[i];
        const d = remainingDbs[j];
        let score = similarityScore(section, f.row, d.row);
        // Identity-preservation bonus: if the DB row's current external_ref
        // already stamps it with a #pk suffix equal to its own id, prefer
        // matching it to a file row in the same ordinal slot within the
        // group. This preserves stable identity across commits.
        const pkFromRef = extractPkSuffix((d.row as any).externalRef);
        if (pkFromRef != null && pkFromRef === d.row.id) {
          score += 0.5;
        }
        if (score > bestScore) {
          bestScore = score;
          bestFileIdx = i;
          bestDbIdx = j;
        }
      }
    }

    // Tie-breaker when no field matched (bestScore === 0): pair by position
    // within the remaining arrays so the result is still deterministic.
    const [fileEntry] = remainingFiles.splice(bestFileIdx, 1);
    const [dbEntry] = remainingDbs.splice(bestDbIdx, 1);
    pairs.push({ file: fileEntry, db: dbEntry });
  }

  return { pairs, unpairedFiles: remainingFiles, unpairedDbs: remainingDbs };
}

/**
 * Slugify a sheet/tab name for use inside external_ref. Lower-case,
 * whitespace-and-slash collapsed to dashes, restricted to a-z0-9_-, capped
 * at 40 chars. Empty input falls back to "sheet".
 */
export function slugifySheetName(name: string | null | undefined): string {
  const s = (name ?? "").toString().trim().toLowerCase()
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 40) || "sheet";
}

/**
 * Build the NEW-shape canonical external_ref for a PLAN row from its
 * workbook coordinates. Format:
 *
 *     PID-{projectId}::PLAN::{sheetSlug}::R{sourceRow}::{outline||'M'}
 *
 * Uniqueness is by construction: a workbook row exists at exactly one
 * (sheet, sourceRow) coordinate, so two distinct rows in the same upload
 * cannot collide. The trailing outline segment carries the WBS code (or
 * 'M' for milestones) so the ref remains human-readable.
 */
export function buildNewPlanExternalRef(
  projectId: number,
  row: {
    sourceSheet?: string | null;
    sourceRow?: number | string | null;
    outlineNumber?: string | null;
    taskNo?: string | null;
    isMilestone?: boolean | null;
  },
): string {
  const slug = slugifySheetName(row.sourceSheet);
  const srRaw = row.sourceRow;
  const sourceRow = srRaw != null && String(srRaw).trim() ? String(srRaw).trim() : "X";
  const outlineSrc = (row.outlineNumber != null && String(row.outlineNumber).trim())
    ? String(row.outlineNumber).trim()
    : (row.taskNo != null && String(row.taskNo).trim() ? String(row.taskNo).trim() : "");
  const outline = outlineSrc || (row.isMilestone ? "M" : "M");
  // Sanitise outline against `::` injection.
  const safeOutline = outline.replace(/::/g, ":_").slice(0, 60);
  return `PID-${projectId}::PLAN::${slug}::R${sourceRow}::${safeOutline}`;
}

/**
 * Build the LEGACY-shape canonical external_ref (pre-S001). Used for
 * back-compat lookup so the matcher can still find rows imported under
 * the old key shape. Kept here so the migration path is documented in
 * one place.
 */
export function buildLegacyPlanExternalRef(projectId: number, rowUid: string): string {
  return `PID-${projectId}::PLAN::BK::${rowUid}`;
}

function buildCanonicalExternalRef(
  section: SectionType,
  projectId: number,
  rowUid: string,
  /**
   * When provided (and section=PLAN), the new-shape ref is built from the
   * row's workbook coordinates. When omitted, the legacy BK-rowUid shape
   * is returned so existing test fixtures and edge code paths (e.g. db-only
   * MISSING_FROM_UPLOAD without a source_sheet stored) continue to work.
   */
  row?: Record<string, any> | null,
): string | undefined {
  // Only PLAN uses work_items.external_ref for identity. REVENUE and
  // EXPENDITURE are temporal tables with their own id columns.
  if (section !== "PLAN") return undefined;
  if (row && (row.sourceSheet || row.sourceRow != null)) {
    return buildNewPlanExternalRef(projectId, row as any);
  }
  return buildLegacyPlanExternalRef(projectId, rowUid);
}

/**
 * Match incoming file rows against existing DB rows and classify each row.
 *
 * Duplicate-business-key rows on either side are paired via content
 * similarity (see `pairDuplicateGroup`). Each emitted MatchedRow carries a
 * unique-within-section `rowUid` used by the conflict engine and commit
 * executor so duplicates stay addressable end-to-end.
 *
 * @param section - Which section we're matching
 * @param projectId - The target project ID
 * @param fileRows - Normalized rows from the uploaded file
 * @param existingRows - Current active rows from the DB (effectiveTo IS NULL)
 * @returns Array of matched rows with classifications, in a stable order
 */
export function matchRows(
  section: SectionType,
  projectId: number,
  fileRows: Record<string, any>[],
  existingRows: Array<Record<string, any> & { id: number }>,
): MatchedRow[] {
  // Bucket file entries by business key (preserves file order within group).
  const fileEntries: FileEntry[] = new Array(fileRows.length);
  const fileBuckets = new Map<string, FileEntry[]>();
  for (let i = 0; i < fileRows.length; i++) {
    const row = fileRows[i];
    const bk = generateBusinessKey(section, projectId, row);
    const warnings: string[] = [];
    if (bk.matchConfidence === "LOW") {
      warnings.push(`Row "${bk.rowLabel}": matched using ${bk.keyType} key with LOW confidence. Verify identity is correct.`);
    }
    const entry: FileEntry = { row, bk, fileIndex: i, warnings };
    fileEntries[i] = entry;
    if (!fileBuckets.has(bk.key)) fileBuckets.set(bk.key, []);
    fileBuckets.get(bk.key)!.push(entry);
  }

  // Bucket DB entries by business key (preserves db id order within group).
  const dbBuckets = new Map<string, DbEntry[]>();
  const dbSorted = [...existingRows].sort((a, b) => a.id - b.id);
  for (const row of dbSorted) {
    const bk = generateBusinessKey(section, projectId, row);
    const entry: DbEntry = { row, bk };
    if (!dbBuckets.has(bk.key)) dbBuckets.set(bk.key, []);
    dbBuckets.get(bk.key)!.push(entry);
  }

  const compareFields_ = section === "PLAN" ? PLAN_COMPARE_FIELDS
    : section === "REVENUE" ? REVENUE_COMPARE_FIELDS
    : EXPENDITURE_COMPARE_FIELDS;

  const results: MatchedRow[] = [];

  // Emit matches preserving file-order-first for incoming rows: we walk the
  // original fileRows once and look up the entry within its bucket. This
  // keeps the output stable and readable for debugging.
  const emittedFileIdxs = new Set<number>();
  const emittedDbIds = new Set<number>();
  // Track the pairing decision for each (fileIndex → DbEntry|null) and
  // for each (dbId → FileEntry|null).
  const fileIdxToDb = new Map<number, DbEntry | null>();
  const dbIdToFile = new Map<number, FileEntry | null>();
  const groupSizeByKey = new Map<string, { files: number; dbs: number }>();

  // ── S001 dual-key pre-pass (PLAN-only) ──
  // Bucket DB rows by their stored external_ref so we can pair a file row
  // directly to its DB counterpart whenever either:
  //   (a) the DB row already carries the NEW-shape ref the file row would
  //       generate (matching re-import — typical steady-state), OR
  //   (b) the DB row carries the LEGACY-shape ref derived from the file
  //       row's business key (first re-import after S001 ships — silent
  //       migration; the executor will rewrite to the new shape).
  // Pairs locked here are removed from the per-businessKey bucketing
  // below so they don't get re-paired or accidentally trigger
  // duplicate-group similarity matching.
  const dbByExternalRef = new Map<string, DbEntry>();
  const lockedFileIdxs = new Set<number>();
  const lockedDbIds = new Set<number>();
  if (section === "PLAN") {
    for (const row of dbSorted) {
      const ref = (row as any).externalRef;
      if (typeof ref === "string" && ref.length > 0 && !dbByExternalRef.has(ref)) {
        dbByExternalRef.set(ref, { row, bk: generateBusinessKey(section, projectId, row) });
      }
    }
    for (let i = 0; i < fileRows.length; i++) {
      const fileRow = fileRows[i];
      const newRef = buildNewPlanExternalRef(projectId, fileRow as any);
      const viaNew = dbByExternalRef.get(newRef);
      if (viaNew && !lockedDbIds.has(viaNew.row.id)) {
        fileIdxToDb.set(i, viaNew);
        dbIdToFile.set(viaNew.row.id, fileEntries[i]);
        lockedFileIdxs.add(i);
        lockedDbIds.add(viaNew.row.id);
        continue;
      }
      // Legacy-shape probe — the bare business-key ref is the most common
      // legacy form. Duplicate-group variants (`#pk{id}`, `#new-{idx}`)
      // require the DB id which is exactly what the lookup gives us, so a
      // direct match here is sufficient.
      const bkKey = fileEntries[i].bk.key;
      const legacyRef = buildLegacyPlanExternalRef(projectId, bkKey);
      const viaLegacy = dbByExternalRef.get(legacyRef);
      if (viaLegacy && !lockedDbIds.has(viaLegacy.row.id)) {
        fileIdxToDb.set(i, viaLegacy);
        dbIdToFile.set(viaLegacy.row.id, fileEntries[i]);
        lockedFileIdxs.add(i);
        lockedDbIds.add(viaLegacy.row.id);
      }
    }
  }

  // Run pairing per key group up front so we can compute rowUids
  // deterministically. Pre-locked pairs are filtered out so they don't
  // get re-considered.
  const allKeys = new Set<string>([...fileBuckets.keys(), ...dbBuckets.keys()]);
  for (const key of allKeys) {
    const files = (fileBuckets.get(key) ?? []).filter(f => !lockedFileIdxs.has(f.fileIndex));
    const dbs = (dbBuckets.get(key) ?? []).filter(d => !lockedDbIds.has(d.row.id));
    // groupSize uses the ORIGINAL bucket sizes so duplicate-group flagging
    // remains accurate even when some rows were locked by the pre-pass.
    const origFiles = fileBuckets.get(key)?.length ?? 0;
    const origDbs = dbBuckets.get(key)?.length ?? 0;
    groupSizeByKey.set(key, { files: origFiles, dbs: origDbs });

    if (files.length === 0 && dbs.length === 0) continue;

    if (files.length <= 1 && dbs.length <= 1) {
      // Trivial case: 0 or 1 on each side.
      const f = files[0] ?? null;
      const d = dbs[0] ?? null;
      if (f) fileIdxToDb.set(f.fileIndex, d);
      if (d) dbIdToFile.set(d.row.id, f);
      continue;
    }

    // Duplicate group — pair by similarity.
    const { pairs, unpairedFiles, unpairedDbs } = pairDuplicateGroup(section, files, dbs);
    for (const { file, db } of pairs) {
      fileIdxToDb.set(file.fileIndex, db);
      dbIdToFile.set(db.row.id, file);
    }
    for (const f of unpairedFiles) fileIdxToDb.set(f.fileIndex, null);
    for (const d of unpairedDbs) dbIdToFile.set(d.row.id, null);
  }

  // Helper: build rowUid + canonicalExternalRef for a matched or new row.
  // For singleton groups the rowUid equals the bare business key. For
  // members of a duplicate group we suffix with `#pk<existingId>` (when
  // paired to a DB row) or `#new-<fileIndex>` (when a NEW insert).
  //
  // The optional `sourceRow` parameter (the workbook row data — file row
  // when present, else DB row) is forwarded to `buildCanonicalExternalRef`
  // so PLAN refs use the new (sheet, sourceRow, outline) shape. Without
  // it we fall back to the legacy BK-rowUid shape.
  function assignRowUid(opts: {
    bkKey: string;
    existingId: number | null;
    fileIndex: number | null;
    inDuplicateGroup: boolean;
    sourceRow?: Record<string, any> | null;
  }): { rowUid: string; canonicalExternalRef: string | undefined } {
    const { bkKey, existingId, fileIndex, inDuplicateGroup, sourceRow } = opts;
    let rowUid: string;
    if (!inDuplicateGroup) {
      rowUid = bkKey;
    } else if (existingId != null) {
      rowUid = `${bkKey}#pk${existingId}`;
    } else {
      rowUid = `${bkKey}#new-${fileIndex ?? "x"}`;
    }
    return { rowUid, canonicalExternalRef: buildCanonicalExternalRef(section, projectId, rowUid, sourceRow ?? null) };
  }

  // Walk file rows in original order so output matches source ordering.
  for (let i = 0; i < fileRows.length; i++) {
    const entry = fileEntries[i];
    if (!entry) continue; // defensive — should always exist
    emittedFileIdxs.add(i);

    const db = fileIdxToDb.get(i) ?? null;
    const groupSize = groupSizeByKey.get(entry.bk.key) ?? { files: 0, dbs: 0 };
    const inDuplicateGroup = groupSize.files > 1 || groupSize.dbs > 1;

    if (db) {
      emittedDbIds.add(db.row.id);
      const changed = compareFields(entry.row, db.row, compareFields_);
      const { rowUid, canonicalExternalRef } = assignRowUid({
        bkKey: entry.bk.key,
        existingId: db.row.id,
        fileIndex: i,
        inDuplicateGroup,
        sourceRow: entry.row,
      });
      results.push({
        classification: changed.length > 0 ? "CHANGED" : "UNCHANGED",
        businessKey: entry.bk,
        fileRow: entry.row,
        fileIndex: i,
        existingRow: db.row,
        existingRowId: db.row.id,
        changedFields: changed,
        warnings: entry.warnings,
        rowUid,
        canonicalExternalRef,
        inDuplicateGroup,
      });
    } else {
      const { rowUid, canonicalExternalRef } = assignRowUid({
        bkKey: entry.bk.key,
        existingId: null,
        fileIndex: i,
        inDuplicateGroup,
        sourceRow: entry.row,
      });
      results.push({
        classification: "NEW",
        businessKey: entry.bk,
        fileRow: entry.row,
        fileIndex: i,
        existingRow: null,
        existingRowId: null,
        changedFields: [],
        warnings: entry.warnings,
        rowUid,
        canonicalExternalRef,
        inDuplicateGroup,
      });
    }
  }

  // Emit DB-only rows (MISSING_FROM_UPLOAD) — preserve db id order for
  // determinism. (Post-pass uniqueness sweep is appended after this loop.)
  for (const row of dbSorted) {
    if (emittedDbIds.has(row.id)) continue;
    // Skip if this DB row was paired to a file entry that we already
    // emitted above (covered by emittedDbIds). If we got here the DB row
    // was not paired.
    const bk = generateBusinessKey(section, projectId, row);
    const groupSize = groupSizeByKey.get(bk.key) ?? { files: 0, dbs: 0 };
    const inDuplicateGroup = groupSize.files > 1 || groupSize.dbs > 1;
    const { rowUid, canonicalExternalRef } = (function () {
      if (!inDuplicateGroup) {
        return {
          rowUid: bk.key,
          canonicalExternalRef: buildCanonicalExternalRef(section, projectId, bk.key, row),
        };
      }
      const uid = `${bk.key}#pk${row.id}`;
      return {
        rowUid: uid,
        canonicalExternalRef: buildCanonicalExternalRef(section, projectId, uid, row),
      };
    })();
    results.push({
      classification: "MISSING_FROM_UPLOAD",
      businessKey: bk,
      fileRow: null,
      fileIndex: null,
      existingRow: row,
      existingRowId: row.id,
      changedFields: [],
      warnings: [],
      rowUid,
      canonicalExternalRef,
      inDuplicateGroup,
    });
  }

  // ── PLAN-only uniqueness post-pass ──
  // The duplicate-group pairing above handles the common case where two file
  // rows share a business key. It does NOT handle the harder drift case where
  // a NEW file row's canonical external_ref happens to collide with a DB row
  // already present that the matcher paired to a *different* file row (legacy
  // ref drift, normalization rule changes between imports, etc.). Without
  // disambiguation, the executor would either silently overwrite the wrong
  // row or hit a unique-constraint violation and abort the whole sheet.
  //
  // This sweep enforces that every emitted `canonicalExternalRef` is unique
  // *within* the result set AND does not collide with a DB row's existing
  // `externalRef` that wasn't paired with the same row. Disambiguators are
  // deterministic across re-imports:
  //   - file rows  → `#row{sourceRow}`  (workbook row number, stable)
  //   - DB rows    → `#pk{id}`          (DB primary key, stable)
  if (section === "PLAN") {
    // Build a set of all DB external_refs (excluding ones already paired to
    // a result row whose canonical ref equals the existing ref — those are
    // legitimate updates-in-place). For paired rows whose canonical ref
    // differs from the existing ref, the existing ref is "owned" by another
    // identity and must not be overwritten by an unrelated NEW insert.
    const dbRefOwners = new Map<string, number>(); // externalRef → owner DB id
    for (const dbRow of existingRows) {
      const ref = (dbRow as any).externalRef;
      if (typeof ref === "string" && ref.length > 0) dbRefOwners.set(ref, dbRow.id);
    }

    // For each result, if its canonical ref points at a DB row that ISN'T
    // this result's own existingRowId, we have a drift collision.
    const seenRefs = new Map<string, MatchedRow>(); // canonical ref → first owner
    for (const r of results) {
      if (!r.canonicalExternalRef) continue;
      let candidate = r.canonicalExternalRef;
      let candidateUid = r.rowUid ?? r.businessKey.key;

      const ownerId = dbRefOwners.get(candidate);
      const driftCollision = ownerId != null && ownerId !== r.existingRowId;
      const intraResultCollision = seenRefs.has(candidate);

      if (driftCollision || intraResultCollision) {
        const sourceRow = (r.fileRow as any)?.sourceRow;
        const suffix = r.existingRowId != null
          ? `#pk${r.existingRowId}`
          : `#row${sourceRow ?? r.fileIndex ?? "x"}`;
        candidateUid = `${candidateUid}${suffix}`;
        candidate = `${candidate}${suffix}`;

        // Defensive: if the disambiguated form ALSO collides (vanishingly
        // rare — would need a hand-crafted ref shaped like the suffix), append
        // a numeric tiebreaker until unique within this batch.
        let tiebreaker = 2;
        while (seenRefs.has(candidate) || (dbRefOwners.get(candidate) != null && dbRefOwners.get(candidate) !== r.existingRowId)) {
          candidate = `${r.canonicalExternalRef}${suffix}.${tiebreaker}`;
          candidateUid = `${r.rowUid ?? r.businessKey.key}${suffix}.${tiebreaker}`;
          tiebreaker++;
          if (tiebreaker > 1000) break; // structural safety
        }

        r.canonicalExternalRef = candidate;
        r.rowUid = candidateUid;
        r.inDuplicateGroup = true;
      }

      seenRefs.set(candidate, r);
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

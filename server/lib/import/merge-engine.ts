/**
 * 3-way merge engine for the Smart Import pipeline.
 *
 * Replaces the previous "soft-close everything and re-insert" model.
 * For every incoming row from a freshly uploaded workbook, the engine
 * computes a per-field merge outcome by comparing three states:
 *
 *   1. **`importSnapshot`** — what we wrote on the previous import. The
 *      common ancestor. Stored on the existing row as a JSONB blob.
 *   2. **`existingRow`**    — the current DB state. May contain manual
 *      edits since the previous import, or may be unchanged.
 *   3. **`fileRow`**        — the new value from the uploaded workbook.
 *
 * Per-field outcomes:
 *
 *   - `no_change`    — file === db === snapshot; nothing to do.
 *   - `accept_file`  — file !== snapshot AND db === snapshot; the source
 *                      changed and the user hadn't touched this field, so
 *                      apply the source change silently.
 *   - `keep_db`      — file === snapshot AND db !== snapshot; the user
 *                      edited the field in-app and the source workbook
 *                      hasn't moved on, so preserve the user's edit
 *                      silently.
 *   - `conflict`     — both diverged from the snapshot. Surface to the
 *                      user with snapshot / db / file values so they can
 *                      decide per-field whether to keep their edit or
 *                      take the source value.
 *
 * Behaviour for first-time rows (no existing row in DB) → caller treats
 * as a clean insert; this module only handles the matched case.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldValue = string | number | boolean | null | undefined;

export type MergeOutcome =
  | { type: "no_change"; value: FieldValue }
  | { type: "accept_file"; from: FieldValue; to: FieldValue }
  | { type: "keep_db"; value: FieldValue; snapshotValue: FieldValue }
  | { type: "conflict"; snapshot: FieldValue; db: FieldValue; file: FieldValue };

export interface RowMergeResult {
  rowHash: string;
  existingId: number | null;
  outcomes: Record<string, MergeOutcome>;
  conflicts: Array<{
    fieldName: string;
    snapshotValue: FieldValue;
    existingValue: FieldValue;
    importValue: FieldValue;
  }>;
  hasConflicts: boolean;
  hasMaterialChanges: boolean; // true if any outcome is accept_file / conflict
}

export type ConflictResolution =
  | { fieldName: string; resolution: "keep_existing" }
  | { fieldName: string; resolution: "accept_import" }
  | { fieldName: string; resolution: "manual"; value: FieldValue };

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

/**
 * Loose equality check tuned for cross-format comparisons (Excel string
 * cell vs DB numeric, ISO date vs Excel date string, etc.).
 * - null / undefined / "" are all equivalent (treated as "absent").
 * - Whitespace + casing differences on string values are normalized.
 * - Numeric strings are compared as numbers when both sides parse.
 */
export function valuesEqual(a: FieldValue, b: FieldValue): boolean {
  const an = normalizeForCompare(a);
  const bn = normalizeForCompare(b);
  if (an === null && bn === null) return true;
  if (an === null || bn === null) return false;
  if (typeof an === "number" && typeof bn === "number") {
    return Math.abs(an - bn) < 1e-9;
  }
  return an === bn;
}

function normalizeForCompare(v: FieldValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!isFinite(v)) return null;
    return v;
  }
  const s = String(v).trim();
  if (!s) return null;
  // Try numeric coercion — handles "1500.00" vs 1500.
  const num = Number(s.replace(/,/g, ""));
  if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ""))) {
    return num;
  }
  return s.toLowerCase();
}

// ---------------------------------------------------------------------------
// Row merge
// ---------------------------------------------------------------------------

export interface MergeRowInput {
  rowHash: string;
  fileRow: Record<string, FieldValue>;
  existingRow: (Record<string, FieldValue> & { id: number }) | null;
  importSnapshot: Record<string, FieldValue> | null;
  /** Canonical field names that should participate in the merge. */
  fields: string[];
}

export function mergeRow(input: MergeRowInput): RowMergeResult {
  const { rowHash, fileRow, existingRow, importSnapshot, fields } = input;

  if (!existingRow) {
    return {
      rowHash,
      existingId: null,
      outcomes: {},
      conflicts: [],
      hasConflicts: false,
      hasMaterialChanges: true, // a new row is itself a material change
    };
  }

  const outcomes: Record<string, MergeOutcome> = {};
  const conflicts: RowMergeResult["conflicts"] = [];
  let hasMaterialChanges = false;

  for (const field of fields) {
    const fileVal = (fileRow[field] ?? null) as FieldValue;
    const dbVal = (existingRow[field] ?? null) as FieldValue;
    // When the snapshot is missing entirely (legacy row imported before
    // 3-way merge was introduced), treat the snapshot value as equal to
    // the current DB value. That degrades gracefully — a divergence
    // between file and db will be classified as `accept_file` (i.e. we
    // assume the DB hasn't been manually edited yet). Once the row has
    // been re-imported once, the snapshot is populated and subsequent
    // imports use the full 3-way logic.
    const snapSource = importSnapshot ?? existingRow;
    const snapVal = (snapSource[field] ?? null) as FieldValue;

    const fileChanged = !valuesEqual(fileVal, snapVal);
    const dbChanged = !valuesEqual(dbVal, snapVal);

    if (!fileChanged && !dbChanged) {
      outcomes[field] = { type: "no_change", value: dbVal };
      continue;
    }

    if (fileChanged && !dbChanged) {
      outcomes[field] = { type: "accept_file", from: snapVal, to: fileVal };
      hasMaterialChanges = true;
      continue;
    }

    if (!fileChanged && dbChanged) {
      outcomes[field] = { type: "keep_db", value: dbVal, snapshotValue: snapVal };
      // Preserving a manual edit is not a "material change" for the
      // import — the row's effective value is unchanged from what the
      // user already saw in the app. We do however want to refresh the
      // import_snapshot for this field on commit so the next merge
      // continues to recognize the manual edit correctly.
      continue;
    }

    // Both changed.
    if (valuesEqual(fileVal, dbVal)) {
      // The user manually edited toward the same value the source
      // workbook now has. Not a real conflict — accept the (now
      // equal) file value and refresh the snapshot.
      outcomes[field] = { type: "accept_file", from: snapVal, to: fileVal };
      hasMaterialChanges = true;
      continue;
    }

    outcomes[field] = { type: "conflict", snapshot: snapVal, db: dbVal, file: fileVal };
    hasMaterialChanges = true;
    conflicts.push({
      fieldName: field,
      snapshotValue: snapVal,
      existingValue: dbVal,
      importValue: fileVal,
    });
  }

  return {
    rowHash,
    existingId: existingRow.id,
    outcomes,
    conflicts,
    hasConflicts: conflicts.length > 0,
    hasMaterialChanges,
  };
}

// ---------------------------------------------------------------------------
// Apply resolutions
// ---------------------------------------------------------------------------

/**
 * Translate a row's merge result + the user's per-field resolutions into
 * the final field values to write. Non-conflicting outcomes always honor
 * the engine's recommendation (`accept_file` → file value, `keep_db` →
 * db value, `no_change` → unchanged). For each conflicting field, the
 * caller MUST pass a resolution; an unresolved conflict throws.
 */
export function applyResolutions(
  merge: RowMergeResult,
  resolutions: ConflictResolution[],
  /** When true, default unresolved conflicts to `keep_existing` (safer fallback for batch imports). */
  defaultToKeepExisting = false,
): Record<string, FieldValue> {
  const resByField = new Map(resolutions.map(r => [r.fieldName, r]));
  const result: Record<string, FieldValue> = {};

  for (const [field, outcome] of Object.entries(merge.outcomes)) {
    switch (outcome.type) {
      case "no_change":
        result[field] = outcome.value;
        break;
      case "accept_file":
        result[field] = outcome.to;
        break;
      case "keep_db":
        result[field] = outcome.value;
        break;
      case "conflict": {
        const res = resByField.get(field);
        if (!res) {
          if (defaultToKeepExisting) {
            result[field] = outcome.db;
            break;
          }
          throw new Error(
            `Unresolved conflict on field "${field}" (existing=${JSON.stringify(outcome.db)}, file=${JSON.stringify(outcome.file)})`,
          );
        }
        if (res.resolution === "keep_existing") {
          result[field] = outcome.db;
        } else if (res.resolution === "accept_import") {
          result[field] = outcome.file;
        } else {
          result[field] = res.value;
        }
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Manual-override tracking
// ---------------------------------------------------------------------------

export interface ManualOverrideEntry {
  /** The value the user kept. */
  value: FieldValue;
  /** User id who made the edit (or null for system-inferred). */
  editedBy: number | null;
  /** When the override was recorded. */
  editedAt: string; // ISO timestamp
  /** What it was overriding (the snapshot value at the time). */
  fromValue: FieldValue;
}

export type ManualOverridesMap = Record<string, ManualOverrideEntry>;

/**
 * Update the row's manual_overrides map after a merge has been applied.
 *
 * Rules:
 *   - `keep_db`: the merge inferred a manual edit. If no override was
 *                already recorded for this field, add one (system-inferred).
 *   - `conflict` resolved as `keep_existing`: confirm the manual edit;
 *                refresh the timestamp + editor.
 *   - `conflict` resolved as `accept_import` or `manual`: the user
 *                explicitly chose to drop their edit; remove the entry.
 *   - `accept_file`: the source moved on; if there was a stale override
 *                remove it (the user's earlier edit is now superseded).
 *   - `no_change`: leave overrides untouched.
 */
export function updateManualOverrides(
  current: ManualOverridesMap | null,
  merge: RowMergeResult,
  resolutions: ConflictResolution[],
  decidedBy: number | null,
  now: Date = new Date(),
): ManualOverridesMap {
  const next: ManualOverridesMap = { ...(current ?? {}) };
  const resByField = new Map(resolutions.map(r => [r.fieldName, r]));
  const ts = now.toISOString();

  for (const [field, outcome] of Object.entries(merge.outcomes)) {
    if (outcome.type === "keep_db") {
      if (!next[field]) {
        next[field] = {
          value: outcome.value,
          editedBy: decidedBy,
          editedAt: ts,
          fromValue: outcome.snapshotValue,
        };
      }
      continue;
    }

    if (outcome.type === "accept_file") {
      delete next[field];
      continue;
    }

    if (outcome.type === "conflict") {
      const res = resByField.get(field);
      if (!res || res.resolution === "keep_existing") {
        next[field] = {
          value: outcome.db,
          editedBy: decidedBy,
          editedAt: ts,
          fromValue: outcome.snapshot,
        };
      } else {
        delete next[field];
      }
    }
  }

  return next;
}

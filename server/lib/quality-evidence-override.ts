/**
 * Pure builder for the `evidence_override_records` row written when an
 * authorised role (COO/CEO per the § 0A override matrix) passes or
 * approves a QC item that still fails the evidence-required gate.
 *
 * Kept pure + separate from the route handler so:
 *   1. The two call sites (item update `pass` + dedicated `approve`
 *      endpoint) build an identical, audited record shape.
 *   2. The record shape is unit-testable without a live DB — the
 *      earlier bug (Task 0.1) was that the project id was read from a
 *      column that does not exist on `qc_item_instance`, so the insert
 *      silently never ran. The handler now resolves the project id via
 *      `resolveProjectIdForItemInstance()` and passes it here.
 *
 * `sourceType` is `qc_item_instance` and `sourceRef` is the item-instance
 * id — the QC analogue of the commissioning override
 * (`commissioning_item` / item id) so the two override surfaces read the
 * same way. `completionType` distinguishes the acting endpoint
 * (`qc_item_pass` vs `qc_item_approve`).
 */

export type QcOverrideCompletionType = "qc_item_pass" | "qc_item_approve";

export interface QcEvidenceOverrideInput {
  /** Resolved via qc_item_instance → qc_checklist.project_id (NOT NULL). */
  projectId: number;
  /** The qc_item_instance id the override was applied to. */
  itemInstanceId: number;
  /** Which handler recorded the override. */
  completionType: QcOverrideCompletionType;
  /** Count of live (non-deleted) evidence rows at override time. */
  evidenceCount: number;
  /** Free-text justification, mandatory (§ 0A). */
  reason: string;
  authorizedByUserId: number;
  authorizedByName?: string | null;
  authorizedByRole?: string | null;
}

export interface QcEvidenceOverrideRecordValues {
  projectId: number;
  completionType: QcOverrideCompletionType;
  sourceType: "qc_item_instance";
  sourceRef: string;
  scorePercent: number;
  thresholdPercent: number;
  reason: string;
  authorizedByUserId: number;
  authorizedByName: string | null;
  authorizedByRole: string | null;
}

/**
 * Build the `evidence_override_records` insert payload. The evidence gate
 * is binary for QC items (evidence present vs missing), so the score is
 * 100 when any evidence exists, else 0, against a 100% threshold — the
 * same convention the commissioning override records.
 */
export function buildQcEvidenceOverrideRecord(
  input: QcEvidenceOverrideInput,
): QcEvidenceOverrideRecordValues {
  return {
    projectId: input.projectId,
    completionType: input.completionType,
    sourceType: "qc_item_instance",
    sourceRef: String(input.itemInstanceId),
    scorePercent: input.evidenceCount > 0 ? 100 : 0,
    thresholdPercent: 100,
    reason: input.reason,
    authorizedByUserId: input.authorizedByUserId,
    authorizedByName: input.authorizedByName ?? null,
    authorizedByRole: input.authorizedByRole ?? null,
  };
}

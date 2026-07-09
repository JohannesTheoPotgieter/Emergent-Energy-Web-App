/**
 * Pure normalisation of a risk-answer update body.
 *
 * Extracted from the risk-answer route so the answer-value mapping is
 * unit-testable and shared by both the update-by-id path and the
 * upsert-by-(checklist, question) path (Task 1.4). Behaviour is preserved
 * verbatim from the original inline logic:
 *   - `answerYesno` wins if present; otherwise `answerValue` ("yes"/"no")
 *     maps to a boolean, and an absent/`"unanswered"` value clears it.
 *   - `answerText` wins if present; otherwise `notes` is used.
 *   - Only keys that resolve to a defined value are emitted, so an omitted
 *     field leaves the column untouched on update.
 */

export interface RiskAnswerBody {
  answerYesno?: boolean | null;
  answerText?: string | null;
  answerNumber?: number | null;
  answerValue?: "yes" | "no" | "unanswered";
  notes?: string | null;
}

export interface RiskAnswerUpdates {
  answerYesno?: boolean | null;
  answerText?: string | null;
  answerNumber?: number | null;
}

export function buildRiskAnswerUpdates(body: RiskAnswerBody): RiskAnswerUpdates {
  const normalizedAnswerYesno =
    body.answerYesno !== undefined
      ? body.answerYesno
      : body.answerValue === "yes"
        ? true
        : body.answerValue === "no"
          ? false
          : body.answerValue === "unanswered" || body.answerValue == null
            ? null
            : undefined;
  const normalizedAnswerText = body.answerText !== undefined ? body.answerText : body.notes;

  const updates: RiskAnswerUpdates = {};
  if (normalizedAnswerYesno !== undefined) updates.answerYesno = normalizedAnswerYesno;
  if (normalizedAnswerText !== undefined) updates.answerText = normalizedAnswerText;
  if (body.answerNumber !== undefined) updates.answerNumber = body.answerNumber;
  return updates;
}

/**
 * Pure builder for the column updates applied by the NCR update handler.
 *
 * The rule (Task 0.2): a field **omitted** from the request body keeps its
 * current value; a field present as **null** clears the column. The
 * previous `body.x ?? current.x` collapse made `null` indistinguishable
 * from "not sent", so an NCR could never be un-assigned and a due date
 * could never be cleared.
 *
 * Only fields actually present in the validated body appear in the
 * returned object, so omitted fields fall through to their existing DB
 * value untouched. `status` / `updatedAt` / `closedAt` are handled by the
 * caller (they depend on the transition, not a direct field write).
 */

export interface NcrUpdateBody {
  title?: string;
  description?: string | null;
  severity?: string;
  root_cause?: string | null;
  corrective_action?: string | null;
  preventive_action?: string | null;
  assigned_to?: number | null;
  due_date?: string | null;
}

export function buildNcrFieldUpdates(body: NcrUpdateBody): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.severity !== undefined) updates.severity = body.severity;
  if (body.root_cause !== undefined) updates.rootCause = body.root_cause;
  if (body.corrective_action !== undefined) updates.correctiveAction = body.corrective_action;
  if (body.preventive_action !== undefined) updates.preventiveAction = body.preventive_action;
  if (body.assigned_to !== undefined) updates.assignedTo = body.assigned_to;
  if (body.due_date !== undefined) updates.dueDate = body.due_date;
  return updates;
}

/**
 * Task 2.1 — scoped reads for the Quality aggregation endpoints
 * (`/api/quality/all-items`, `/checklists`, `/dashboard`).
 *
 * These endpoints previously loaded whole tables (`qc_item_instance`,
 * `qc_checklist`, `qc_risk_answer`) and filtered in JS. For a scoped role
 * (Site PM, PD, Engineer, KAM) that means loading the entire company's
 * Quality data to then discard all but a handful of projects.
 *
 * These helpers push the project scope into the SQL `WHERE` so a scoped
 * caller only loads its own projects' rows. Scoping is by `project_id` —
 * `qc_checklist.project_id` is NOT NULL, so it reliably identifies the
 * project without the case/whitespace fragility of the deprecated
 * `project_name` column. Oversight roles (scopedIds === null) still load the
 * full set. The endpoints keep their existing final scope filter, which now
 * merely refines an already-scoped set — output is unchanged.
 */
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { qcChecklist, qcItemInstance, qcRiskAnswer } from "@shared/schema";

type ChecklistRow = typeof qcChecklist.$inferSelect;
type ItemInstanceRow = typeof qcItemInstance.$inferSelect;
type RiskAnswerRow = typeof qcRiskAnswer.$inferSelect;

/**
 * Checklists visible to the caller. `scopedIds === null` → oversight (all
 * checklists). Empty array → no access (no rows).
 */
export async function loadScopedChecklists(scopedIds: number[] | null): Promise<ChecklistRow[]> {
  if (scopedIds === null) return db.select().from(qcChecklist);
  if (scopedIds.length === 0) return [];
  return db.select().from(qcChecklist).where(inArray(qcChecklist.projectId, scopedIds));
}

/**
 * Item instances for the given (already scope-resolved) checklist ids.
 * Oversight (`scopedIds === null`) loads the full table.
 */
export async function loadScopedItemInstances(
  scopedIds: number[] | null,
  scopedChecklistIds: number[],
): Promise<ItemInstanceRow[]> {
  if (scopedIds === null) return db.select().from(qcItemInstance);
  if (scopedChecklistIds.length === 0) return [];
  return db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, scopedChecklistIds));
}

/**
 * Risk answers for the given (already scope-resolved) checklist ids.
 * Oversight (`scopedIds === null`) loads the full table.
 */
export async function loadScopedRiskAnswers(
  scopedIds: number[] | null,
  scopedChecklistIds: number[],
): Promise<RiskAnswerRow[]> {
  if (scopedIds === null) return db.select().from(qcRiskAnswer);
  if (scopedChecklistIds.length === 0) return [];
  return db.select().from(qcRiskAnswer).where(inArray(qcRiskAnswer.checklistId, scopedChecklistIds));
}

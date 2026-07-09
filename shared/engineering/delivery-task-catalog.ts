import { z } from "zod";
import type { CompanyRole } from "../schema/users";

/**
 * Controlled vocabulary for Engineering **delivery-scope** task types.
 *
 * Modelled as a shared constant + Zod (not a pg enum) because `work_items`
 * `task_type_tag` is a shared free-text column across workstreams; an enum
 * migration would be invasive and cross-domain. Validation happens at the
 * engineering route boundary. Additive and reversible.
 */

/** Delivery deliverable/work task types (financial close → handover). */
export const ENGINEERING_DELIVERY_TASK_TYPE_TAGS = [
  "ifc_pack",
  "as_built",
  "rfi",
  "substitution",
  "commissioning_review",
  "eng_snag",
  "handover_pack",
] as const;
export type EngineeringDeliveryTaskTypeTag = (typeof ENGINEERING_DELIVERY_TASK_TYPE_TAGS)[number];

/** Seam handoff task types — tracked items handed across a discipline seam. */
export const ENGINEERING_SEAM_TASK_TYPE_TAGS = [
  "compliance_input", // → Keith / SSEG (SSEG/NERSA/PTI/Grid input)
  "construction_snag", // ↔ Construction Manager
] as const;
export type EngineeringSeamTaskTypeTag = (typeof ENGINEERING_SEAM_TASK_TYPE_TAGS)[number];

/**
 * Which company role receives each seam handoff. This is the machine-readable
 * form of the routing documented on `ENGINEERING_SEAM_TASK_TYPE_TAGS` above:
 * a `compliance_input` seam is owned by the SSEG lead (Keith / SSEG — SSEG,
 * NERSA, PTI, grid input), a `construction_snag` by the Construction Manager.
 * The server resolves the actual user from this role at handoff time.
 */
export const SEAM_RECIPIENT_ROLE = {
  compliance_input: "SSEG_MANAGER",
  construction_snag: "CONSTRUCTION_MANAGER",
} as const satisfies Record<EngineeringSeamTaskTypeTag, CompanyRole>;

/** Human label for the seam recipient role — surfaced in the handoff form. */
export const SEAM_RECIPIENT_ROLE_LABEL: Record<EngineeringSeamTaskTypeTag, string> = {
  compliance_input: "SSEG Manager",
  construction_snag: "Construction Manager",
};

/** Every controlled engineering task type tag (delivery + seam). */
export const ENGINEERING_TASK_TYPE_TAGS = [
  ...ENGINEERING_DELIVERY_TASK_TYPE_TAGS,
  ...ENGINEERING_SEAM_TASK_TYPE_TAGS,
] as const;
export type EngineeringTaskTypeTag = (typeof ENGINEERING_TASK_TYPE_TAGS)[number];

/**
 * Task types whose output IS a document — a task of this type cannot move to
 * Done without a linked document. Enforced at the single status chokepoint
 * (`server/lib/task-workflow-guard.ts`).
 */
export const DOCUMENT_OUTPUT_TASK_TYPE_TAGS = [
  "ifc_pack",
  "as_built",
  "handover_pack",
  "commissioning_review",
] as const satisfies readonly EngineeringDeliveryTaskTypeTag[];

const DOCUMENT_OUTPUT_SET: ReadonlySet<string> = new Set(DOCUMENT_OUTPUT_TASK_TYPE_TAGS);

/**
 * The single link role that satisfies the Done-gate. A document-output task
 * reaches Done only when it has a `work_item_document_links` row with this
 * role — an `evidence` or `reference` link does NOT unblock Done. Shared by
 * both context-builder query paths in `server/lib/task-workflow-guard.ts` so
 * the single-task and bulk paths can't drift.
 */
export const DONE_GATE_OUTPUT_LINK_ROLE = "output" as const;

export function isEngineeringTaskTypeTag(v: string | null | undefined): v is EngineeringTaskTypeTag {
  return v != null && (ENGINEERING_TASK_TYPE_TAGS as readonly string[]).includes(v);
}

export function isSeamTaskTypeTag(v: string | null | undefined): v is EngineeringSeamTaskTypeTag {
  return v != null && (ENGINEERING_SEAM_TASK_TYPE_TAGS as readonly string[]).includes(v);
}

/** True when a task of this type must have a linked document to reach Done. */
export function requiresDocumentLink(taskTypeTag: string | null | undefined): boolean {
  return taskTypeTag != null && DOCUMENT_OUTPUT_SET.has(taskTypeTag);
}

// Zod schemas for route validation.
export const engineeringDeliveryTaskTypeTagSchema = z.enum(ENGINEERING_DELIVERY_TASK_TYPE_TAGS);
export const engineeringSeamTaskTypeTagSchema = z.enum(ENGINEERING_SEAM_TASK_TYPE_TAGS);
export const engineeringTaskTypeTagSchema = z.enum(ENGINEERING_TASK_TYPE_TAGS);

/** Human labels for UI. */
export const ENGINEERING_TASK_TYPE_LABELS: Record<EngineeringTaskTypeTag, string> = {
  ifc_pack: "IFC Pack",
  as_built: "As-Built",
  rfi: "RFI",
  substitution: "Substitution",
  commissioning_review: "Commissioning Review",
  eng_snag: "Engineering Snag",
  handover_pack: "Handover Pack",
  compliance_input: "Compliance Input",
  construction_snag: "Construction Snag",
};

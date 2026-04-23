import { isEngineeringRequestType } from "@shared/roles/pd-roles";

/**
 * The user-facing classification of a `pd_tickets` row.
 *
 * Phase 1 of the "retire PD ticket vocabulary" initiative (task #56).
 * The underlying table stays named `pd_tickets`, but every place a user
 * sees a ticket we render it as either an Engineering ticket or a
 * Quality ticket. The classifier is purely derived from `request_type`;
 * no DB column has been added yet.
 *
 * Rules:
 *   - request_type ∈ ENGINEERING_REQUEST_TYPES  → "engineering"
 *   - anything else (including null/empty)      → "quality"
 *
 * "Quality" is the safer default for unknown values: a Quality ticket
 * is just an internal action item, whereas mis-labelling something as
 * an Engineering ticket would put it onto the engineering board.
 */
export type TicketKind = "engineering" | "quality";

export interface TicketKindInput {
  requestType?: string | null;
}

export function getTicketKind(ticket: TicketKindInput | null | undefined): TicketKind {
  const rt = ticket?.requestType;
  if (typeof rt === "string" && rt.length > 0 && isEngineeringRequestType(rt)) {
    return "engineering";
  }
  return "quality";
}

const KIND_LABELS: Record<TicketKind, { singular: string; plural: string }> = {
  engineering: { singular: "Engineering ticket", plural: "Engineering tickets" },
  quality: { singular: "Quality ticket", plural: "Quality tickets" },
};

export function ticketKindLabel(
  kind: TicketKind,
  variant: "singular" | "plural" = "singular",
): string {
  return KIND_LABELS[kind][variant];
}

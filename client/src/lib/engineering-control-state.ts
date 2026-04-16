/**
 * Engineering document control state — UI helper.
 *
 * Mirrors shared/schema/engineering.ts RELEASED_FOR_STATES and
 * RELEASED_FOR_TRANSITIONS so that the client has a single source of
 * truth for labels, colours, and allowed next actions when rendering a
 * deliverable's controlled-document state.
 *
 * NOTE: "approved" (review) is DELIBERATELY blue, not green. Green is
 * reserved for states that are actually safe for construction use —
 * `issued_for_construction` and `as_built`. This is the whole point of
 * the distinction; do not make them the same colour.
 */

export const CONTROL_STATES = [
  "draft",
  "under_review",
  "approved_for_review",
  "issued_for_construction",
  "as_built",
  "superseded",
] as const;
export type ControlState = (typeof CONTROL_STATES)[number];

export interface ControlStateMeta {
  /** Short label for badges. Never a bare "Approved". */
  label: string;
  /** Longer plain-English description for tooltips. */
  description: string;
  /** Tailwind class string for the badge. */
  badgeClass: string;
  /** Tone — used by tests and by components that need to group colours. */
  tone: "neutral" | "amber" | "blue" | "green" | "red";
  /** True iff this state means the document is safe to build from. */
  isConstructionSafe: boolean;
}

export const CONTROL_STATE_META: Record<ControlState, ControlStateMeta> = {
  draft: {
    label: "Draft",
    description: "Uploaded but not yet submitted for review.",
    badgeClass: "bg-muted text-muted-foreground",
    tone: "neutral",
    isConstructionSafe: false,
  },
  under_review: {
    label: "Under QC review",
    description: "Submitted for review. Reviewer has not yet signed off.",
    badgeClass: "bg-amber-100 text-amber-700",
    tone: "amber",
    isConstructionSafe: false,
  },
  approved_for_review: {
    // Deliberately NOT "Approved" alone — that word was being read as
    // "safe to build from" by field teams.
    label: "QC approved (review only)",
    description:
      "Reviewer signed off the document for review. NOT yet issued for construction.",
    badgeClass: "bg-blue-100 text-blue-700",
    tone: "blue",
    isConstructionSafe: false,
  },
  issued_for_construction: {
    label: "Issued For Construction",
    description:
      "Released by the responsible engineer for site use. Safe to build from.",
    badgeClass: "bg-emerald-100 text-emerald-800",
    tone: "green",
    isConstructionSafe: true,
  },
  as_built: {
    label: "As-built",
    description: "Construction-recorded reality. Supersedes the IFC document.",
    badgeClass: "bg-emerald-100 text-emerald-800",
    tone: "green",
    isConstructionSafe: true,
  },
  superseded: {
    label: "Superseded",
    description: "Replaced by a newer revision. Do not use.",
    badgeClass: "bg-muted text-muted-foreground line-through",
    tone: "neutral",
    isConstructionSafe: false,
  },
};

/**
 * Allowed next transitions — must match
 * shared/schema/engineering.ts RELEASED_FOR_TRANSITIONS. Duplicated here
 * so that the client does not import server schema code (keeps the
 * client bundle lean). Drift is detected by the unit test
 * engineering-control-state.test.ts which imports from both sources.
 */
export const CONTROL_STATE_NEXT: Record<ControlState, readonly ControlState[]> = {
  draft: ["under_review", "superseded"],
  under_review: ["draft", "approved_for_review", "superseded"],
  approved_for_review: ["under_review", "issued_for_construction", "superseded"],
  issued_for_construction: ["as_built", "superseded"],
  as_built: ["superseded"],
  superseded: [],
};

/**
 * The action a user can take from a given state, with the label we want
 * to show on the primary button.
 */
export interface ControlAction {
  /** Next state that this action will produce. */
  to: ControlState;
  /** Button label. */
  label: string;
  /** Roles that should see this action. */
  allowedRoles: readonly string[];
  /** Tone for the button. */
  tone: "primary" | "secondary" | "danger";
}

const ENGINEER_ROLES = ["ENGINEER", "ENGINEERING_MANAGER", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"] as const;
const CONSTRUCTION_ROLES = [...ENGINEER_ROLES, "CONSTRUCTION_MANAGER"] as const;

export const CONTROL_ACTIONS: Partial<Record<ControlState, ControlAction[]>> = {
  approved_for_review: [
    {
      to: "issued_for_construction",
      label: "Issue for Construction",
      allowedRoles: ENGINEER_ROLES,
      tone: "primary",
    },
  ],
  issued_for_construction: [
    {
      to: "as_built",
      label: "Mark As-Built",
      allowedRoles: CONSTRUCTION_ROLES,
      tone: "primary",
    },
  ],
};

/**
 * Derive the ControlState to render for a deliverable row. Falls back
 * to `approvalStatus` when `releasedFor` is not present (e.g. pre-migration
 * legacy rows or stale query cache).
 */
export function deriveControlState(row: {
  releasedFor?: string | null;
  approvalStatus?: string | null;
}): ControlState {
  const rf = row.releasedFor;
  if (rf && (CONTROL_STATES as readonly string[]).includes(rf)) {
    return rf as ControlState;
  }
  // Back-compat fallback: when releasedFor is missing, read approvalStatus.
  switch (row.approvalStatus) {
    case "approved":
      return "approved_for_review";
    case "rejected":
      return "under_review";
    case "pending":
    default:
      return "draft";
  }
}

export function canUserAct(action: ControlAction, userRole: string): boolean {
  return action.allowedRoles.includes(userRole);
}

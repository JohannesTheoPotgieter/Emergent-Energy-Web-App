/**
 * Canonical PD request-type lists.
 *
 * Two exports because two surfaces need slightly different shapes:
 *
 * - `PD_REQUEST_TYPES_ACTIVE` is the list of request types a user is
 *   allowed to pick when creating a new PD ticket. This is the authoritative
 *   list for new work.
 * - `PD_REQUEST_TYPES_FILTERABLE` is a superset that includes legacy types
 *   still present on older tickets. The `/pd/tickets` list page uses it so
 *   filtering does not silently hide historical rows.
 *
 * Any type in ACTIVE must also appear in FILTERABLE. If you add a new type,
 * add it to both. If you retire a type, move it from ACTIVE to the
 * legacy block below but keep it in FILTERABLE until all historical rows
 * have been migrated.
 *
 * Keep in sync with `PD_REQUEST_TYPE_TASK_TEMPLATES` in
 * `shared/schema/projects.ts` — the server uses that map to spawn sub-tasks
 * when a ticket is created.
 */

/** Request types a user can pick when creating a new PD ticket. */
export const PD_REQUEST_TYPES_ACTIVE = [
  "Cost Proposal",
  "IFC Planning",
  "Site Assessment",
  "Feasibility Study",
  "Grid Application",
  "Design Review",
  "Battery Assessment",
  "Full EPC",
] as const;

/**
 * Legacy request types that exist on historical tickets but can no longer
 * be selected when creating a new ticket. Kept so the filter on the list
 * page still matches old rows.
 */
export const PD_REQUEST_TYPES_LEGACY = [
  "Data Analysis Request",
  "Meter installation",
  "Site visit Report",
  "CP - PVSOL",
  "First Assessment - PowerPoint Template",
  "Sizing Rational Request",
] as const;

/** Union used by the /pd/tickets list filter. Active first, then legacy. */
export const PD_REQUEST_TYPES_FILTERABLE = [
  ...PD_REQUEST_TYPES_ACTIVE,
  ...PD_REQUEST_TYPES_LEGACY,
] as const;

export type PdRequestType =
  | (typeof PD_REQUEST_TYPES_ACTIVE)[number]
  | (typeof PD_REQUEST_TYPES_LEGACY)[number];

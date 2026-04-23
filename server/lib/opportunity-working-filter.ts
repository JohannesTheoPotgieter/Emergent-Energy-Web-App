/**
 * Opportunity working-list eligibility rules for PD.
 *
 * This layer is intentionally defensive because CRM-sync data can drift:
 * - status and stage can be inconsistent across historical sync snapshots.
 * - signedDate can be null even when stage/status imply terminal state.
 *
 * Rule summary:
 *  - INCLUDE active/open pipedrive opportunities, **including** those
 *    already linked to a project (so converting a deal to a project
 *    no longer makes the opportunity disappear from the working list —
 *    the linked project is surfaced as a chip in the UI instead).
 *  - EXCLUDE lost and won/signed/closed opportunities (genuinely
 *    terminal states).
 */

export interface OpportunityWorkingFilterInput {
  source?: string | null;
  status?: string | null;
  stage?: string | null;
  signedDate?: string | Date | null;
  hasLinkedProject?: boolean;
}

function norm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function isOpportunityIntakeTerminal(input: { status?: string | null; stage?: string | null; signedDate?: string | Date | null }): boolean {
  const status = norm(input.status);
  const stage = norm(input.stage);
  const hasSignedDate = Boolean(input.signedDate);
  const terminalMarkers = ["won", "lost", "closed", "deleted", "signed", "contracted"];
  return containsAny(status, terminalMarkers) || containsAny(stage, terminalMarkers) || hasSignedDate;
}

/**
 * Returns true when an opportunity should be shown in the PD working list.
 */
export function isActivePdWorkingOpportunity(input: OpportunityWorkingFilterInput): boolean {
  const source = norm(input.source);
  const status = norm(input.status);
  const stage = norm(input.stage);

  // Working list is for CRM-synced pipeline only.
  if (source !== "pipedrive") return false;

  // NOTE: a linked project is intentionally NOT a hide-reason. An
  // opportunity that has spawned a project is still active business —
  // PD owners need it to stay visible (with a "Linked: <project>"
  // chip in the UI) so they can keep working it. Hiding on link was
  // previously surprising users (deals "vanished" the moment a
  // project was created from them).

  // Terminal outcomes: any explicit won/lost/closed marker excludes.
  if (isOpportunityIntakeTerminal({ status: input.status, stage: input.stage, signedDate: input.signedDate })) return false;

  // Primary include signal: open/active pipeline status.
  const openMarkers = ["active", "open", "pipeline", "in_progress"];
  if (containsAny(status, openMarkers)) return true;

  // Fallback include: non-terminal stage in front-office pipeline.
  // This catches rows where status is empty/inconsistent.
  const activeStageMarkers = [
    "prospect",
    "qualification",
    "proposal",
    "negotiation",
    "discovery",
    "assessment",
    "first assessment",
    "cost proposal",
  ];
  if (containsAny(stage, activeStageMarkers)) return true;

  return false;
}

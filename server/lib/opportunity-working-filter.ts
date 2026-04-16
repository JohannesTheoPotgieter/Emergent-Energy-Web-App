/**
 * Opportunity working-list eligibility rules for PD.
 *
 * This layer is intentionally defensive because CRM-sync data can drift:
 * - status and stage can be inconsistent across historical sync snapshots.
 * - signedDate can be null even when stage/status imply terminal state.
 *
 * Rule summary:
 *  - INCLUDE only active/open pipedrive opportunities.
 *  - EXCLUDE lost, won/signed/closed, and converted opportunities.
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
  const hasLinkedProject = Boolean(input.hasLinkedProject);

  // Working list is for CRM-synced pipeline only.
  if (source !== "pipedrive") return false;

  // Converted deals already have a linked project and must not appear in
  // the working list.
  if (hasLinkedProject) return false;

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

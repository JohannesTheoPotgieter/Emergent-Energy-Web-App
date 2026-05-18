export interface ProjectOperationalStatus {
  lifecycleStage: string;
  currentGate: string;
  gateStatus: string;
  gateOwner: string;
  trackerStatus: "linked" | "missing";
  executionReadiness: "ready" | "not_ready";
  nextAction: string;
  nextActionOwner: string;
  nextKeyDate: string | null;
  latestUpdate: string | null;
}

/**
 * Loosely-shaped project record accepted by {@link deriveProjectOperationalStatus}.
 * Callers pass raw summary rows that may use snake_case (raw SQL endpoints) or
 * camelCase (Drizzle) field names, so every field is optional.
 */
export interface OperationalStatusInput {
  phase?: string | null;
  executionPhase?: string | null;
  pd?: string | null;
  pd_owner?: string | null;
  pm?: string | null;
  pm_owner?: string | null;
  pd_pm_handover_status?: string | null;
  pdPmHandoverStatus?: string | null;
  has_tracker_import?: boolean | null;
  hasTrackerImport?: boolean | null;
  excel_tracker_link?: unknown;
  excelTrackerLink?: unknown;
  client_handover_date?: string | null;
  om_handover_date?: string | null;
  commissioning_date?: string | null;
  latest_update?: string | null;
  comments?: string | null;
  shared_summary?: {
    project?: {
      lifecycleStageLabel?: string | null;
      lifecycleStage?: string | null;
    } | null;
    latestUpdate?: {
      text?: string | null;
    } | null;
  } | null;
}

export function deriveProjectOperationalStatus(project: OperationalStatusInput): ProjectOperationalStatus {
  const stage = project.shared_summary?.project?.lifecycleStageLabel
    || project.shared_summary?.project?.lifecycleStage
    || project.phase
    || project.executionPhase
    || "Unstaged";
  const handoverStatus = project.pd_pm_handover_status || project.pdPmHandoverStatus || "DRAFT";
  const trackerLinked = Boolean(project.has_tracker_import || project.hasTrackerImport || project.excel_tracker_link || project.excelTrackerLink);
  const pmOwner = project.pm || project.pm_owner || "Unassigned";

  const executionReadiness = handoverStatus === "ACCEPTED" && trackerLinked && pmOwner !== "Unassigned" ? "ready" : "not_ready";

  let nextAction = "Continue execution updates";
  let nextActionOwner = pmOwner;
  if (handoverStatus !== "ACCEPTED") {
    nextAction = handoverStatus === "SUBMITTED_FOR_PM_REVIEW" ? "Review and decide handover" : "Complete and submit handover";
    nextActionOwner = handoverStatus === "SUBMITTED_FOR_PM_REVIEW" ? (pmOwner || "PM") : (project.pd || project.pd_owner || "PD");
  } else if (!trackerLinked) {
    nextAction = "Link tracker import to enable execution controls";
    nextActionOwner = pmOwner === "Unassigned" ? "Operations" : pmOwner;
  } else if (pmOwner === "Unassigned") {
    nextAction = "Assign PM owner";
    nextActionOwner = "Operations";
  }

  return {
    lifecycleStage: stage,
    currentGate: "PD -> PM Handover",
    gateStatus: handoverStatus,
    gateOwner: handoverStatus === "SUBMITTED_FOR_PM_REVIEW" ? (pmOwner || "PM") : (project.pd || project.pd_owner || "PD"),
    trackerStatus: trackerLinked ? "linked" : "missing",
    executionReadiness,
    nextAction,
    nextActionOwner,
    nextKeyDate: project.client_handover_date || project.om_handover_date || project.commissioning_date || null,
    latestUpdate: project.shared_summary?.latestUpdate?.text || project.latest_update || project.comments || null,
  };
}

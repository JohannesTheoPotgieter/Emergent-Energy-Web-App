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

export function deriveProjectOperationalStatus(project: any): ProjectOperationalStatus {
  const stage = project.phase || project.executionPhase || "Unstaged";
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
    currentGate: "PD→PM Handover",
    gateStatus: handoverStatus,
    gateOwner: handoverStatus === "SUBMITTED_FOR_PM_REVIEW" ? (pmOwner || "PM") : (project.pd || project.pd_owner || "PD"),
    trackerStatus: trackerLinked ? "linked" : "missing",
    executionReadiness,
    nextAction,
    nextActionOwner,
    nextKeyDate: project.client_handover_date || project.om_handover_date || project.commissioning_date || null,
    latestUpdate: project.latest_update || project.comments || null,
  };
}

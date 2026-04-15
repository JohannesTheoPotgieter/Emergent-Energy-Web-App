export type CanonicalTaskStatus =
  | "not_started"
  | "to_do"
  | "in_progress"
  | "hold"
  | "projects_assistance"
  | "needs_approval"
  | "qc_approved"
  | "provide_feedback"
  | "operational_approval"
  | "complete";

const STATUS_ALIASES: Record<string, CanonicalTaskStatus> = {
  not_started: "not_started",
  "not started": "not_started",
  to_do: "to_do",
  todo: "to_do",
  "to do": "to_do",
  in_progress: "in_progress",
  "in progress": "in_progress",
  hold: "hold",
  on_hold: "hold",
  "on hold": "hold",
  projects_assistance: "projects_assistance",
  "projects assistance": "projects_assistance",
  needs_approval: "needs_approval",
  "needs approval": "needs_approval",
  qc_approved: "qc_approved",
  "qc approved": "qc_approved",
  provide_feedback: "provide_feedback",
  "provide feedback": "provide_feedback",
  operational_approval: "operational_approval",
  "operational approval": "operational_approval",
  complete: "complete",
  completed: "complete",
  done: "complete",
};

export function canonicalizeTaskStatus(status?: string | null): string {
  const normalized = (status || "").trim().toLowerCase();
  if (!normalized) return "";
  return STATUS_ALIASES[normalized] || status!;
}

export function toStandupLaneStatus(status?: string | null): "TO DO" | "IN PROGRESS" | "HOLD" | "COMPLETE" | null {
  const canonical = canonicalizeTaskStatus(status);
  if (canonical === "to_do" || canonical === "not_started") return "TO DO";
  if (canonical === "in_progress") return "IN PROGRESS";
  if (canonical === "hold" || canonical === "projects_assistance") return "HOLD";
  if (canonical === "complete" || canonical === "qc_approved") return "COMPLETE";
  return null;
}

export function standupLaneToCanonicalStatus(status: string): CanonicalTaskStatus {
  switch (status) {
    case "TO DO":
      return "to_do";
    case "IN PROGRESS":
      return "in_progress";
    case "HOLD":
      return "hold";
    case "COMPLETE":
      return "complete";
    default:
      return (canonicalizeTaskStatus(status) || "to_do") as CanonicalTaskStatus;
  }
}

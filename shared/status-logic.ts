export type CanonicalEngineeringStageStatus = "complete" | "in_progress" | "not_started";
export type CanonicalQualityStatus = "approved" | "pending" | "failed";

const ENG_COMPLETE = new Set(["complete", "completed", "done"]);
const ENG_IN_PROGRESS = new Set(["in_progress", "in progress", "active", "blocked", "review", "ready_for_review"]);

const QUALITY_APPROVED = new Set(["approved", "pass", "passed"]);
const QUALITY_PENDING = new Set(["pending", "in_progress", "in progress", "open", "awaiting"]);
const QUALITY_FAILED = new Set(["failed", "rejected", "fail"]);

function clean(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function toCanonicalEngineeringStageStatus(status: unknown): CanonicalEngineeringStageStatus {
  const normalized = clean(status);
  if (ENG_COMPLETE.has(normalized)) return "complete";
  if (ENG_IN_PROGRESS.has(normalized)) return "in_progress";
  return "not_started";
}

export function toCanonicalQualityStatus(status: unknown): CanonicalQualityStatus {
  const normalized = clean(status);
  if (QUALITY_APPROVED.has(normalized)) return "approved";
  if (QUALITY_FAILED.has(normalized)) return "failed";
  if (QUALITY_PENDING.has(normalized)) return "pending";
  return "pending";
}

export const PROJECT_DOCUMENT_DOMAINS = ["engineering", "quality"] as const;
export type ProjectDocumentDomain = (typeof PROJECT_DOCUMENT_DOMAINS)[number];

export const PROJECT_DOCUMENT_STATUSES = [
  "draft",
  "submitted_for_review",
  "changes_required",
  "approved",
  "superseded",
  "rejected",
  "archived",
] as const;
export type ProjectDocumentStatus = (typeof PROJECT_DOCUMENT_STATUSES)[number];

export const PROJECT_DOCUMENT_REVIEW_STATUSES = [
  "draft",
  "submitted_for_review",
  "changes_required",
  "approved",
  "rejected",
] as const;
export type ProjectDocumentReviewStatus = (typeof PROJECT_DOCUMENT_REVIEW_STATUSES)[number];

export const PROJECT_DOCUMENT_SYNC_CONFIDENCE = ["high", "medium", "low", "stale", "broken"] as const;
export type ProjectDocumentSyncConfidence = (typeof PROJECT_DOCUMENT_SYNC_CONFIDENCE)[number];

export type ProjectDocumentFlag = "ok" | "amber" | "red";

export type ProjectDocumentDefectCode =
  | "missing_sharepoint_link"
  | "broken_sharepoint_reference"
  | "missing_reviewer"
  | "missing_approver"
  | "missing_approval_timestamp"
  | "superseded_current_revision"
  | "superseded"
  | "overdue"
  | "missing_close_out_evidence"
  | "stale_sync";

export interface ProjectDocumentDefect {
  code: ProjectDocumentDefectCode;
  severity: "red" | "amber";
  message: string;
}

export interface ProjectDocumentDefectInput {
  domain: ProjectDocumentDomain;
  status: ProjectDocumentStatus;
  reviewStatus: ProjectDocumentReviewStatus;
  driveId: string | null | undefined;
  itemId: string | null | undefined;
  webUrl: string | null | undefined;
  reviewerUserId: number | null | undefined;
  approverUserId: number | null | undefined;
  approvedAt: string | Date | null | undefined;
  currentRevision: boolean;
  superseded: boolean;
  dueDate: string | Date | null | undefined;
  closeOutEvidenceRequired: boolean;
  closeOutEvidenceLinked: boolean;
  syncConfidence: ProjectDocumentSyncConfidence | null | undefined;
}

export interface ProjectDocumentDefectResult {
  flag: ProjectDocumentFlag;
  defects: ProjectDocumentDefect[];
}

export interface ProjectDocumentPermissions {
  canView: boolean;
  canCreate: boolean;
  canLink: boolean;
  canEditMetadata: boolean;
  canSubmitForReview: boolean;
  canApprove: boolean;
  canMarkSuperseded: boolean;
  canCloseOut: boolean;
  canRunSync: boolean;
  canManageConfig: boolean;
  canOverride: boolean;
}

const SUPER_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN"]);
const VIEW_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "CFO",
  "PROGRAM_MANAGER",
  "PROGRAM_FINANCE_MANAGER",
  "CONSTRUCTION_MANAGER",
  "QUALITY_MANAGER",
  "ENGINEERING_MANAGER",
  "KEY_ACCOUNTS_MANAGER",
  "ACCOUNTANT",
  "ENGINEER",
  "PROJECT_MANAGER_SITE",
  "PROJECT_DEVELOPER",
  "HSE_MANAGER",
  "SSEG_MANAGER",
]);

const ROLE_ALIASES: Record<string, string> = {
  admin: "COO_ADMIN",
  COO: "COO_ADMIN",
  COO_SUPER_ADMIN: "COO_ADMIN",
  CEO: "CEO_ADMIN",
  PROJECT_MANAGER: "PROJECT_MANAGER_SITE",
};

function normalizeRole(role: string | null | undefined): string {
  if (!role) return "";
  const alias = ROLE_ALIASES[role] ?? role;
  return alias.toUpperCase().replace(/[^A-Z_]/g, "_");
}

function hasSharePointLink(input: ProjectDocumentDefectInput): boolean {
  return !!input.driveId?.trim() && !!input.itemId?.trim() && !!input.webUrl?.trim();
}

function isPastDue(dueDate: string | Date | null | undefined): boolean {
  if (!dueDate) return false;
  const value = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(value.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  value.setHours(0, 0, 0, 0);
  return value < today;
}

export function computeProjectDocumentDefects(
  input: ProjectDocumentDefectInput,
): ProjectDocumentDefectResult {
  const defects: ProjectDocumentDefect[] = [];

  if (!hasSharePointLink(input)) {
    defects.push({
      code: "missing_sharepoint_link",
      severity: "red",
      message: "Missing SharePoint driveId, itemId, or webUrl.",
    });
  }

  if (input.syncConfidence === "broken") {
    defects.push({
      code: "broken_sharepoint_reference",
      severity: "red",
      message: "Linked SharePoint item could not be found during sync.",
    });
  } else if (input.syncConfidence === "low" || input.syncConfidence === "stale") {
    defects.push({
      code: "stale_sync",
      severity: "red",
      message: "SharePoint sync confidence is low or stale.",
    });
  }

  if (input.status === "approved" || input.reviewStatus === "approved") {
    if (!input.reviewerUserId) {
      defects.push({
        code: "missing_reviewer",
        severity: "red",
        message: "Approved document is missing a reviewer.",
      });
    }
    if (!input.approverUserId) {
      defects.push({
        code: "missing_approver",
        severity: "red",
        message: "Approved document is missing an approver.",
      });
    }
    if (!input.approvedAt) {
      defects.push({
        code: "missing_approval_timestamp",
        severity: "red",
        message: "Approved document is missing an approval timestamp.",
      });
    }
  }

  if (input.superseded && input.currentRevision) {
    defects.push({
      code: "superseded_current_revision",
      severity: "red",
      message: "Superseded document is still marked as the current revision.",
    });
  } else if (input.superseded) {
    defects.push({
      code: "superseded",
      severity: "red",
      message: "Superseded document cannot be treated as current.",
    });
  }

  if (input.domain === "quality" && isPastDue(input.dueDate) && input.status !== "approved") {
    defects.push({
      code: "overdue",
      severity: "red",
      message: "Quality document is overdue.",
    });
  }

  if (
    input.domain === "quality" &&
    input.closeOutEvidenceRequired &&
    !input.closeOutEvidenceLinked
  ) {
    defects.push({
      code: "missing_close_out_evidence",
      severity: "red",
      message: "Required close-out evidence is missing.",
    });
  }

  return {
    flag: defects.some((d) => d.severity === "red")
      ? "red"
      : defects.length > 0
        ? "amber"
        : "ok",
    defects,
  };
}

export function getProjectDocumentPermissions(
  role: string | null | undefined,
  domain: ProjectDocumentDomain,
): ProjectDocumentPermissions {
  const normalized = normalizeRole(role);
  const isSuper = SUPER_ROLES.has(normalized);
  const isEngineeringManager = normalized === "ENGINEERING_MANAGER";
  const isEngineer = normalized === "ENGINEER";
  const isQualityManager = normalized === "QUALITY_MANAGER";
  const isProjectManager = normalized === "PROJECT_MANAGER_SITE";
  const isProgramManager = normalized === "PROGRAM_MANAGER";
  const isConstructionManager = normalized === "CONSTRUCTION_MANAGER";

  const canView = isSuper || VIEW_ROLES.has(normalized);
  const canEngineerWrite =
    isSuper || isEngineeringManager || isEngineer || isProjectManager || isProgramManager;
  const canQualityWrite =
    isSuper || isQualityManager || isProjectManager || isProgramManager || isConstructionManager;
  const canWrite = domain === "engineering" ? canEngineerWrite : canQualityWrite;
  const canApprove =
    isSuper ||
    (domain === "engineering" && isEngineeringManager) ||
    (domain === "quality" && isQualityManager);

  return {
    canView,
    canCreate: canWrite,
    canLink: canWrite,
    canEditMetadata: canWrite,
    canSubmitForReview: canWrite,
    canApprove,
    canMarkSuperseded: isSuper || (domain === "engineering" && isEngineeringManager),
    canCloseOut: isSuper || (domain === "quality" && isQualityManager),
    canRunSync: isSuper || canView,
    canManageConfig: isSuper,
    canOverride: isSuper,
  };
}

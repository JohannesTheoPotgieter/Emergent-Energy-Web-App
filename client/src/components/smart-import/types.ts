// Shared structural types for the Smart Import v2 step components.
//
// The /api/imports planning + preview payloads are server-derived blobs that
// the step UIs read defensively (optional chaining throughout). These
// interfaces capture every field the components actually touch; members are
// optional to mirror the defensive access and avoid over-claiming a shape the
// server may omit. They replace the previous `any` typings. Each interface
// carries an `unknown` index signature so an as-yet-unmodelled field surfaces
// as `unknown` (forcing a narrow) instead of silently widening to `any`.

type Scalar = string | number | boolean | null | undefined;

export interface ConflictFieldChange {
  fieldName?: string;
  section?: string;
  currentAppValue?: Scalar;
  uploadedValue?: Scalar;
  requiresDecision?: boolean;
  [key: string]: unknown;
}

export interface ConflictRow {
  rowKey?: string;
  decisionKey?: string;
  displayLabel?: string;
  section?: string;
  conflictStatus?: string;
  fields?: ConflictFieldChange[];
  changedFields?: ConflictFieldChange[];
  [key: string]: unknown;
}

export interface PlanningConflicts {
  hasBlockingConflicts?: boolean;
  allRows?: ConflictRow[];
  [key: string]: unknown;
}

export interface PlanWarning {
  code?: string;
  message?: string;
  section?: string;
  externalRef?: string;
  plannedRef?: string;
  [key: string]: unknown;
}

export interface PlanRow {
  classification?: string;
  rowLabel?: string;
  section?: string;
  isMilestone?: boolean;
  parentTaskNo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  owner?: string | null;
  pctComplete?: number | null;
  changedFields?: ConflictFieldChange[];
  [key: string]: unknown;
}

export interface PlanData {
  rows: PlanRow[];
  newCount?: number;
  changedCount?: number;
  unchangedCount?: number;
  missingFromUploadCount?: number;
  [key: string]: unknown;
}

export type PlanningSectionData = PlanData;

export interface PlanningData {
  importMode?: string;
  conflicts?: PlanningConflicts;
  warnings?: PlanWarning[];
  sections?: Record<string, PlanningSectionData | undefined>;
  projectSchedule?: { plannedEnd?: string | null; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PreviewProjectInfo {
  name?: string;
  projectName?: string;
  sizeKwp?: Scalar;
  pm?: Scalar;
  pd?: Scalar;
  contractValue?: Scalar;
  pdHandoverDate?: string | null;
  constructionStartDate?: string | null;
  commissioningDate?: string | null;
  clientHandoverDate?: string | null;
  [key: string]: unknown;
}

export interface DetectedSection {
  section?: string;
  sheetName?: string;
  dataRows?: number;
  dataStartRowIndex?: number;
  dataEndRowIndex?: number;
  headerRowIndex?: number;
  layoutVariant?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface UnmatchedSheet {
  sheetName?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface PreviewDetection {
  projectInfo?: PreviewProjectInfo;
  sections?: DetectedSection[];
  unmatched?: UnmatchedSheet[];
  multiProject?: { isMultiProject?: boolean; subProjects?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PreviewData {
  preflight?: { warnings?: unknown[]; [key: string]: unknown };
  detection?: PreviewDetection;
  normalization?: { planTasks?: unknown[]; [key: string]: unknown };
  projectInfo?: PreviewProjectInfo;
  [key: string]: unknown;
}

export interface CommitResult {
  counts?: {
    planTasks?: number | null;
    revenueLines?: number | null;
    costLines?: number | null;
    [key: string]: unknown;
  };
  summary?: { rowsWritten?: number | null; [key: string]: unknown };
  v2?: { rowWarnings?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

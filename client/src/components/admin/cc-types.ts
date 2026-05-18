export interface HealthData {
  db: { connected: boolean; host: string | null; error: string | null };
  users: number;
  projects: { total: number; active: number };
  imports: { total: number; committed: number; failed: number; lastRun: string | null };
  auditEvents: number;
}

export interface FeatureFlag {
  key: string;
  value: boolean;
  rawValue: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface RolloutFoundationFlag {
  key: string;
  label: string;
  description: string;
  defaultValue: boolean;
  value: boolean;
}

export interface IntegrationHealthItem {
  name: string;
  type: string;
  objectCount: number;
  lastSyncTime: string | null;
  status: string;
  connectedUsers?: number;
  configured?: boolean;
}

export interface ImportGovernanceData {
  summary: {
    previewRuns: number;
    awaitingReviewRuns: number;
    committedRuns: number;
    failedRuns: number;
    rolledBackRuns: number;
    supersededRuns: number;
    reviewBacklog: number;
    pendingExcelConfirmations: number;
    unresolvedPlanEdits: number;
    lastRunAt: string | null;
  };
  recentRuns: Array<{
    id: number;
    projectName: string;
    status: string;
    uploadedAt: string;
    sourceFileName: string;
    recordsAttempted: number;
    recordsSucceeded: number;
    recordsFailed: number;
    blockerCount: number;
    warningCount: number;
  }>;
  recentAttentionRuns: Array<{
    id: number;
    projectName: string;
    status: string;
    uploadedAt: string;
    sourceFileName: string;
    recordsAttempted: number;
    recordsSucceeded: number;
    recordsFailed: number;
    blockerCount: number;
    warningCount: number;
  }>;
}

export interface SessionData {
  count: number;
  sessions: Array<{
    sid: string;
    userId: number | null;
    userName: string | null;
    username: string | null;
    userRole: string | null;
    expiresAt: string;
  }>;
}

export interface ImportFailure {
  id: number;
  projectName: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
  recordsAttempted: number | null;
  recordsFailed: number | null;
  blockerCount: number;
  topError: string | null;
}

export interface SystemIssue {
  id: number;
  entityType: string;
  entityId: string | null;
  action: string;
  userName: string | null;
  projectName: string | null;
  createdAt: string;
  details: Record<string, unknown> | null;
  requestPath: string | null;
}

export interface OpsExceptionsData {
  unassignedTasks: number;
  unassignedProjects: number;
  blockedItems: number;
  overdueByOwner: { owner: string; count: number }[];
}

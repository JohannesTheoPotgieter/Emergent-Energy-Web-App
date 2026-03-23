/**
 * V2 API Response Schemas & Types
 *
 * Zod schemas for all V2 API endpoints.
 * Types are inferred from schemas for full type safety.
 */

import { z } from "zod";

// ─── Permissions ───────────────────────────────────────────────────

export const projectPermissionsSchema = z.object({
  canView: z.boolean(),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
  canDelete: z.boolean(),
  canManageTeam: z.boolean(),
  canOverrideFinance: z.boolean(),
});
export type ProjectPermissions = z.infer<typeof projectPermissionsSchema>;

// ─── Finance Summary ──────────────────────────────────────────────

export const financeSummarySchema = z.object({
  totalRevenue: z.number(),
  receivedRevenue: z.number(),
  outstandingRevenue: z.number(),
  totalCost: z.number(),
  paidCost: z.number(),
  outstandingCost: z.number(),
  marginPct: z.number().nullable(),
  contractValue: z.number().nullable(),
});
export type FinanceSummaryV2 = z.infer<typeof financeSummarySchema>;

// ─── Plan Summary ─────────────────────────────────────────────────

export const planSummarySchema = z.object({
  taskCount: z.number(),
  tasksCompleted: z.number(),
  tasksInProgress: z.number(),
  tasksOverdue: z.number(),
  tasksActive: z.number(),
  completionPct: z.number().nullable(),
});
export type PlanSummary = z.infer<typeof planSummarySchema>;

// ─── Quality Summary ──────────────────────────────────────────────

export const qualitySummarySchema = z.object({
  checklistProgress: z.number().nullable(),
  openWarnings: z.number(),
});
export type QualitySummary = z.infer<typeof qualitySummarySchema>;

// ─── Team Member ──────────────────────────────────────────────────

export const teamMemberSchema = z.object({
  id: z.number(),
  userId: z.number(),
  userName: z.string().nullable(),
  roleOnProject: z.string(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

// ─── Quality Entity Schemas ──────────────────────────────────────

export const qcChecklistSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  projectName: z.string(),
  templateId: z.number(),
  status: z.string(),
  createdAt: z.coerce.date(),
});
export type QcChecklistV2 = z.infer<typeof qcChecklistSchema>;

export const qcItemInstanceSchema = z.object({
  id: z.number(),
  checklistId: z.number(),
  templateItemId: z.number(),
  isApplicable: z.boolean(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  approved: z.boolean(),
  approvedByUserId: z.number().nullable(),
  approvedAt: z.coerce.date().nullable(),
  approvalComment: z.string().nullable(),
  notApplicableReason: z.string().nullable(),
  workingDays: z.number().nullable(),
  allowedWorkingDays: z.number().nullable(),
  qmStatus: z.string(),
  assigneeUserId: z.number().nullable(),
  lastUpdatedAt: z.coerce.date(),
  scheduledDate: z.string().nullable(),
  scheduledStartTime: z.string().nullable(),
  scheduledEndTime: z.string().nullable(),
});
export type QcItemInstanceV2 = z.infer<typeof qcItemInstanceSchema>;

export const qcItemEvidenceSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  itemInstanceId: z.number(),
  evidenceUrl: z.string(),
  evidenceNote: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type QcItemEvidenceV2 = z.infer<typeof qcItemEvidenceSchema>;

// ─── Engineering Entity Schemas ──────────────────────────────────

export const engStageSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  stageTemplateId: z.number(),
  status: z.string(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  overrideReason: z.string().nullable(),
  createdBy: z.number().nullable(),
  createdAt: z.coerce.date(),
});
export type EngStageV2 = z.infer<typeof engStageSchema>;

export const engDeliverableSchema = z.object({
  id: z.number(),
  projectEngStageId: z.number(),
  deliverableTemplateId: z.number().nullable(),
  projectEngTaskId: z.number().nullable(),
  fileName: z.string(),
  fileSize: z.number().nullable(),
  mimeType: z.string().nullable(),
  storageRef: z.string(),
  uploadedBy: z.number().nullable(),
  uploadedAt: z.coerce.date(),
  versionTag: z.string().nullable(),
  notes: z.string().nullable(),
  sharepointFolderPath: z.string().nullable(),
  approvalStatus: z.string().nullable(),
  approvedBy: z.number().nullable(),
  approvedAt: z.coerce.date().nullable(),
});
export type EngDeliverableV2 = z.infer<typeof engDeliverableSchema>;

// ─── Cashflow Entry ──────────────────────────────────────────────

export const cashflowEntrySchema = z.object({
  status: z.string().nullable(),
  projected: z.number(),
  actual: z.number(),
});
export type CashflowEntry = z.infer<typeof cashflowEntrySchema>;

// ─── Consolidated Project Response ────────────────────────────────

export const projectDetailResponseSchema = z.object({
  project: z.object({
    id: z.number(),
    projectName: z.string(),
    sizeKwp: z.string().nullable(),
    pd: z.string().nullable(),
    pm: z.string().nullable(),
    contractValue: z.string().nullable(),
    clientId: z.number().nullable(),
    pmUserId: z.number().nullable(),
    pdUserId: z.number().nullable(),
  }),
  executionState: z.object({
    phase: z.string().nullable(),
    ragStatus: z.string().nullable(),
    ragComment: z.string().nullable(),
    escalationLevel: z.string().nullable(),
    isActive: z.boolean(),
    archivedStatus: z.string(),
    executionEnabled: z.boolean(),
    executionGateStatus: z.string(),
    signedStatus: z.string(),
    signedDate: z.string().nullable(),
    cpSigned: z.boolean(),
  }).nullable(),
  settings: z.object({
    excelTrackerLink: z.string().nullable(),
  }).nullable(),
  financeSummary: financeSummarySchema,
  planSummary: planSummarySchema,
  qualitySummary: qualitySummarySchema,
  team: z.array(teamMemberSchema),
  permissions: projectPermissionsSchema,
});
export type ProjectDetailResponse = z.infer<typeof projectDetailResponseSchema>;

// ─── Finance Sub-endpoint ─────────────────────────────────────────

export const financeLineSchema = z.object({
  id: z.number(),
  status: z.string().nullable(),
  amountExVat: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  paidDate: z.string().nullable(),
});

export const projectFinanceResponseSchema = z.object({
  costLines: z.array(financeLineSchema),
  revenueLines: z.array(financeLineSchema),
  cashflow: z.array(cashflowEntrySchema),
  permissions: projectPermissionsSchema,
});
export type ProjectFinanceResponse = z.infer<typeof projectFinanceResponseSchema>;

// ─── Plan Sub-endpoint ────────────────────────────────────────────

export const workItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string().nullable(),
  workstream: z.string().nullable(),
  priority: z.string().nullable(),
  ownerUserId: z.number().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isMilestone: z.boolean(),
});

export const projectPlanResponseSchema = z.object({
  workItems: z.array(workItemSchema),
  summary: planSummarySchema,
  permissions: projectPermissionsSchema,
});
export type ProjectPlanResponse = z.infer<typeof projectPlanResponseSchema>;

// ─── Quality Sub-endpoint ─────────────────────────────────────────

export const projectQualityResponseSchema = z.object({
  checklists: z.array(qcChecklistSchema),
  items: z.array(qcItemInstanceSchema),
  evidence: z.array(qcItemEvidenceSchema),
  summary: qualitySummarySchema,
  permissions: projectPermissionsSchema,
});
export type ProjectQualityResponse = z.infer<typeof projectQualityResponseSchema>;

// ─── Engineering Sub-endpoint ─────────────────────────────────────

export const projectEngineeringResponseSchema = z.object({
  stages: z.array(engStageSchema),
  workItems: z.array(workItemSchema),
  deliverables: z.array(engDeliverableSchema),
  permissions: projectPermissionsSchema,
});
export type ProjectEngineeringResponse = z.infer<typeof projectEngineeringResponseSchema>;

// ─── User / Me Endpoint ───────────────────────────────────────────

export const meResponseSchema = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const mePermissionsResponseSchema = z.object({
  role: z.string(),
  permissions: z.array(z.string()),
});
export type MePermissionsResponse = z.infer<typeof mePermissionsResponseSchema>;

// ─── Dashboard Endpoints ──────────────────────────────────────────

export const dashboardTotalsSchema = z.object({
  projects: z.number(),
  openWorkItems: z.number(),
  openProcurement: z.number(),
  pendingInvoices: z.number(),
});
export type DashboardTotals = z.infer<typeof dashboardTotalsSchema>;

export const dashboardRefreshResponseSchema = z.object({
  refreshed: z.boolean(),
  timestamp: z.string(),
});
export type DashboardRefreshResponse = z.infer<typeof dashboardRefreshResponseSchema>;

// ─── Project List Endpoint ────────────────────────────────────────

export const paginationMetaSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

// ─── Project Overview Endpoint ────────────────────────────────────

export const projectHealthResponseSchema = z.object({
  ragStatus: z.string().nullable(),
  escalationLevel: z.string().nullable(),
  margin: z.number(),
});
export type ProjectHealthResponse = z.infer<typeof projectHealthResponseSchema>;

export const projectDevelopmentResponseSchema = z.object({
  pd: z.string().nullable(),
  pdUserId: z.number().nullable(),
  phase: z.string().nullable(),
  pdHandoverDate: z.string().nullable(),
  signedStatus: z.string().nullable(),
});
export type ProjectDevelopmentResponse = z.infer<typeof projectDevelopmentResponseSchema>;

export const developmentHandoverResponseSchema = z.object({
  projectId: z.number(),
  transitionedTo: z.string(),
});
export type DevelopmentHandoverResponse = z.infer<typeof developmentHandoverResponseSchema>;

// ─── Finance Sub-resource Endpoints ───────────────────────────────

export const financeSummaryResponseSchema = z.object({
  cost: z.object({ planned: z.number(), actual: z.number() }),
  revenue: z.object({ planned: z.number(), actual: z.number() }),
  budget: z.object({ total: z.number() }),
  costedSummary: z.unknown().nullable(),
});
export type FinanceSummaryResponse = z.infer<typeof financeSummaryResponseSchema>;

export const financeCashflowResponseSchema = z.object({
  byStatus: z.array(cashflowEntrySchema),
});
export type FinanceCashflowResponse = z.infer<typeof financeCashflowResponseSchema>;

export const financeCosResponseSchema = z.object({
  lines: z.array(financeLineSchema.extend({ poNumber: z.string().nullable() })),
});
export type FinanceCosResponse = z.infer<typeof financeCosResponseSchema>;

export const financeRevenueResponseSchema = z.object({
  lines: z.array(financeLineSchema.extend({ expectedPaymentDate: z.string().nullable() })),
});
export type FinanceRevenueResponse = z.infer<typeof financeRevenueResponseSchema>;

export const financeExpenditureResponseSchema = z.object({
  committed: z.array(financeLineSchema.extend({ poNumber: z.string().nullable() })),
  planned: z.array(financeLineSchema.extend({ poNumber: z.string().nullable() })),
});
export type FinanceExpenditureResponse = z.infer<typeof financeExpenditureResponseSchema>;

// ─── Lookup Endpoint ──────────────────────────────────────────────

export const lookupUserSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  role: z.string().nullable(),
});
export type LookupUser = z.infer<typeof lookupUserSchema>;

// ─── Legacy Project / Task DTOs ───────────────────────────────────

export const legacyProjectDtoSchema = z.object({
  id: z.number(),
  name: z.string(),
  code: z.string(),
  manager: z.string(),
  site: z.string(),
  status: z.string(),
  stage: z.string(),
  startDate: z.string(),
  completionDate: z.string(),
  budget: z.string(),
  lastUpdated: z.coerce.date(),
});
export type LegacyProjectDto = z.infer<typeof legacyProjectDtoSchema>;

export const legacyTaskDtoSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  taskName: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  progress: z.number(),
  status: z.string(),
  assignee: z.string(),
  createdAt: z.coerce.date(),
});
export type LegacyTaskDto = z.infer<typeof legacyTaskDtoSchema>;

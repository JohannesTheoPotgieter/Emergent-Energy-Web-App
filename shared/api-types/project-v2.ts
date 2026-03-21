/**
 * Prompt 14 — V2 API Response Schemas & Types
 *
 * Zod schemas for consolidated project endpoints.
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
  cashflow: z.any(),
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
  checklists: z.array(z.any()),
  items: z.array(z.any()),
  evidence: z.array(z.any()),
  summary: qualitySummarySchema,
  permissions: projectPermissionsSchema,
});
export type ProjectQualityResponse = z.infer<typeof projectQualityResponseSchema>;

// ─── Engineering Sub-endpoint ─────────────────────────────────────

export const projectEngineeringResponseSchema = z.object({
  stages: z.array(z.any()),
  workItems: z.array(workItemSchema),
  deliverables: z.array(z.any()),
  permissions: projectPermissionsSchema,
});
export type ProjectEngineeringResponse = z.infer<typeof projectEngineeringResponseSchema>;

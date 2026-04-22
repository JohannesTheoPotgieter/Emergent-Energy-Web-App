/**
 * SSEG Submissions Repository
 *
 * Thin repository over the existing `sseg_applications` and `project_info`
 * tables. The canonical SSEG submissions screen (Project Delivery →
 * "SSEG submissions") reads from this repository — no direct db queries
 * in the route handler.
 *
 * Reuses existing schema:
 *   - ssegApplications  (shared/schema/role-based-upgrade.ts)
 *   - projectInfo       (shared/schema/projects.ts)
 *
 * No new tables, no migrations.
 */
import { db } from "../db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ssegApplications } from "@shared/schema/role-based-upgrade";
import { projectInfo, sites } from "@shared/schema/projects";

export interface SsegSubmissionRow {
  id: number;
  projectId: number;
  projectName: string | null;
  municipality: string | null;
  authority: string | null;
  nrsType: string | null;
  applicationStage: string;
  referenceNumber: string | null;
  submissionDate: string | null;
  approvalDate: string | null;
  expiryDate: string | null;
  responseDueDate: string | null;
}

export interface SsegSubmissionKpis {
  underReview: number;
  approved30d: number;
  cocPending: number;
  rejectionsYtd: number;
}

const UNDER_REVIEW_STAGES = new Set([
  "submitted",
  "query_received",
  "response_sent",
  "under_review",
]);

const REJECTED_STAGES = new Set(["rejected", "expired"]);

export const ssegSubmissionsRepository = {
  async list(opts: { projectId?: number } = {}): Promise<SsegSubmissionRow[]> {
    const conditions = [isNull(ssegApplications.deletedAt)];
    if (opts.projectId) conditions.push(eq(ssegApplications.projectId, opts.projectId));

    const rows = await db
      .select({
        id: ssegApplications.id,
        projectId: ssegApplications.projectId,
        projectName: projectInfo.projectName,
        municipality: sites.municipality,
        authority: ssegApplications.authority,
        applicationStage: ssegApplications.applicationStage,
        referenceNumber: ssegApplications.referenceNumber,
        submissionDate: ssegApplications.submissionDate,
        approvalDate: ssegApplications.approvalDate,
        expiryDate: ssegApplications.expiryDate,
        responseDueDate: ssegApplications.responseDueDate,
      })
      .from(ssegApplications)
      .leftJoin(projectInfo, eq(projectInfo.id, ssegApplications.projectId))
      .leftJoin(sites, eq(sites.id, ssegApplications.siteId))
      .where(and(...conditions))
      .orderBy(desc(ssegApplications.updatedAt))
      .limit(500);

    return rows.map((r: typeof rows[number]) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName ?? null,
      municipality: r.municipality ?? null,
      authority: r.authority ?? null,
      // NRS type isn't a separate column — surface authority as a stand-in
      // until/unless a dedicated nrs_type column is added. Keep separate
      // field on the DTO so the UI doesn't need to assume.
      nrsType: r.authority ?? null,
      applicationStage: r.applicationStage,
      referenceNumber: r.referenceNumber ?? null,
      submissionDate: r.submissionDate ? String(r.submissionDate) : null,
      approvalDate: r.approvalDate ? String(r.approvalDate) : null,
      expiryDate: r.expiryDate ? String(r.expiryDate) : null,
      responseDueDate: r.responseDueDate ? String(r.responseDueDate) : null,
    }));
  },

  async kpis(): Promise<SsegSubmissionKpis> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [counts] = await db
      .select({
        underReview: sql<number>`SUM(CASE WHEN ${ssegApplications.applicationStage} IN ('submitted','query_received','response_sent','under_review') THEN 1 ELSE 0 END)`,
        approved30d: sql<number>`SUM(CASE WHEN ${ssegApplications.applicationStage} = 'approved' AND ${ssegApplications.approvalDate} >= ${thirtyDaysAgo.toISOString().slice(0, 10)} THEN 1 ELSE 0 END)`,
        cocPending: sql<number>`SUM(CASE WHEN ${ssegApplications.applicationStage} = 'approved' AND ${ssegApplications.expiryDate} IS NULL THEN 1 ELSE 0 END)`,
        rejectionsYtd: sql<number>`SUM(CASE WHEN ${ssegApplications.applicationStage} IN ('rejected','expired') AND ${ssegApplications.updatedAt} >= ${yearStart.toISOString()} THEN 1 ELSE 0 END)`,
      })
      .from(ssegApplications)
      .where(isNull(ssegApplications.deletedAt));

    return {
      underReview: Number(counts?.underReview ?? 0),
      approved30d: Number(counts?.approved30d ?? 0),
      cocPending: Number(counts?.cocPending ?? 0),
      rejectionsYtd: Number(counts?.rejectionsYtd ?? 0),
    };
  },
};

export const SSEG_SUBMISSION_STAGE_GROUPS = {
  underReview: UNDER_REVIEW_STAGES,
  rejected: REJECTED_STAGES,
};

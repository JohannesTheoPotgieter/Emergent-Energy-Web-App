import { db } from "../db";
import { users, COMPANY_ROLE_LABELS } from "@shared/schema/users";
import { projectInfo, projectExecutionState, projectTeamMembers } from "@shared/schema/projects";
import { workItems, workItemAssignments } from "@shared/schema/tasks";
import { and, eq, isNull, sql } from "drizzle-orm";

export type TeamSummary = {
  headcount: number | null;
  avgUtilisation: number | null;
  overAllocated: number | null;
  openRoles: number | null;
};

export type TeamPerson = {
  id: number;
  fullName: string;
  initials: string;
  jobTitle: string | null;
  location: string | null;
  utilisationPct: number | null;
  activeProjectCount: number | null;
  status: string;
};

export type CompanyTeamData = {
  summary: TeamSummary;
  people: TeamPerson[];
  meta: {
    refreshedAt: string;
    confidence: "high" | "partial" | "low";
    sourceNotes: string[];
  };
};

const ACTIVE_WORK_ITEM_STATUSES_EXCLUDED = sql`${workItems.status} NOT IN ('done','complete','completed','cancelled','closed')`;

function computeInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export async function getCompanyTeamData(): Promise<CompanyTeamData> {
  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      department: users.department,
    })
    .from(users)
    .where(isNull(users.deletedAt));

  const allocationRows = await db
    .select({
      userId: workItemAssignments.userId,
      totalAllocation: sql<number | null>`SUM(${workItemAssignments.allocationPct})`,
      nonNullAllocCount: sql<number>`COUNT(${workItemAssignments.allocationPct})`,
    })
    .from(workItemAssignments)
    .innerJoin(workItems, eq(workItems.id, workItemAssignments.workItemId))
    .where(and(isNull(workItems.deletedAt), ACTIVE_WORK_ITEM_STATUSES_EXCLUDED))
    .groupBy(workItemAssignments.userId);

  const allocationByUser = new Map<number, { totalAllocation: number | null; nonNullAllocCount: number }>();
  for (const r of allocationRows) {
    allocationByUser.set(r.userId, {
      totalAllocation: r.totalAllocation == null ? null : Number(r.totalAllocation),
      nonNullAllocCount: Number(r.nonNullAllocCount ?? 0),
    });
  }

  const activeTeamRows = await db
    .selectDistinct({
      userId: projectTeamMembers.userId,
      projectId: projectTeamMembers.projectId,
    })
    .from(projectTeamMembers)
    .innerJoin(projectInfo, eq(projectInfo.id, projectTeamMembers.projectId))
    .where(and(isNull(projectInfo.deletedAt), eq(projectInfo.projectStatus, "active")));

  const activeProjectsByUser = new Map<number, Set<number>>();
  for (const r of activeTeamRows) {
    if (r.userId == null || r.projectId == null) continue;
    if (!activeProjectsByUser.has(r.userId)) activeProjectsByUser.set(r.userId, new Set());
    activeProjectsByUser.get(r.userId)!.add(r.projectId);
  }

  const activeProjects = await db
    .select({
      id: projectInfo.id,
      pmUserId: projectInfo.pmUserId,
      pdUserId: projectInfo.pdUserId,
      constructionManagerUserId: projectExecutionState.constructionManagerUserId,
      qualityLeadUserId: projectExecutionState.qualityLeadUserId,
      engineeringLeadUserId: projectExecutionState.engineeringLeadUserId,
      programManagerUserId: projectExecutionState.programManagerUserId,
      projectFinanceUserId: projectExecutionState.projectFinanceUserId,
      kamUserId: projectExecutionState.kamUserId,
    })
    .from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
    .where(and(isNull(projectInfo.deletedAt), eq(projectInfo.projectStatus, "active")));

  const leadColumns = [
    "pmUserId",
    "pdUserId",
    "constructionManagerUserId",
    "qualityLeadUserId",
    "engineeringLeadUserId",
    "programManagerUserId",
    "projectFinanceUserId",
    "kamUserId",
  ] as const;

  let openRoles = 0;
  for (const p of activeProjects) {
    for (const col of leadColumns) {
      const val = (p as Record<string, number | null | undefined>)[col];
      if (val == null) {
        openRoles++;
      } else {
        if (!activeProjectsByUser.has(val)) activeProjectsByUser.set(val, new Set());
        activeProjectsByUser.get(val)!.add(p.id);
      }
    }
  }

  const hasAnyActiveProjects = activeProjects.length > 0;
  const hasAnyAllocationData = allocationRows.length > 0;

  const people: TeamPerson[] = allUsers.map((u: typeof allUsers[number]) => {
    const alloc = allocationByUser.get(u.id);
    const totalAlloc = alloc?.totalAllocation ?? null;
    const hasAlloc = !!alloc && alloc.nonNullAllocCount > 0 && totalAlloc != null;
    const labelMap = COMPANY_ROLE_LABELS as Record<string, string>;
    const jobTitle = u.role && labelMap[u.role] ? labelMap[u.role] : null;
    return {
      id: u.id,
      fullName: u.name,
      initials: computeInitials(u.name),
      jobTitle,
      location: null,
      utilisationPct: hasAlloc ? Math.round(totalAlloc as number) : null,
      activeProjectCount: hasAnyActiveProjects ? (activeProjectsByUser.get(u.id)?.size ?? 0) : null,
      status: "active",
    };
  });

  const headcount = people.length > 0 ? people.length : null;
  const utilPeople = people.filter((p) => p.utilisationPct != null);
  const avgUtilisationPct =
    utilPeople.length > 0
      ? Math.round(
          utilPeople.reduce((s, p) => s + (p.utilisationPct as number), 0) / utilPeople.length,
        )
      : null;
  const overAllocatedCount =
    utilPeople.length > 0
      ? utilPeople.filter((p) => (p.utilisationPct as number) > 100).length
      : null;

  const sourceNotes: string[] = [];
  sourceNotes.push("Headcount derived from active users (users.deleted_at IS NULL).");
  if (hasAnyAllocationData) {
    sourceNotes.push("Utilisation derived from work_item_assignments.allocation_pct across non-closed work_items.");
  } else {
    sourceNotes.push("Utilisation unavailable — no allocation data on active work items.");
  }
  if (hasAnyActiveProjects) {
    sourceNotes.push("Active project counts derived from project_team_members and project execution lead columns on active projects.");
    sourceNotes.push("Open roles counted as NULL functional lead slots on active projects (pm, pd, construction, quality, engineering, program, project_finance, kam).");
  } else {
    sourceNotes.push("No active projects — active project counts and open roles are unavailable.");
  }
  sourceNotes.push("Location is not yet captured on user profiles and is reported as null.");

  let confidence: "high" | "partial" | "low";
  if (hasAnyAllocationData && hasAnyActiveProjects) {
    confidence = "high";
  } else if (hasAnyAllocationData || hasAnyActiveProjects) {
    confidence = "partial";
  } else {
    confidence = "low";
  }

  return {
    summary: {
      headcount,
      avgUtilisation: avgUtilisationPct,
      overAllocated: overAllocatedCount,
      openRoles: hasAnyActiveProjects ? openRoles : null,
    },
    people: people.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    meta: {
      refreshedAt: new Date().toISOString(),
      confidence,
      sourceNotes,
    },
  };
}

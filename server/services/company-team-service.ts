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
  /**
   * Open work-item count fallback used **only** when no allocation_pct is
   * recorded for this user (i.e. when `utilisationPct` is null). The two
   * fields are mutually exclusive — exactly one is populated at a time, or
   * both are null.
   */
  activeWorkItemCount: number | null;
  status: "active" | "inactive";
};

type PersonInput = {
  id: number;
  name: string;
  role: string | null;
  location: string | null;
  isActive: boolean;
};

/** Narrow a `db.execute` result to a typed row array regardless of driver. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * Pure mapping from raw signal flags to a `confidence` label. Extracted
 * for unit testing — covers the architect's edge case where active
 * projects exist but no user-project membership signals do (which would
 * otherwise overstate "high" confidence even though every active-project
 * count would render as 0).
 */
export function computeConfidence(input: {
  hasAnyAllocationData: boolean;
  hasAnyProjectMembershipSignals: boolean;
  hasAnyActiveWorkItems: boolean;
}): "high" | "partial" | "low" {
  if (input.hasAnyAllocationData && input.hasAnyProjectMembershipSignals) {
    return "high";
  }
  if (
    input.hasAnyAllocationData ||
    input.hasAnyProjectMembershipSignals ||
    input.hasAnyActiveWorkItems
  ) {
    return "partial";
  }
  return "low";
}

/**
 * Pure mapping from raw aggregates to TeamPerson rows. Extracted for unit
 * testing — covers `status` derivation from `isActive`, mutual exclusivity
 * of `utilisationPct` vs `activeWorkItemCount`, and location passthrough.
 */
export function assembleTeamPeople(input: {
  users: PersonInput[];
  allocationByUser: Map<number, { totalAllocation: number | null; nonNullAllocCount: number }>;
  activeProjectsByUser: Map<number, Set<number>>;
  activeWorkItemsByUser: Map<number, number>;
  hasAnyActiveProjects: boolean;
  hasAnyActiveWorkItems: boolean;
}): TeamPerson[] {
  const labelMap = COMPANY_ROLE_LABELS as Record<string, string>;
  return input.users.map((u) => {
    const alloc = input.allocationByUser.get(u.id);
    const totalAlloc = alloc?.totalAllocation ?? null;
    const hasAlloc = !!alloc && alloc.nonNullAllocCount > 0 && totalAlloc != null;
    const utilisationPct = hasAlloc ? Math.round(totalAlloc as number) : null;
    const rawWorkItemCount = input.hasAnyActiveWorkItems
      ? (input.activeWorkItemsByUser.get(u.id) ?? 0)
      : null;
    // Mutual exclusivity: only surface the work-item count fallback when
    // we have no real utilisation %. This keeps the UI contract honest
    // ("Utilisation" vs "Active Items" — never both).
    const activeWorkItemCount = utilisationPct != null ? null : rawWorkItemCount;
    return {
      id: u.id,
      fullName: u.name,
      initials: computeInitials(u.name),
      jobTitle: u.role && labelMap[u.role] ? labelMap[u.role] : null,
      location: u.location ?? null,
      utilisationPct,
      activeProjectCount: input.hasAnyActiveProjects
        ? (input.activeProjectsByUser.get(u.id)?.size ?? 0)
        : null,
      activeWorkItemCount,
      status: u.isActive ? "active" : "inactive",
    };
  });
}

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
  // Show every non-purged user. The codebase has no `is_active` column on
  // `users` — soft-delete via `deleted_at` IS the source of truth, so we
  // derive `status` from that and surface inactive users with a pill
  // instead of hiding them.
  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      department: users.department,
      location: users.location,
      deletedAt: users.deletedAt,
    })
    .from(users);

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

  // Active work-item count per user. Counts each work_item once even if
  // a user is both owner and assignee on it (DISTINCT). Restricted to
  // work_items that are not soft-deleted and not in a closed status,
  // matching the same gating as the allocation aggregate.
  const activeWorkItemRows = await db.execute(sql`
    SELECT user_id, COUNT(DISTINCT work_item_id) AS cnt FROM (
      SELECT wi.id AS work_item_id, wi.owner_user_id AS user_id
        FROM work_items wi
       WHERE wi.deleted_at IS NULL
         AND wi.owner_user_id IS NOT NULL
         AND wi.status NOT IN ('done','complete','completed','cancelled','closed')
      UNION ALL
      SELECT wi.id AS work_item_id, wia.user_id AS user_id
        FROM work_item_assignments wia
        INNER JOIN work_items wi ON wi.id = wia.work_item_id
       WHERE wi.deleted_at IS NULL
         AND wia.user_id IS NOT NULL
         AND wi.status NOT IN ('done','complete','completed','cancelled','closed')
    ) AS x
    GROUP BY user_id
  `);
  const activeWorkItemRowsArr = rowsOf<{ user_id: number; cnt: number }>(activeWorkItemRows);
  const activeWorkItemsByUser = new Map<number, number>();
  for (const r of activeWorkItemRowsArr) {
    if (r.user_id == null) continue;
    activeWorkItemsByUser.set(Number(r.user_id), Number(r.cnt ?? 0));
  }
  const hasAnyActiveWorkItems = activeWorkItemsByUser.size > 0;

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

  // Broaden active-project signal so people who are working on an active
  // project (via owned or assigned active work items) are counted even
  // when they aren't on a functional lead column. This is what made the
  // previous version show 0 active projects for everyone other than a
  // handful of PMs — the lead columns are very sparsely populated today.
  const projectMembershipRows = await db.execute(sql`
    SELECT DISTINCT user_id, project_id FROM (
      SELECT wi.owner_user_id AS user_id, wi.project_id AS project_id
        FROM work_items wi
        INNER JOIN project_info pi ON pi.id = wi.project_id
       WHERE wi.deleted_at IS NULL
         AND wi.owner_user_id IS NOT NULL
         AND wi.project_id IS NOT NULL
         AND pi.deleted_at IS NULL
         AND pi.project_status = 'active'
         AND wi.status NOT IN ('done','complete','completed','cancelled','closed')
      UNION ALL
      SELECT wia.user_id AS user_id, wi.project_id AS project_id
        FROM work_item_assignments wia
        INNER JOIN work_items wi ON wi.id = wia.work_item_id
        INNER JOIN project_info pi ON pi.id = wi.project_id
       WHERE wi.deleted_at IS NULL
         AND wia.user_id IS NOT NULL
         AND wi.project_id IS NOT NULL
         AND pi.deleted_at IS NULL
         AND pi.project_status = 'active'
         AND wi.status NOT IN ('done','complete','completed','cancelled','closed')
    ) AS x
  `);
  const membershipRowsArr = rowsOf<{ user_id: number; project_id: number }>(projectMembershipRows);
  for (const r of membershipRowsArr) {
    const uid = Number(r.user_id);
    const pid = Number(r.project_id);
    if (!Number.isFinite(uid) || !Number.isFinite(pid)) continue;
    if (!activeProjectsByUser.has(uid)) activeProjectsByUser.set(uid, new Set());
    activeProjectsByUser.get(uid)!.add(pid);
  }

  const hasAnyActiveProjects = activeProjects.length > 0;
  const hasAnyAllocationData = allocationRows.some(
    (r: (typeof allocationRows)[number]) => Number(r.nonNullAllocCount ?? 0) > 0,
  );

  const people = assembleTeamPeople({
    users: allUsers.map((u: (typeof allUsers)[number]) => ({
      id: u.id,
      name: u.name,
      role: u.role ?? null,
      location: u.location ?? null,
      // Active = not soft-deleted. There's no separate `is_active` flag
      // in this codebase; `deleted_at IS NULL` is the source of truth.
      isActive: u.deletedAt == null,
    })),
    allocationByUser,
    activeProjectsByUser,
    activeWorkItemsByUser,
    hasAnyActiveProjects,
    hasAnyActiveWorkItems,
  });

  // Headcount excludes soft-deleted (`status === "inactive"`) users so the
  // KPI mirrors the previous "active-only" semantics. The full list still
  // includes inactive users with a status pill so admins can see them.
  const activePeople = people.filter((p) => p.status === "active");
  const headcount = activePeople.length > 0 ? activePeople.length : null;
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
  } else if (hasAnyActiveWorkItems) {
    sourceNotes.push("Utilisation unavailable — no allocation_pct values are recorded on active work items. Showing active item counts as a proxy.");
  } else {
    sourceNotes.push("Utilisation unavailable — no allocation_pct values are recorded and no active work items are assigned.");
  }
  if (hasAnyActiveProjects) {
    sourceNotes.push("Active project counts derived from project_team_members, project lead columns, and active work items (owner or assignee) on active projects.");
    sourceNotes.push("Open roles counted as NULL functional lead slots on active projects (pm, pd, construction, quality, engineering, program, project_finance, kam).");
  } else {
    sourceNotes.push("No active projects — active project counts and open roles are unavailable.");
  }
  if (hasAnyActiveWorkItems) {
    sourceNotes.push("Active item counts derived from work_items (owner_user_id) and work_item_assignments where the work item is open and not soft-deleted.");
  }
  sourceNotes.push("Location is captured on user profiles (users.location); editable from Admin > Roles & Permissions > Users.");

  const hasAnyProjectMembershipSignals = activeProjectsByUser.size > 0;
  const confidence = computeConfidence({
    hasAnyAllocationData,
    hasAnyProjectMembershipSignals,
    hasAnyActiveWorkItems,
  });

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

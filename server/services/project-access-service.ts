/**
 * Project Access Service — Row-Level Security (RLS)
 *
 * Resolves which projects a user can access based on their role and assignments.
 * Full-oversight roles bypass all filtering (zero DB queries).
 * Scoped roles see only projects they are assigned to via:
 *   1. pmUserId / pdUserId on project_info
 *   2. project_team_members join table
 *   3. entity_assignments where assignee is the user
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { projectInfo, projectTeamMembers, entityAssignments } from "@shared/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectScope =
  | { kind: "full_oversight" }
  | { kind: "scoped"; projectIds: Set<number>; projectNames: Set<string> };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Roles that see ALL projects and company-wide KPIs.
 * Everyone else is scoped to their assigned projects.
 */
export const FULL_OVERSIGHT_ROLES: readonly string[] = [
  "admin",
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "CFO",
  "PROGRAM_MANAGER",
  "CONSTRUCTION_MANAGER",
  "PROGRAM_FINANCE_MANAGER",
  "ACCOUNTANT",
] as const;

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the project scope for a given user.
 *
 * - Full-oversight roles return immediately with zero DB queries.
 * - Scoped roles run 3 parallel queries to determine accessible projects.
 */
export async function resolveProjectScope(
  userId: number,
  userRole: string,
  _userName: string,
): Promise<ProjectScope> {
  if (FULL_OVERSIGHT_ROLES.includes(userRole)) {
    return { kind: "full_oversight" };
  }

  const projectIds = new Set<number>();
  const projectNames = new Set<string>();

  // Run three lookups in parallel
  const [ownedProjects, teamProjects, assignmentProjects] = await Promise.all([
    // 1. Projects where user is PM or PD
    db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(
        and(
          eq(projectInfo.isActive, true),
          sql`(${projectInfo.pmUserId} = ${userId} OR ${projectInfo.pdUserId} = ${userId})`,
        ),
      ),

    // 2. Projects via project_team_members
    db
      .select({
        projectName: projectTeamMembers.projectName,
        projectId: projectInfo.id,
      })
      .from(projectTeamMembers)
      .innerJoin(
        projectInfo,
        eq(projectInfo.projectName, projectTeamMembers.projectName),
      )
      .where(
        and(
          eq(projectTeamMembers.userId, userId),
          eq(projectInfo.isActive, true),
        ),
      ),

    // 3. Projects via entity_assignments
    db
      .select({ projectId: entityAssignments.projectId })
      .from(entityAssignments)
      .where(
        and(
          eq(entityAssignments.assigneeType, "internal_user"),
          eq(entityAssignments.assigneeId, userId),
          eq(entityAssignments.active, true),
          isNotNull(entityAssignments.projectId),
        ),
      ),
  ]);

  for (const row of ownedProjects) {
    projectIds.add(row.id);
    projectNames.add(row.projectName);
  }

  for (const row of teamProjects) {
    if (row.projectId != null) projectIds.add(row.projectId);
    projectNames.add(row.projectName);
  }

  for (const row of assignmentProjects) {
    if (row.projectId != null) projectIds.add(row.projectId);
  }

  // For assignment-derived IDs that don't have names yet, resolve them
  if (projectIds.size > 0) {
    const missingNameIds = [...projectIds].filter(
      (id) => ![...ownedProjects, ...teamProjects].some((r) => (r as any).id === id || (r as any).projectId === id),
    );
    if (missingNameIds.length > 0) {
      const nameRows = await db
        .select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo)
        .where(
          sql`${projectInfo.id} IN (${sql.join(
            missingNameIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      for (const row of nameRows) {
        projectNames.add(row.projectName);
      }
    }
  }

  return { kind: "scoped", projectIds, projectNames };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a single project ID is accessible under the given scope. */
export function isProjectAccessible(
  scope: ProjectScope,
  projectId: number,
): boolean {
  if (scope.kind === "full_oversight") return true;
  return scope.projectIds.has(projectId);
}

/** Check if a project name is accessible under the given scope. */
export function isProjectAccessibleByName(
  scope: ProjectScope,
  projectName: string,
): boolean {
  if (scope.kind === "full_oversight") return true;
  return scope.projectNames.has(projectName);
}

/**
 * Returns the set of project IDs for repository-level filtering,
 * or null if the user has full oversight (no filtering needed).
 */
export function scopeProjectIds(scope: ProjectScope): Set<number> | null {
  if (scope.kind === "full_oversight") return null;
  return scope.projectIds;
}

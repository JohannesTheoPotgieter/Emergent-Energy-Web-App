import { eq, isNull, sql, inArray, count } from "drizzle-orm";
import { projectInfo, projectExecutionState } from "@shared/schema";
import { db } from "../db";

export class ProjectStateRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async markProjectsActive(activeNames: string[]): Promise<void> {
    if (activeNames.length === 0) return;

    // Touch updated_at on project_info for active projects (identity-table timestamp only).
    // NOTE: is_active was dropped from project_info in migration 20260337.
    // The Drizzle schema no longer includes isActive on projectInfo, so the
    // previous Drizzle writes of isActive were silently ignored (op 1) or
    // produced invalid SQL (op 2).  Removed in this remediation —
    // project_execution_state is the sole source of truth.
    await this.dbInstance
      .update(projectInfo)
      .set({ updatedAt: new Date() })
      .where(inArray(projectInfo.projectName, activeNames));

    // Canonical state writes: project_execution_state owns active/archived.
    // is_active is maintained alongside deleted_at during the 30-day
    // observation window (deprecated 2026-03-31).
    await this.dbInstance.execute(sql`
      UPDATE project_execution_state SET deleted_at = NULL, is_active = true, updated_at = NOW()
      WHERE project_id IN (SELECT id FROM project_info WHERE project_name = ANY(${activeNames}))
    `);
    await this.dbInstance.execute(sql`
      UPDATE project_execution_state SET deleted_at = NOW(), is_active = false, updated_at = NOW()
      WHERE project_id IN (SELECT id FROM project_info WHERE project_name != ALL(${activeNames}))
        AND deleted_at IS NULL
    `);
  }

  async getProjectCounts(): Promise<{ active: number; historical: number; total: number }> {
    const [activeResult] = await this.dbInstance
      .select({ count: count() })
      .from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
      .where(isNull(projectExecutionState.deletedAt));
    const [totalResult] = await this.dbInstance
      .select({ count: count() })
      .from(projectInfo);
    const active = activeResult?.count || 0;
    const total = totalResult?.count || 0;
    return { active, historical: total - active, total };
  }
}

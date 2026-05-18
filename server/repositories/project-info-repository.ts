import { eq, ilike, inArray } from "drizzle-orm";
import { projectInfo, projectExecutionState, type InsertProjectInfo, type ProjectInfo, type UpdateProjectInfoFields } from "@shared/schema";
import { db } from "../db";
import { syncProjectSplitTables, syncProjectSplitTablesAfterInsert } from "../lib/project-info-sync";

export class ProjectInfoRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async updateById(id: number, fields: UpdateProjectInfoFields): Promise<ProjectInfo | undefined> {
    // `fields` may carry project_execution_state / project_settings columns
    // (e.g. escalationLevel, phase); those are routed to their own tables by
    // syncProjectSplitTables below. The project_info UPDATE only consumes the
    // InsertProjectInfo subset — narrow here so the typed query builder is
    // accurate rather than relying on Drizzle to drop unknown keys.
    const projectInfoFields = fields as Partial<InsertProjectInfo>;
    const [updated] = await this.dbInstance
      .update(projectInfo)
      .set({ ...projectInfoFields, updatedAt: new Date() })
      .where(eq(projectInfo.id, id))
      .returning();
    if (updated) {
      await syncProjectSplitTables(id, fields, this.dbInstance);
    }
    return updated;
  }

  /**
   * All project_info rows joined with project_execution_state. Returns the
   * raw shape `{ project_info, project_execution_state | null }` so callers
   * can flatten the way they need.
   *
   * NOTE: also added independently in Wave 5.4 (PR #820); resolve any
   * merge collision by keeping a single copy.
   */
  async listAllWithExecutionState(): Promise<Array<{
    project_info: ProjectInfo;
    project_execution_state: typeof projectExecutionState.$inferSelect | null;
  }>> {
    return this.dbInstance
      .select()
      .from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));
  }

  /**
   * Project-name-only projection of `project_info`. Used by reconciliation
   * surfaces (cost-side, revenue-side, QB class/customer overrides) that
   * just need the universe of known project names without paying for a
   * full row read. Mirrors the shape used by
   * `listActiveCostLineProjectNames` / `listActiveRevenueLineProjectNames`
   * so the call sites can union them with `Set<string>` semantics.
   */
  async listAllProjectNames(): Promise<Array<{ name: string | null }>> {
    return this.dbInstance
      .select({ name: projectInfo.projectName })
      .from(projectInfo);
  }

  async findIdByProjectName(projectName: string): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ id: projectInfo.id })
      .from(projectInfo)
      .where(eq(projectInfo.projectName, projectName))
      .limit(1);
    return row?.id ?? null;
  }

  async upsert(info: InsertProjectInfo, existing: ProjectInfo | undefined): Promise<ProjectInfo> {
    if (existing) {
      // `info` may carry project_execution_state columns (e.g.
      // `executionEnabled`) at runtime; that key is routed via the split
      // tables, so strip it off the project_info UPDATE set. Viewing `info`
      // as the merged UpdateProjectInfoFields shape keeps this `any`-free.
      const updateFields: Partial<UpdateProjectInfoFields> = {
        ...(info as UpdateProjectInfoFields),
      };
      delete updateFields.executionEnabled;
      const [updated] = await this.dbInstance
        .update(projectInfo)
        .set({ ...updateFields, updatedAt: new Date() })
        .where(eq(projectInfo.projectName, info.projectName))
        .returning();
      await syncProjectSplitTables(updated.id, updateFields, this.dbInstance);
      return updated;
    }
    const insertFields = { ...info, executionEnabled: false, updatedAt: new Date() };
    const [created] = await this.dbInstance.insert(projectInfo).values(insertFields).returning();
    await syncProjectSplitTablesAfterInsert(created.id, insertFields, this.dbInstance);
    return created;
  }

  /**
   * All `project_info` rows. Used by reporting surfaces that want every
   * known project (with phase/RAG/owner fields) without paying for the
   * `project_execution_state` left-join.
   */
  async listAll(): Promise<ProjectInfo[]> {
    return this.dbInstance.select().from(projectInfo);
  }

  /**
   * Case-insensitive substring search on `project_name`, returning just
   * the matching ids. Used by the reports module to filter work items by
   * a project-name fragment supplied via query string.
   */
  async findIdsByNameLike(filter: string): Promise<number[]> {
    if (!filter) return [];
    const rows = await this.dbInstance
      .select({ id: projectInfo.id })
      .from(projectInfo)
      .where(ilike(projectInfo.projectName, `%${filter}%`));
    return rows.map((r: { id: number }) => r.id);
  }

  /**
   * Bulk id → projectName projection. Used by reports that need to map
   * `work_items.projectId` values back to the human-readable project name
   * without paying for a full `select(projectInfo)` per row.
   */
  async listIdNameByIds(ids: number[]): Promise<Array<{ id: number; projectName: string }>> {
    if (ids.length === 0) return [];
    return this.dbInstance
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, ids));
  }
}

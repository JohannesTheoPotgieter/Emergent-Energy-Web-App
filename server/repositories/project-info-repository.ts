import { eq, inArray, sql } from "drizzle-orm";
import { projectInfo, projectExecutionState, type InsertProjectInfo, type ProjectInfo } from "@shared/schema";
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

  async updateById(id: number, fields: Partial<InsertProjectInfo>): Promise<ProjectInfo | undefined> {
    const [updated] = await this.dbInstance
      .update(projectInfo)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(projectInfo.id, id))
      .returning();
    if (updated) {
      await syncProjectSplitTables(id, fields, this.dbInstance);
    }
    return updated;
  }

  async listAll(): Promise<ProjectInfo[]> {
    return this.dbInstance.select().from(projectInfo);
  }

  /**
   * All project_info rows joined with project_execution_state. Returns the
   * raw shape `{ project_info, project_execution_state | null }` so callers
   * can flatten the way they need (with null-coalescing for projects that
   * have no execution-state row).
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

  async findIdsByNameLike(query: string): Promise<number[]> {
    const rows = await this.dbInstance
      .select({ id: projectInfo.id })
      .from(projectInfo)
      .where(sql`${projectInfo.projectName} ILIKE ${'%' + query + '%'}`);
    return rows.map((r: { id: number }) => r.id);
  }

  async listIdNameByIds(ids: number[]): Promise<Array<{ id: number; projectName: string }>> {
    if (ids.length === 0) return [];
    return this.dbInstance
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, ids));
  }

  async upsert(info: InsertProjectInfo, existing: ProjectInfo | undefined): Promise<ProjectInfo> {
    if (existing) {
      const { executionEnabled, ...updateFields } = info as any;
      const [updated] = await this.dbInstance
        .update(projectInfo)
        .set({ ...updateFields, updatedAt: new Date() })
        .where(eq(projectInfo.projectName, (info as any).projectName))
        .returning();
      await syncProjectSplitTables(updated.id, updateFields, this.dbInstance);
      return updated;
    }
    const insertFields = { ...info, executionEnabled: false, updatedAt: new Date() };
    const [created] = await this.dbInstance.insert(projectInfo).values(insertFields).returning();
    await syncProjectSplitTablesAfterInsert(created.id, insertFields as any, this.dbInstance);
    return created;
  }
}

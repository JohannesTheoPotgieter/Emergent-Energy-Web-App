import { eq } from "drizzle-orm";
import { projectInfo, type InsertProjectInfo, type ProjectInfo } from "@shared/schema";
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

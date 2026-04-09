import { eq, desc } from "drizzle-orm";
import { projectInfo, projectExecutionState } from "@shared/schema";
import { db } from "../db";
import {
  shouldUseLegacyProjectInfoReadFallback,
  listLegacyCompatibleProjectInfo,
} from "../lib/project-info-fallback";

export class ProjectInfoReadRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async getAll(): Promise<any[]> {
    try {
      const rows = await this.dbInstance
        .select()
        .from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .orderBy(desc(projectInfo.updatedAt));
      return rows.map((r: any) => {
        // Filter out null values from execution state so they don't overwrite project_info fields
        const execState = r.project_execution_state ?? {};
        const nonNullExecState: Record<string, any> = {};
        for (const [key, value] of Object.entries(execState)) {
          if (value !== null && value !== undefined) {
            nonNullExecState[key] = value;
          }
        }
        return {
          ...r.project_info,
          ...nonNullExecState,
          // Preserve identity id (not execution state id)
          id: r.project_info.id,
          updatedAt: r.project_info.updatedAt,
        };
      });
    } catch (error) {
      if (shouldUseLegacyProjectInfoReadFallback(error)) {
        return listLegacyCompatibleProjectInfo(this.dbInstance);
      }
      throw error;
    }
  }
}

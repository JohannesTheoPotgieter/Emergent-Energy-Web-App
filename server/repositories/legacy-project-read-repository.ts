import { desc, eq } from "drizzle-orm";
import { projectInfo, type Project, type ProjectInfo } from "@shared/schema";
import { db } from "../db";
import { mapProjectInfoToLegacyProject } from "../lib/legacy-project-mapper";
import {
  shouldUseLegacyProjectInfoReadFallback,
  listLegacyCompatibleProjectInfo,
} from "../lib/project-info-fallback";

/**
 * Read-only repository for the legacy Project shape.
 *
 * Preserves the exact query paths and fallback behavior from the
 * original DatabaseStorage.getAllProjects / getProject methods.
 */
export class LegacyProjectReadRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async getAll(): Promise<Project[]> {
    try {
      const rows = await this.dbInstance.select().from(projectInfo).orderBy(desc(projectInfo.updatedAt));
      return rows.map((p: ProjectInfo) => mapProjectInfoToLegacyProject(p));
    } catch (error) {
      if (shouldUseLegacyProjectInfoReadFallback(error)) {
        const rows = await listLegacyCompatibleProjectInfo(this.dbInstance);
        return rows.map((p: ProjectInfo) => mapProjectInfoToLegacyProject(p));
      }
      throw error;
    }
  }

  async getById(id: number): Promise<Project | undefined> {
    const [project] = await this.dbInstance.select().from(projectInfo).where(eq(projectInfo.id, id));
    return project ? mapProjectInfoToLegacyProject(project) : undefined;
  }
}

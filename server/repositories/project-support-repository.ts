import { eq, desc } from "drizzle-orm";
import {
  homeNotes, projectEditableFields,
  type HomeNotes, type InsertHomeNotes,
  type ProjectEditableFields, type InsertProjectEditableFields,
} from "@shared/schema";
import { db } from "../db";

export class ProjectSupportRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // Home Notes
  async getHomeNotes(): Promise<HomeNotes | undefined> {
    const results = await this.dbInstance.select().from(homeNotes).orderBy(desc(homeNotes.updatedAt)).limit(1);
    return results[0];
  }

  async saveHomeNotes(notes: InsertHomeNotes): Promise<HomeNotes> {
    const existing = await this.getHomeNotes();
    if (existing) {
      const updated = await this.dbInstance.update(homeNotes)
        .set({ ...notes, updatedAt: new Date() })
        .where(eq(homeNotes.id, existing.id))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance.insert(homeNotes).values(notes).returning();
      return inserted[0];
    }
  }

  // Project Editable Fields
  async getProjectEditableFields(projectName: string): Promise<ProjectEditableFields | undefined> {
    const results = await this.dbInstance.select().from(projectEditableFields).where(eq(projectEditableFields.projectName, projectName));
    return results[0];
  }

  async getAllProjectEditableFields(): Promise<ProjectEditableFields[]> {
    return this.dbInstance.select().from(projectEditableFields);
  }

  async upsertProjectEditableFields(data: InsertProjectEditableFields): Promise<ProjectEditableFields> {
    const existing = await this.getProjectEditableFields(data.projectName);
    if (existing) {
      const updated = await this.dbInstance.update(projectEditableFields)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(projectEditableFields.id, existing.id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(projectEditableFields).values(data).returning();
    return inserted[0];
  }
}

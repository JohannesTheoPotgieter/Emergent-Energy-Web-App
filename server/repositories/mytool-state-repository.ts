import { eq, and, desc } from "drizzle-orm";
import {
  mytoolDailyReviews, mytoolUserPreferences, mytoolSettings,
  mytoolDodTemplates, mytoolEmailLinks,
  type MytoolDailyReview, type InsertMytoolDailyReview,
  type MytoolUserPreferences, type InsertMytoolUserPreferences,
  type MytoolEmailLink, type InsertMytoolEmailLink,
  type MytoolDodTemplate, type InsertMytoolDodTemplate,
} from "@shared/schema";
import { db } from "../db";

type MytoolSettingsRow = typeof mytoolSettings.$inferSelect;
type InsertMytoolSettings = typeof mytoolSettings.$inferInsert;
// Returned when no settings row exists yet — the editable subset only.
type MytoolSettingsDefaults = Pick<
  MytoolSettingsRow,
  "enabled" | "allowedRoles" | "defaultPriorityHorizon"
>;

export class MytoolStateRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // Daily Reviews
  async getMytoolDailyReview(ownerUserId: number, date: string): Promise<MytoolDailyReview | undefined> {
    const [review] = await this.dbInstance.select().from(mytoolDailyReviews)
      .where(and(
        eq(mytoolDailyReviews.ownerUserId, ownerUserId),
        eq(mytoolDailyReviews.date, date)
      ));
    return review;
  }

  async upsertMytoolDailyReview(data: InsertMytoolDailyReview): Promise<MytoolDailyReview> {
    const now = new Date();
    const existing = await this.getMytoolDailyReview(data.ownerUserId, data.date);
    if (existing) {
      const [updated] = await this.dbInstance.update(mytoolDailyReviews)
        .set({ ...data, updatedAt: now })
        .where(eq(mytoolDailyReviews.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(mytoolDailyReviews).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return created;
  }

  // User Preferences
  async getMytoolUserPreferences(ownerUserId: number): Promise<MytoolUserPreferences | undefined> {
    const [prefs] = await this.dbInstance.select().from(mytoolUserPreferences)
      .where(eq(mytoolUserPreferences.ownerUserId, ownerUserId));
    return prefs;
  }

  async upsertMytoolUserPreferences(data: InsertMytoolUserPreferences): Promise<MytoolUserPreferences> {
    const now = new Date();
    const existing = await this.getMytoolUserPreferences(data.ownerUserId);
    if (existing) {
      const [updated] = await this.dbInstance.update(mytoolUserPreferences)
        .set({ ...data, updatedAt: now })
        .where(eq(mytoolUserPreferences.ownerUserId, data.ownerUserId))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(mytoolUserPreferences).values({ ...data, updatedAt: now }).returning();
    return created;
  }

  // Settings
  async getMytoolSettings(): Promise<MytoolSettingsRow | MytoolSettingsDefaults> {
    const [settings] = await this.dbInstance.select().from(mytoolSettings);
    if (!settings) {
      return { enabled: true, allowedRoles: 'admin', defaultPriorityHorizon: 'week' };
    }
    return settings;
  }

  async updateMytoolSettings(data: Partial<InsertMytoolSettings>): Promise<MytoolSettingsRow> {
    const [existing] = await this.dbInstance.select().from(mytoolSettings);
    if (existing) {
      const [updated] = await this.dbInstance.update(mytoolSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(mytoolSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(mytoolSettings).values({ ...data, updatedAt: new Date() }).returning();
    return created;
  }

  // DoD Templates
  async getMytoolDodTemplates(): Promise<MytoolDodTemplate[]> {
    return this.dbInstance.select().from(mytoolDodTemplates).orderBy(mytoolDodTemplates.name);
  }

  async createMytoolDodTemplate(data: InsertMytoolDodTemplate): Promise<MytoolDodTemplate> {
    const [created] = await this.dbInstance.insert(mytoolDodTemplates).values({ ...data, createdAt: new Date() }).returning();
    return created;
  }

  async deleteMytoolDodTemplate(id: number): Promise<void> {
    await this.dbInstance.delete(mytoolDodTemplates).where(eq(mytoolDodTemplates.id, id));
  }

  // Email Links
  async getEmailLinksByTask(taskId: number): Promise<MytoolEmailLink[]> {
    return this.dbInstance.select().from(mytoolEmailLinks).where(eq(mytoolEmailLinks.linkedTaskId, taskId)).orderBy(desc(mytoolEmailLinks.createdAt));
  }

  async getEmailLinksByOperationalTask(taskId: number): Promise<MytoolEmailLink[]> {
    return this.dbInstance.select().from(mytoolEmailLinks).where(eq(mytoolEmailLinks.linkedOperationalTaskId, taskId)).orderBy(desc(mytoolEmailLinks.createdAt));
  }

  async getEmailLinksByPriority(priorityId: number): Promise<MytoolEmailLink[]> {
    return this.dbInstance.select().from(mytoolEmailLinks).where(eq(mytoolEmailLinks.linkedPriorityId, priorityId)).orderBy(desc(mytoolEmailLinks.createdAt));
  }

  async createEmailLink(data: InsertMytoolEmailLink): Promise<MytoolEmailLink> {
    const [created] = await this.dbInstance.insert(mytoolEmailLinks).values(data).returning();
    return created;
  }

  async deleteEmailLink(id: number): Promise<void> {
    await this.dbInstance.delete(mytoolEmailLinks).where(eq(mytoolEmailLinks.id, id));
  }
}

import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { weeklyReviews, type InsertWeeklyReview, type WeeklyReview } from "@shared/schema";

export type WeeklyReviewUpdate = Partial<Pick<WeeklyReview,
  | "stepSchedule"
  | "stepBudget"
  | "stepRisks"
  | "stepQuality"
  | "stepActions"
  | "stepSummary"
  | "status"
  | "completedAt"
>>;

export class WeeklyReviewRepository {
  async listAll(): Promise<WeeklyReview[]> {
    return db
      .select()
      .from(weeklyReviews)
      .orderBy(desc(weeklyReviews.weekStarting));
  }

  async listByProject(projectName: string): Promise<WeeklyReview[]> {
    return db
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.projectName, projectName))
      .orderBy(desc(weeklyReviews.weekStarting));
  }

  async getById(id: number): Promise<WeeklyReview | undefined> {
    const [review] = await db
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.id, id));
    return review;
  }

  async create(values: InsertWeeklyReview): Promise<WeeklyReview> {
    const [review] = await db.insert(weeklyReviews).values(values).returning();
    return review;
  }

  async updateById(id: number, updates: WeeklyReviewUpdate): Promise<WeeklyReview | undefined> {
    if (Object.keys(updates).length === 0) {
      return this.getById(id);
    }

    const [review] = await db
      .update(weeklyReviews)
      .set(updates)
      .where(eq(weeklyReviews.id, id))
      .returning();
    return review;
  }
}

import { type InsertWeeklyReview, type WeeklyReview } from "@shared/schema";
import { WeeklyReviewRepository, type WeeklyReviewUpdate } from "../repositories/weekly-review.repository";

export class WeeklyReviewService {
  constructor(private readonly weeklyReviewRepository = new WeeklyReviewRepository()) {}

  listAll(): Promise<WeeklyReview[]> {
    return this.weeklyReviewRepository.listAll();
  }

  listByProject(projectName: string): Promise<WeeklyReview[]> {
    return this.weeklyReviewRepository.listByProject(projectName);
  }

  getById(id: number): Promise<WeeklyReview | undefined> {
    return this.weeklyReviewRepository.getById(id);
  }

  create(values: InsertWeeklyReview): Promise<WeeklyReview> {
    return this.weeklyReviewRepository.create(values);
  }

  updateById(id: number, updates: WeeklyReviewUpdate): Promise<WeeklyReview | undefined> {
    return this.weeklyReviewRepository.updateById(id, updates);
  }
}

import { notifications, type InsertNotification, type Notification } from "@shared/schema";
import { db } from "../db";

export class NotificationsRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async create(data: InsertNotification): Promise<Notification> {
    const [created] = await this.dbInstance.insert(notifications).values(data).returning();
    return created;
  }
}

import { desc } from "drizzle-orm";
import { supportTickets, type InsertSupportTicket, type SupportTicket } from "@shared/schema";
import { db } from "../db";

export class SupportTicketsRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async create(ticket: InsertSupportTicket): Promise<SupportTicket> {
    const [result] = await this.dbInstance.insert(supportTickets).values(ticket).returning();
    return result;
  }

  async list(): Promise<SupportTicket[]> {
    return this.dbInstance.select().from(supportTickets).orderBy(desc(supportTickets.createdAt));
  }
}

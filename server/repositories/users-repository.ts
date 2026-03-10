import { eq } from "drizzle-orm";
import { users, type InsertUser, type User } from "@shared/schema";
import { db } from "../db";

export class UsersRepository {
  constructor(private readonly dbInstance: typeof db = db) {}

  async getById(id: number): Promise<User | undefined> {
    const [user] = await this.dbInstance.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.dbInstance.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getByUsername(username: string): Promise<User | undefined> {
    const [user] = await this.dbInstance.select().from(users).where(eq(users.username, username));
    return user;
  }

  async create(user: InsertUser): Promise<User> {
    const [created] = await this.dbInstance
      .insert(users)
      .values({
        ...user,
        createdAt: new Date(),
      })
      .returning();
    return created;
  }
}

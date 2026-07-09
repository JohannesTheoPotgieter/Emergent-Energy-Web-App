import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { users, type InsertUser, type User } from "@shared/schema";
import { db } from "../db";

export interface UserRoleSummary {
  id: number;
  name: string;
  role: string;
}

export interface AssignableUserRow {
  id: number;
  name: string;
  username: string;
  role: string;
}

export class UsersRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

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

  async listByRoles(roles: string[]): Promise<UserRoleSummary[]> {
    if (roles.length === 0) return [];
    return this.dbInstance
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(inArray(users.role, roles));
  }

  async getNameById(id: number): Promise<string | null> {
    const [row] = await this.dbInstance
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, id));
    return row?.name ?? null;
  }

  async listIdNameByIds(ids: number[]): Promise<Array<{ id: number; name: string }>> {
    if (ids.length === 0) return [];
    return this.dbInstance
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids));
  }

  /**
   * Users that can be assigned to a given role. Returns the slim shape the
   * `/api/pm-assignable-users` and `/api/pd-assignable-users` endpoints
   * expose to the client (id, name, username, role).
   */
  async listAssignableByRole(role: string): Promise<AssignableUserRow[]> {
    return this.dbInstance
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        role: users.role,
      })
      .from(users)
      .where(eq(users.role, role));
  }

  /**
   * Active (not disabled, not soft-deleted) users holding a role, ordered by id
   * so callers that need a deterministic single recipient (e.g. seam-handoff
   * routing) always resolve the same holder. Unlike `listAssignableByRole`,
   * this filters `isActive` + `deletedAt IS NULL`.
   */
  async listActiveByRole(role: string): Promise<AssignableUserRow[]> {
    return this.dbInstance
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        role: users.role,
      })
      .from(users)
      .where(and(eq(users.role, role), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.id));
  }
}

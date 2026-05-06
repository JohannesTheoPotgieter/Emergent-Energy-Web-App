import { and, eq } from "drizzle-orm";
import { manualEditFlags } from "@shared/schema";
import { db } from "../db";

/**
 * NOTE: this repo first appears in Wave 5.4 (PR #820). When that PR
 * merges, resolve any duplicate-file collision by keeping a single copy.
 */
export class ManualEditFlagsRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /**
   * Returns the set of `${entityType}::${entityId}` keys for every flag
   * marked `isProtected = true`. Used by report builders to surface a
   * "has protected fields" badge.
   */
  async listProtectedFlagKeys(): Promise<Set<string>> {
    const flags = await this.dbInstance
      .select({
        entityType: manualEditFlags.entityType,
        entityId: manualEditFlags.entityId,
      })
      .from(manualEditFlags)
      .where(eq(manualEditFlags.isProtected, true));
    return new Set(flags.map((f: { entityType: string; entityId: number }) => `${f.entityType}::${f.entityId}`));
  }

  async findFlagId(args: {
    entityType: string;
    entityId: number;
    fieldName: string;
  }): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ id: manualEditFlags.id })
      .from(manualEditFlags)
      .where(and(
        eq(manualEditFlags.entityType, args.entityType),
        eq(manualEditFlags.entityId, args.entityId),
        eq(manualEditFlags.fieldName, args.fieldName),
      ));
    return row?.id ?? null;
  }

  async createProtectedFlag(args: {
    entityType: string;
    entityId: number;
    fieldName: string;
    editedByUserId: number | null;
    editedAt: Date;
  }): Promise<void> {
    await this.dbInstance
      .insert(manualEditFlags)
      .values({
        entityType: args.entityType,
        entityId: args.entityId,
        fieldName: args.fieldName,
        editedByUserId: args.editedByUserId,
        editedAt: args.editedAt,
        isProtected: true,
        protectedAt: args.editedAt,
        protectedByUserId: args.editedByUserId,
      });
  }

  async refreshProtectedFlag(id: number, args: {
    editedByUserId: number | null;
    editedAt: Date;
  }): Promise<void> {
    await this.dbInstance
      .update(manualEditFlags)
      .set({
        editedByUserId: args.editedByUserId,
        editedAt: args.editedAt,
        isProtected: true,
        protectedAt: args.editedAt,
        protectedByUserId: args.editedByUserId,
      })
      .where(eq(manualEditFlags.id, id));
  }

  async deleteFlag(args: {
    entityType: string;
    entityId: number;
    fieldName: string;
  }): Promise<void> {
    await this.dbInstance
      .delete(manualEditFlags)
      .where(and(
        eq(manualEditFlags.entityType, args.entityType),
        eq(manualEditFlags.entityId, args.entityId),
        eq(manualEditFlags.fieldName, args.fieldName),
      ));
  }
}

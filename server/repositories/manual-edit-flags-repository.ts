import { eq } from "drizzle-orm";
import { manualEditFlags } from "@shared/schema";
import { db } from "../db";

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
}

// ============================================================
// Execution Review repository
//
// Data-access for `execution_review_items` — the per-project flagged-item
// augmentation layer of the Execution control tower. This is the ONLY table
// the Execution feature writes. All other Execution data is read/composed
// from canonical surfaces (see execution-board-repository.ts).
//
// Route handlers stay free of direct db.{select,insert,update,delete} calls
// (CLAUDE.md repository-layer rule). Soft-delete via `deletedAt`; every read
// filters `isNull(deletedAt)`.
// ============================================================

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  executionReviewItems,
  type ExecutionReviewItem,
} from "@shared/schema";

export type ExecutionReviewItemInsert = typeof executionReviewItems.$inferInsert;
export type ExecutionReviewItemUpdate = Partial<ExecutionReviewItemInsert>;

/** Per-project counts keyed by status. */
export interface ExecutionItemCounts {
  open: number;
  flagged: number;
  actioned: number;
  closed: number;
  total: number;
}

export class ExecutionReviewRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /** Live (non-deleted) items for one project, newest first. */
  async listByProject(projectId: number): Promise<ExecutionReviewItem[]> {
    return this.dbInstance
      .select()
      .from(executionReviewItems)
      .where(
        and(
          eq(executionReviewItems.projectId, projectId),
          isNull(executionReviewItems.deletedAt),
        ),
      )
      .orderBy(desc(executionReviewItems.createdAt));
  }

  async findById(id: number): Promise<ExecutionReviewItem | undefined> {
    const [row] = await this.dbInstance
      .select()
      .from(executionReviewItems)
      .where(eq(executionReviewItems.id, id));
    return row;
  }

  async create(insert: ExecutionReviewItemInsert): Promise<ExecutionReviewItem> {
    const [row] = await this.dbInstance
      .insert(executionReviewItems)
      .values(insert)
      .returning();
    return row;
  }

  async update(
    id: number,
    fields: ExecutionReviewItemUpdate,
  ): Promise<ExecutionReviewItem | undefined> {
    const [row] = await this.dbInstance
      .update(executionReviewItems)
      .set({ ...fields, updatedAt: new Date() })
      .where(
        and(eq(executionReviewItems.id, id), isNull(executionReviewItems.deletedAt)),
      )
      .returning();
    return row;
  }

  /** Soft-delete (sets deletedAt). Returns the affected row, if any. */
  async softDelete(id: number): Promise<ExecutionReviewItem | undefined> {
    const [row] = await this.dbInstance
      .update(executionReviewItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(executionReviewItems.id, id), isNull(executionReviewItems.deletedAt)),
      )
      .returning();
    return row;
  }

  /**
   * Batched status counts for a set of projects (one query, no N+1).
   * Returns a Map keyed by projectId; projects with no items are absent.
   */
  async getCountsByProjects(projectIds: number[]): Promise<Map<number, ExecutionItemCounts>> {
    const result = new Map<number, ExecutionItemCounts>();
    if (projectIds.length === 0) return result;

    const rows = await this.dbInstance
      .select()
      .from(executionReviewItems)
      .where(
        and(
          inArray(executionReviewItems.projectId, projectIds),
          isNull(executionReviewItems.deletedAt),
        ),
      );

    for (const row of rows) {
      const c =
        result.get(row.projectId) ??
        { open: 0, flagged: 0, actioned: 0, closed: 0, total: 0 };
      if (row.status === "open") c.open += 1;
      else if (row.status === "flagged") c.flagged += 1;
      else if (row.status === "actioned") c.actioned += 1;
      else if (row.status === "closed") c.closed += 1;
      c.total += 1;
      result.set(row.projectId, c);
    }
    return result;
  }
}

export const executionReviewRepository = new ExecutionReviewRepository();

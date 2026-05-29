// ============================================================
// Delivery Milestones repository
//
// Data-access layer for `project_delivery_milestones`. All CRUD for the
// site-delivery milestone tracker lives here so route handlers in
// server/routes/delivery-milestones.routes.ts stay free of direct
// db.{select,insert,update,delete} calls (CLAUDE.md repository-layer rule).
//
// The route keeps the business logic (status derivation, blocker
// bookkeeping, audit + project-event emission); this layer owns only the
// reads and writes.
// ============================================================

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  projectDeliveryMilestones,
  projectInfo,
  type ProjectDeliveryMilestone,
} from "@shared/schema";

/** Full insert shape accepted by `create`. */
export type MilestoneInsert = typeof projectDeliveryMilestones.$inferInsert;
/** Partial column set accepted by `update` (the route builds this incrementally). */
export type MilestoneUpdate = Partial<MilestoneInsert>;

export class DeliveryMilestonesRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /** Live (non-deleted) milestones for a project, ordered for display. */
  async listByProject(projectId: number): Promise<ProjectDeliveryMilestone[]> {
    return this.dbInstance
      .select()
      .from(projectDeliveryMilestones)
      .where(
        and(
          eq(projectDeliveryMilestones.projectId, projectId),
          isNull(projectDeliveryMilestones.deletedAt),
        ),
      )
      .orderBy(
        asc(projectDeliveryMilestones.sortOrder),
        asc(projectDeliveryMilestones.id),
      );
  }

  /** True if the parent project exists — FK precondition for create. */
  async projectExists(projectId: number): Promise<boolean> {
    const [row] = await this.dbInstance
      .select({ id: projectInfo.id })
      .from(projectInfo)
      .where(eq(projectInfo.id, projectId));
    return Boolean(row);
  }

  /** Fetch a single milestone by id (including soft-deleted rows). */
  async findById(id: number): Promise<ProjectDeliveryMilestone | undefined> {
    const [row] = await this.dbInstance
      .select()
      .from(projectDeliveryMilestones)
      .where(eq(projectDeliveryMilestones.id, id));
    return row;
  }

  /** Insert a new milestone and return the created row. */
  async create(values: MilestoneInsert): Promise<ProjectDeliveryMilestone> {
    const [created] = await this.dbInstance
      .insert(projectDeliveryMilestones)
      .values(values)
      .returning();
    return created;
  }

  /** Apply a partial update by id and return the updated row. */
  async update(id: number, updates: MilestoneUpdate): Promise<ProjectDeliveryMilestone> {
    const [updated] = await this.dbInstance
      .update(projectDeliveryMilestones)
      .set(updates)
      .where(eq(projectDeliveryMilestones.id, id))
      .returning();
    return updated;
  }

  /** Soft-delete by id (sets deleted_at + updated_at). */
  async softDelete(id: number): Promise<void> {
    const now = new Date();
    await this.dbInstance
      .update(projectDeliveryMilestones)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(projectDeliveryMilestones.id, id));
  }
}

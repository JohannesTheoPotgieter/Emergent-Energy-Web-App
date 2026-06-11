import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  qbClassProjectOverrides,
  qbReconIgnores,
  qbCustomerProjectOverrides,
  qbRevenueReconIgnores,
  qbReconLineIgnores,
  auditEvents,
  fieldChanges,
} from "@shared/schema";
import { db } from "../db";

/**
 * QB-reconciliation override + ignore tables shared by the COS tracker
 * and revenue tracker maintenance workspaces. Each row carries an
 * audit-history entry written via `logAuditFromReq`; this repo only
 * owns the table CRUD.
 */
export class QbReconciliationOverridesRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // ── qb_class_project_overrides (COS tracker) ──

  async listActiveClassOverrides(): Promise<Array<typeof qbClassProjectOverrides.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(qbClassProjectOverrides)
      .where(isNull(qbClassProjectOverrides.deletedAt));
  }

  async getClassOverrideById(id: number): Promise<typeof qbClassProjectOverrides.$inferSelect | null> {
    const [row] = await this.dbInstance
      .select()
      .from(qbClassProjectOverrides)
      .where(eq(qbClassProjectOverrides.id, id));
    return row ?? null;
  }

  async softDeleteClassOverride(id: number): Promise<void> {
    await this.dbInstance
      .update(qbClassProjectOverrides)
      .set({ deletedAt: new Date() })
      .where(eq(qbClassProjectOverrides.id, id));
  }

  /**
   * Atomic "supersede the active row for this className → project mapping":
   * soft-delete any existing active row with the same case-insensitive
   * `classRefName`, then insert the new mapping. Wrapped in a transaction
   * so the partial unique index on LOWER(class_ref_name) WHERE deleted_at
   * IS NULL never sees two active rows.
   */
  async supersedeAndInsertClassOverride(input: {
    classRefName: string;
    projectName: string;
    note: string | null;
    createdByUserId: number | null;
    createdByName: string | null;
  }): Promise<typeof qbClassProjectOverrides.$inferSelect> {
    return this.dbInstance.transaction(async (tx: typeof db) => {
      await tx
        .update(qbClassProjectOverrides)
        .set({ deletedAt: new Date() })
        .where(and(
          isNull(qbClassProjectOverrides.deletedAt),
          sql`LOWER(${qbClassProjectOverrides.classRefName}) = LOWER(${input.classRefName})`,
        ));
      const [row] = await tx
        .insert(qbClassProjectOverrides)
        .values({
          classRefName: input.classRefName,
          projectName: input.projectName,
          note: input.note,
          createdByUserId: input.createdByUserId,
          createdByName: input.createdByName,
        })
        .returning();
      return row;
    });
  }

  // ── qb_recon_ignores (COS tracker) ──

  async listActiveReconIgnores(): Promise<Array<typeof qbReconIgnores.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(qbReconIgnores)
      .where(isNull(qbReconIgnores.deletedAt));
  }

  async getReconIgnoreById(id: number): Promise<typeof qbReconIgnores.$inferSelect | null> {
    const [row] = await this.dbInstance
      .select()
      .from(qbReconIgnores)
      .where(eq(qbReconIgnores.id, id));
    return row ?? null;
  }

  async createReconIgnore(values: typeof qbReconIgnores.$inferInsert): Promise<typeof qbReconIgnores.$inferSelect> {
    const [created] = await this.dbInstance
      .insert(qbReconIgnores)
      .values(values)
      .returning();
    return created;
  }

  async softDeleteReconIgnore(id: number): Promise<void> {
    await this.dbInstance
      .update(qbReconIgnores)
      .set({ deletedAt: new Date() })
      .where(eq(qbReconIgnores.id, id));
  }

  // ── qb_customer_project_overrides (Revenue tracker) ──

  async listActiveCustomerOverrides(): Promise<Array<typeof qbCustomerProjectOverrides.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(qbCustomerProjectOverrides)
      .where(isNull(qbCustomerProjectOverrides.deletedAt));
  }

  async getCustomerOverrideById(id: number): Promise<typeof qbCustomerProjectOverrides.$inferSelect | null> {
    const [row] = await this.dbInstance
      .select()
      .from(qbCustomerProjectOverrides)
      .where(eq(qbCustomerProjectOverrides.id, id));
    return row ?? null;
  }

  async softDeleteCustomerOverride(id: number): Promise<void> {
    await this.dbInstance
      .update(qbCustomerProjectOverrides)
      .set({ deletedAt: new Date() })
      .where(eq(qbCustomerProjectOverrides.id, id));
  }

  /**
   * Mirror of `supersedeAndInsertClassOverride` for the revenue side.
   */
  async supersedeAndInsertCustomerOverride(input: {
    customerRefName: string;
    projectName: string;
    note: string | null;
    createdByUserId: number | null;
    createdByName: string | null;
  }): Promise<typeof qbCustomerProjectOverrides.$inferSelect> {
    return this.dbInstance.transaction(async (tx: typeof db) => {
      await tx
        .update(qbCustomerProjectOverrides)
        .set({ deletedAt: new Date() })
        .where(and(
          isNull(qbCustomerProjectOverrides.deletedAt),
          sql`LOWER(${qbCustomerProjectOverrides.customerRefName}) = LOWER(${input.customerRefName})`,
        ));
      const [row] = await tx
        .insert(qbCustomerProjectOverrides)
        .values({
          customerRefName: input.customerRefName,
          projectName: input.projectName,
          note: input.note,
          createdByUserId: input.createdByUserId,
          createdByName: input.createdByName,
        })
        .returning();
      return row;
    });
  }

  // ── qb_revenue_recon_ignores (Revenue tracker) ──

  async listActiveRevenueReconIgnores(): Promise<Array<typeof qbRevenueReconIgnores.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(qbRevenueReconIgnores)
      .where(isNull(qbRevenueReconIgnores.deletedAt));
  }

  async getRevenueReconIgnoreById(id: number): Promise<typeof qbRevenueReconIgnores.$inferSelect | null> {
    const [row] = await this.dbInstance
      .select()
      .from(qbRevenueReconIgnores)
      .where(eq(qbRevenueReconIgnores.id, id));
    return row ?? null;
  }

  async createRevenueReconIgnore(values: typeof qbRevenueReconIgnores.$inferInsert): Promise<typeof qbRevenueReconIgnores.$inferSelect> {
    const [created] = await this.dbInstance
      .insert(qbRevenueReconIgnores)
      .values(values)
      .returning();
    return created;
  }

  async softDeleteRevenueReconIgnore(id: number): Promise<void> {
    await this.dbInstance
      .update(qbRevenueReconIgnores)
      .set({ deletedAt: new Date() })
      .where(eq(qbRevenueReconIgnores.id, id));
  }

  // ── qb_recon_line_ignores (COMPANY-wide tracker-vs-QB worklist) ──
  //
  // Keyed on the recon line identity (stream + normalized invoice number).
  // Distinct from the per-project tracker-gap ignores above, which key on a
  // single QB Bill / Invoice id. Soft-deleted via deleted_at; an active row
  // means "accepted difference — drop from the worklist, keep audited."

  async listActiveLineIgnores(): Promise<Array<typeof qbReconLineIgnores.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(qbReconLineIgnores)
      .where(isNull(qbReconLineIgnores.deletedAt));
  }

  async getLineIgnoreById(id: number): Promise<typeof qbReconLineIgnores.$inferSelect | null> {
    const [row] = await this.dbInstance
      .select()
      .from(qbReconLineIgnores)
      .where(eq(qbReconLineIgnores.id, id));
    return row ?? null;
  }

  async createLineIgnore(
    values: typeof qbReconLineIgnores.$inferInsert,
  ): Promise<typeof qbReconLineIgnores.$inferSelect> {
    const [created] = await this.dbInstance
      .insert(qbReconLineIgnores)
      .values(values)
      .returning();
    return created;
  }

  async softDeleteLineIgnore(id: number): Promise<void> {
    await this.dbInstance
      .update(qbReconLineIgnores)
      .set({ deletedAt: new Date() })
      .where(eq(qbReconLineIgnores.id, id));
  }

  // ── audit_events (read-only audit-history viewer) ──

  async listEntityAuditEvents(
    entityType: string,
    entityId: string,
    limit: number,
  ): Promise<Array<typeof auditEvents.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(auditEvents)
      .where(and(
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
      ))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
  }

  // ── field_changes (read-only — used by recent-change builders) ──

  async listFieldChangesByChangeSetIds(changeSetIds: number[]): Promise<Array<typeof fieldChanges.$inferSelect>> {
    if (changeSetIds.length === 0) return [];
    return this.dbInstance
      .select()
      .from(fieldChanges)
      .where(inArray(fieldChanges.changeSetId, changeSetIds));
  }
}

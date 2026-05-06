import { and, count, desc, eq, isNull } from "drizzle-orm";
import {
  financialEditRequests,
  financialIntegrationRules,
  expenseTaskLinks,
  milestoneTaskLinks,
  users,
  type ExpenseTaskLink,
  type FinancialEditRequest,
  type FinancialIntegrationRule,
  type MilestoneTaskLink,
} from "@shared/schema";
import { db } from "../db";

/**
 * NOTE: a fuller version of this repo first appears in Wave 5.6
 * (PR #822). This Wave 5.7 copy contains only the methods required
 * by `server/departments/finance-routes.ts`. When PR #822 merges,
 * resolve any duplicate-file collision by keeping the larger copy
 * and confirming this file's methods are still present.
 */
export class FinancialIntegrationRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async createEditRequest(values: typeof financialEditRequests.$inferInsert): Promise<typeof financialEditRequests.$inferSelect> {
    const [saved] = await this.dbInstance
      .insert(financialEditRequests)
      .values(values)
      .returning();
    return saved;
  }

  /**
   * Project-scoped edit-request listing with the requester's name joined
   * in. Capped at the most-recent 25 rows. Used by the project finance
   * governance summary.
   */
  async listEditRequestsForProjectWithRequester(projectName: string, limit = 25): Promise<Array<{
    id: number;
    editType: string;
    editTarget: string;
    editSummary: string;
    affectsRevenue: boolean | null;
    affectsExpenditure: boolean | null;
    status: string;
    createdAt: Date | null;
    requestedByUserId: number | null;
    requestedByName: string | null;
  }>> {
    return this.dbInstance
      .select({
        id: financialEditRequests.id,
        editType: financialEditRequests.editType,
        editTarget: financialEditRequests.editTarget,
        editSummary: financialEditRequests.editSummary,
        affectsRevenue: financialEditRequests.affectsRevenue,
        affectsExpenditure: financialEditRequests.affectsExpenditure,
        status: financialEditRequests.status,
        createdAt: financialEditRequests.createdAt,
        requestedByUserId: financialEditRequests.requestedByUserId,
        requestedByName: users.name,
      })
      .from(financialEditRequests)
      .leftJoin(users, eq(financialEditRequests.requestedByUserId, users.id))
      .where(eq(financialEditRequests.projectName, projectName))
      .orderBy(desc(financialEditRequests.createdAt))
      .limit(limit);
  }

  // ---------------------------------------------------------------------
  // Edit-request CRUD used by /api/financial-edit-requests
  // ---------------------------------------------------------------------

  async getEditRequestById(id: number): Promise<FinancialEditRequest | undefined> {
    const [row] = await this.dbInstance
      .select()
      .from(financialEditRequests)
      .where(eq(financialEditRequests.id, id))
      .limit(1);
    return row;
  }

  async updateEditRequest(
    id: number,
    fields: Partial<typeof financialEditRequests.$inferInsert>,
  ): Promise<FinancialEditRequest | undefined> {
    const [updated] = await this.dbInstance
      .update(financialEditRequests)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(financialEditRequests.id, id))
      .returning();
    return updated;
  }

  async appendReviewCommentOnApprovalFailure(id: number, comment: string): Promise<void> {
    await this.dbInstance
      .update(financialEditRequests)
      .set({ reviewComment: comment, updatedAt: new Date() })
      .where(eq(financialEditRequests.id, id));
  }

  async listEditRequests(filters: {
    projectName?: string;
    status?: string;
    requestedByUserId?: number;
  }): Promise<Array<{
    request: FinancialEditRequest;
    requestedBy: { id: number; name: string; role: string } | null;
  }>> {
    const where = [];
    if (filters.projectName) where.push(eq(financialEditRequests.projectName, filters.projectName));
    if (filters.status) where.push(eq(financialEditRequests.status, filters.status));
    if (filters.requestedByUserId !== undefined) {
      where.push(eq(financialEditRequests.requestedByUserId, filters.requestedByUserId));
    }

    const rows = await this.dbInstance
      .select({
        request: financialEditRequests,
        requestedBy: { id: users.id, name: users.name, role: users.role },
      })
      .from(financialEditRequests)
      .leftJoin(users, eq(financialEditRequests.requestedByUserId, users.id))
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(financialEditRequests.createdAt));

    return rows.map((r: typeof rows[number]) => ({
      request: r.request,
      requestedBy: r.requestedBy?.id != null
        ? { id: r.requestedBy.id, name: r.requestedBy.name, role: r.requestedBy.role }
        : null,
    }));
  }

  async countEditRequestsByStatus(status: string): Promise<number> {
    const [row] = await this.dbInstance
      .select({ n: count() })
      .from(financialEditRequests)
      .where(eq(financialEditRequests.status, status));
    return Number(row?.n ?? 0);
  }

  async countPendingEditRequestsForProject(projectName: string): Promise<number> {
    const [row] = await this.dbInstance
      .select({ n: count() })
      .from(financialEditRequests)
      .where(and(
        eq(financialEditRequests.projectName, projectName),
        eq(financialEditRequests.status, "pending"),
      ));
    return Number(row?.n ?? 0);
  }

  // ---------------------------------------------------------------------
  // Task-link reads — used by warning/sync surfaces
  // ---------------------------------------------------------------------

  async listMilestoneTaskLinksByProject(projectName: string): Promise<MilestoneTaskLink[]> {
    return this.dbInstance
      .select()
      .from(milestoneTaskLinks)
      .where(eq(milestoneTaskLinks.projectName, projectName));
  }

  async listExpenseTaskLinksByProject(projectName: string): Promise<ExpenseTaskLink[]> {
    return this.dbInstance
      .select()
      .from(expenseTaskLinks)
      .where(eq(expenseTaskLinks.projectName, projectName));
  }

  // ---------------------------------------------------------------------
  // Financial integration rules CRUD
  // ---------------------------------------------------------------------

  async listRulesForProject(projectName: string): Promise<Array<{
    rule: FinancialIntegrationRule;
    createdBy: { id: number; name: string } | null;
  }>> {
    const rows = await this.dbInstance
      .select({
        rule: financialIntegrationRules,
        createdBy: { id: users.id, name: users.name },
      })
      .from(financialIntegrationRules)
      .leftJoin(users, eq(financialIntegrationRules.createdByUserId, users.id))
      .where(and(
        eq(financialIntegrationRules.projectName, projectName),
        isNull(financialIntegrationRules.deletedAt),
      ))
      .orderBy(desc(financialIntegrationRules.createdAt));

    return rows.map((r: typeof rows[number]) => ({
      rule: r.rule,
      createdBy: r.createdBy?.id != null
        ? { id: r.createdBy.id, name: r.createdBy.name }
        : null,
    }));
  }

  async listActiveRulesForProject(projectName: string): Promise<FinancialIntegrationRule[]> {
    return this.dbInstance
      .select()
      .from(financialIntegrationRules)
      .where(and(
        eq(financialIntegrationRules.projectName, projectName),
        eq(financialIntegrationRules.isActive, true),
        isNull(financialIntegrationRules.deletedAt),
      ));
  }

  async createRule(
    values: typeof financialIntegrationRules.$inferInsert,
  ): Promise<FinancialIntegrationRule> {
    const [saved] = await this.dbInstance
      .insert(financialIntegrationRules)
      .values(values)
      .returning();
    return saved;
  }

  async updateRule(
    id: number,
    fields: Partial<typeof financialIntegrationRules.$inferInsert>,
  ): Promise<FinancialIntegrationRule | undefined> {
    const [updated] = await this.dbInstance
      .update(financialIntegrationRules)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(financialIntegrationRules.id, id))
      .returning();
    return updated;
  }

  async deleteRule(id: number): Promise<boolean> {
    const result = await this.dbInstance
      .update(financialIntegrationRules)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(and(
        eq(financialIntegrationRules.id, id),
        isNull(financialIntegrationRules.deletedAt),
      ))
      .returning({ id: financialIntegrationRules.id });
    return result.length > 0;
  }
}

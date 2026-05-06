import { and, desc, eq, sql } from "drizzle-orm";
import {
  financialEditRequests,
  financialIntegrationRules,
  expenseTaskLinks,
  milestoneTaskLinks,
  users,
} from "@shared/schema";
import { db } from "../db";

export interface FinancialEditRequestRow {
  request: typeof financialEditRequests.$inferSelect;
  requestedBy: { id: number | null; name: string | null; role: string | null } | null;
}

export class FinancialIntegrationRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // ── financial_edit_requests ──

  async createEditRequest(values: typeof financialEditRequests.$inferInsert): Promise<typeof financialEditRequests.$inferSelect> {
    const [saved] = await this.dbInstance
      .insert(financialEditRequests)
      .values(values)
      .returning();
    return saved;
  }

  async listEditRequests(args: {
    projectName?: string;
    status?: string;
    requestedByUserId?: number;
  }): Promise<FinancialEditRequestRow[]> {
    const conditions: any[] = [];
    if (args.projectName) conditions.push(eq(financialEditRequests.projectName, args.projectName));
    if (args.status) conditions.push(eq(financialEditRequests.status, args.status));
    if (args.requestedByUserId !== undefined) {
      conditions.push(eq(financialEditRequests.requestedByUserId, args.requestedByUserId));
    }

    return this.dbInstance
      .select({
        request: financialEditRequests,
        requestedBy: { id: users.id, name: users.name, role: users.role },
      })
      .from(financialEditRequests)
      .leftJoin(users, eq(financialEditRequests.requestedByUserId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(financialEditRequests.createdAt))
      .limit(100);
  }

  async countEditRequestsByStatus(status: string): Promise<number> {
    const [row] = await this.dbInstance
      .select({ count: sql<number>`count(*)::int` })
      .from(financialEditRequests)
      .where(eq(financialEditRequests.status, status));
    return row?.count ?? 0;
  }

  async countPendingEditRequestsForProject(projectName: string): Promise<number> {
    const [row] = await this.dbInstance
      .select({ count: sql<number>`count(*)::int` })
      .from(financialEditRequests)
      .where(and(
        eq(financialEditRequests.projectName, projectName),
        eq(financialEditRequests.status, "pending"),
      ));
    return row?.count ?? 0;
  }

  async getEditRequestById(id: number): Promise<typeof financialEditRequests.$inferSelect | null> {
    const [row] = await this.dbInstance
      .select()
      .from(financialEditRequests)
      .where(eq(financialEditRequests.id, id));
    return row ?? null;
  }

  async updateEditRequest(
    id: number,
    fields: Partial<typeof financialEditRequests.$inferInsert>,
  ): Promise<typeof financialEditRequests.$inferSelect | null> {
    const [updated] = await this.dbInstance
      .update(financialEditRequests)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(financialEditRequests.id, id))
      .returning();
    return updated ?? null;
  }

  async appendReviewCommentOnApprovalFailure(id: number, newComment: string): Promise<void> {
    await this.dbInstance
      .update(financialEditRequests)
      .set({ reviewComment: newComment })
      .where(eq(financialEditRequests.id, id));
  }

  // ── financial_integration_rules ──

  async listRulesForProject(projectName: string): Promise<Array<{
    rule: typeof financialIntegrationRules.$inferSelect;
    createdBy: { id: number | null; name: string | null } | null;
  }>> {
    return this.dbInstance
      .select({
        rule: financialIntegrationRules,
        createdBy: { id: users.id, name: users.name },
      })
      .from(financialIntegrationRules)
      .leftJoin(users, eq(financialIntegrationRules.createdByUserId, users.id))
      .where(eq(financialIntegrationRules.projectName, projectName))
      .orderBy(desc(financialIntegrationRules.createdAt));
  }

  async listActiveRulesForProject(projectName: string): Promise<Array<typeof financialIntegrationRules.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(financialIntegrationRules)
      .where(and(
        eq(financialIntegrationRules.projectName, projectName),
        eq(financialIntegrationRules.isActive, true),
      ));
  }

  async createRule(values: typeof financialIntegrationRules.$inferInsert): Promise<typeof financialIntegrationRules.$inferSelect> {
    const [saved] = await this.dbInstance
      .insert(financialIntegrationRules)
      .values(values)
      .returning();
    return saved;
  }

  async updateRule(
    id: number,
    fields: Partial<typeof financialIntegrationRules.$inferInsert>,
  ): Promise<typeof financialIntegrationRules.$inferSelect | null> {
    const [updated] = await this.dbInstance
      .update(financialIntegrationRules)
      .set(fields)
      .where(eq(financialIntegrationRules.id, id))
      .returning();
    return updated ?? null;
  }

  async deleteRule(id: number): Promise<typeof financialIntegrationRules.$inferSelect | null> {
    const [deleted] = await this.dbInstance
      .delete(financialIntegrationRules)
      .where(eq(financialIntegrationRules.id, id))
      .returning();
    return deleted ?? null;
  }

  // ── expense_task_links / milestone_task_links (read-only) ──

  async listExpenseTaskLinksByProject(projectName: string): Promise<Array<typeof expenseTaskLinks.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(expenseTaskLinks)
      .where(eq(expenseTaskLinks.projectName, projectName));
  }

  async listMilestoneTaskLinksByProject(projectName: string): Promise<Array<typeof milestoneTaskLinks.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(milestoneTaskLinks)
      .where(eq(milestoneTaskLinks.projectName, projectName));
  }
}

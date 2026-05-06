import { desc, eq } from "drizzle-orm";
import { financialEditRequests, users } from "@shared/schema";
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
}

/**
 * Change-requests (Variation Order) data access.
 *
 * VOs are modelled as `change_requests` (shared/schema/projects.ts). This
 * repository is the read surface the finance VO-impact view consumes so route
 * handlers never touch `db.select()` directly (repository discipline,
 * docs/AGENT_GUARDRAILS.md § 6). The legacy `server/change-control-routes.ts`
 * predates this layer and still issues its own queries; new readers use this.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { changeRequests } from "@shared/schema";
import type { ChangeRequest } from "@shared/schema/projects";

export class ChangeRequestsRepository {
  // Optional db injection mirrors FinanceLineLevelRepository so tests can pass a
  // fixture connection; defaults to the shared instance.
  constructor(private readonly dbInstance: typeof db = db) {}

  /** Live (non-deleted) VOs for a project, newest first. */
  async listByProject(projectId: number): Promise<ChangeRequest[]> {
    return this.dbInstance
      .select()
      .from(changeRequests)
      .where(and(eq(changeRequests.projectId, projectId), isNull(changeRequests.deletedAt)))
      .orderBy(desc(changeRequests.createdAt));
  }
}

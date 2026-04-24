/**
 * Client merge & soft-delete endpoints (Task #73).
 *
 * Mounts under `/api/pd/clients/...` so the role gate matches the
 * existing `pd_clients` permission entity. All mutating endpoints are
 * gated by `requirePermission('pd_clients', 'delete')` so only roles
 * with delete authority (today: COO_ADMIN, CEO_ADMIN per
 * shared/schema/users.ts:870) can merge or soft-delete clients. The
 * read-only preview and aliases endpoints are gated by 'view' so any
 * client picker UI can pull them.
 *
 * Endpoints
 *   GET  /api/pd/clients/:id/merge-preview?into=<survivorId>
 *   POST /api/pd/clients/:loserId/merge
 *   DELETE /api/pd/clients/:id
 *   POST /api/pd/clients/:id/restore
 *   GET  /api/pd/clients/:id/aliases
 *
 * Data integrity & audit consistency
 *   The `FK_TABLES` array below is the single source of truth used by
 *   all three read/write paths (preview, merge, delete-blocker). Each
 *   spec exposes a `countActive` and a `repoint` callback that share
 *   the same `deleted_at IS NULL` predicate where applicable, so the
 *   preview's per-table counts equal the merge's actual re-pointed
 *   counts and the delete blocker only blocks on live rows.
 *
 *   The merge runs inside `db.transaction(...)`. Inside the transaction
 *   it captures every active project_id about to move, UPDATEs
 *   `project_info.client_id` (only where `deleted_at IS NULL` so we
 *   never resurrect a tombstoned project onto the survivor), inserts
 *   one `project_client_history` row per moved project, calls each
 *   spec's `repoint` to move the remaining 6 FK tables, writes ONE
 *   `client_merges` audit row with per-table counts, and finally sets
 *   the loser's `deleted_at` + `merged_into_client_id`. Either every
 *   step succeeds or none of them do.
 *
 * Soft-delete only
 *   `email_project_links.client_id` has `ON DELETE CASCADE`, so a hard
 *   DELETE on a client would silently destroy email-link history. We
 *   therefore never hard-delete: the DELETE endpoint stamps
 *   `deleted_at = NOW()` and every read path filters on
 *   `deleted_at IS NULL` (cascade-display pattern from migration 0019).
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  clients,
  clientMerges,
  projectInfo,
  projectClientHistory,
  opportunities,
  engineeringTickets,
  workItems,
  sites,
  type Client,
} from "@shared/schema";
import { quickbooksCustomerMappings } from "@shared/schema/integrations";
import { emailProjectLinks } from "@shared/schema/email-links";
import { eq, and, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { z } from "zod";

/**
 * Per-FK-table contract that all three paths (preview, merge,
 * delete-blocker) share. Each entry knows how to count its own
 * "active" rows for a client (applying its own deleted_at predicate
 * if the table has one) and how to atomically re-point those active
 * rows from a loser to a survivor inside a Drizzle transaction.
 *
 * Defining count + repoint TOGETHER per spec is what guarantees the
 * preview row count == the merge row count == the blocker row count
 * — they all run the exact same WHERE clause, scoped to the same
 * column. Previously these three paths drifted apart (preview filtered
 * project_info.deleted_at IS NULL but merge UPDATEd everything; delete
 * blocker counted engineering_tickets without its deleted_at), which
 * is the bug T73's review caught.
 *
 * `email_project_links` has no `deleted_at` column in the database
 * (its FK uses ON DELETE CASCADE for hard cleanup), so its predicate
 * is unfiltered — every existing email link IS by definition active.
 */
/**
 * Drizzle's PgTransaction generic is unwieldy and the codebase
 * convention (see server/pd-routes.ts:719, server/repositories/...)
 * is to type tx as `typeof db` so writes inside the transaction get
 * the same builder methods as the top-level handle. We follow that
 * convention here for consistency.
 */
type Tx = typeof db;

interface FkTableSpec {
  /** Human-readable table key, used in audit JSON and blocker payload. */
  readonly name: string;
  /** Count active (non-deleted where applicable) rows for the client. */
  countActive(clientId: number): Promise<number>;
  /**
   * Re-point active rows from `loserId` to `survivorId`. Returns the
   * number of rows actually updated.
   */
  repoint(tx: Tx, loserId: number, survivorId: number): Promise<number>;
}

const FK_TABLE_OPPORTUNITIES: FkTableSpec = {
  name: "opportunities",
  async countActive(clientId) {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(and(eq(opportunities.clientId, clientId), isNull(opportunities.deletedAt)));
    return Number(r?.c ?? 0);
  },
  async repoint(tx, loserId, survivorId) {
    const r = await tx
      .update(opportunities)
      .set({ clientId: survivorId, updatedAt: new Date() })
      .where(and(eq(opportunities.clientId, loserId), isNull(opportunities.deletedAt)))
      .returning({ id: opportunities.id });
    return r.length;
  },
};

const FK_TABLE_ENGINEERING_TICKETS: FkTableSpec = {
  name: "engineering_tickets",
  async countActive(clientId) {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(engineeringTickets)
      .where(and(eq(engineeringTickets.clientId, clientId), isNull(engineeringTickets.deletedAt)));
    return Number(r?.c ?? 0);
  },
  async repoint(tx, loserId, survivorId) {
    const r = await tx
      .update(engineeringTickets)
      .set({ clientId: survivorId, updatedAt: new Date() })
      .where(and(eq(engineeringTickets.clientId, loserId), isNull(engineeringTickets.deletedAt)))
      .returning({ id: engineeringTickets.id });
    return r.length;
  },
};

const FK_TABLE_WORK_ITEMS: FkTableSpec = {
  name: "work_items",
  async countActive(clientId) {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(workItems)
      .where(and(eq(workItems.clientId, clientId), isNull(workItems.deletedAt)));
    return Number(r?.c ?? 0);
  },
  async repoint(tx, loserId, survivorId) {
    const r = await tx
      .update(workItems)
      .set({ clientId: survivorId, updatedAt: new Date() })
      .where(and(eq(workItems.clientId, loserId), isNull(workItems.deletedAt)))
      .returning({ id: workItems.id });
    return r.length;
  },
};

const FK_TABLE_SITES: FkTableSpec = {
  name: "sites",
  async countActive(clientId) {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(sites)
      .where(and(eq(sites.clientId, clientId), isNull(sites.deletedAt)));
    return Number(r?.c ?? 0);
  },
  async repoint(tx, loserId, survivorId) {
    const r = await tx
      .update(sites)
      .set({ clientId: survivorId, updatedAt: new Date() })
      .where(and(eq(sites.clientId, loserId), isNull(sites.deletedAt)))
      .returning({ id: sites.id });
    return r.length;
  },
};

const FK_TABLE_QB_MAPPINGS: FkTableSpec = {
  name: "quickbooks_customer_mappings",
  async countActive(clientId) {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(quickbooksCustomerMappings)
      .where(and(eq(quickbooksCustomerMappings.clientId, clientId), isNull(quickbooksCustomerMappings.deletedAt)));
    return Number(r?.c ?? 0);
  },
  async repoint(tx, loserId, survivorId) {
    const r = await tx
      .update(quickbooksCustomerMappings)
      .set({ clientId: survivorId, updatedAt: new Date() })
      .where(and(eq(quickbooksCustomerMappings.clientId, loserId), isNull(quickbooksCustomerMappings.deletedAt)))
      .returning({ id: quickbooksCustomerMappings.id });
    return r.length;
  },
};

const FK_TABLE_EMAIL_LINKS: FkTableSpec = {
  // No deleted_at column on email_project_links — every existing row
  // is active by definition (cleanup happens via ON DELETE CASCADE).
  name: "email_project_links",
  async countActive(clientId) {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(emailProjectLinks)
      .where(eq(emailProjectLinks.clientId, clientId));
    return Number(r?.c ?? 0);
  },
  async repoint(tx, loserId, survivorId) {
    const r = await tx
      .update(emailProjectLinks)
      .set({ clientId: survivorId })
      .where(eq(emailProjectLinks.clientId, loserId))
      .returning({ id: emailProjectLinks.id });
    return r.length;
  },
};

/**
 * Every non-project FK table whose `client_id` re-points during merge.
 * Order does not affect correctness (single transaction) but is
 * alphabetised so the audit-counts JSONB stays stable across runs and
 * tests.
 */
const NON_PROJECT_FK_TABLES: readonly FkTableSpec[] = [
  FK_TABLE_EMAIL_LINKS,
  FK_TABLE_ENGINEERING_TICKETS,
  FK_TABLE_OPPORTUNITIES,
  FK_TABLE_QB_MAPPINGS,
  FK_TABLE_SITES,
  FK_TABLE_WORK_ITEMS,
] as const;

/** Active project_info count (shared by preview + delete blocker). */
async function countActiveProjects(clientId: number): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(projectInfo)
    .where(and(eq(projectInfo.clientId, clientId), isNull(projectInfo.deletedAt)));
  return Number(r?.c ?? 0);
}

function parseId(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type LoadResult =
  | { row: Client; status: 200; error: null }
  | { row: null; status: 404; error: string }
  | { row: Client; status: 410; error: string };

async function loadActiveClient(id: number): Promise<LoadResult> {
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  if (!row) return { row: null, status: 404, error: "Client not found" };
  if (row.deletedAt) return { row, status: 410, error: "Client is soft-deleted" };
  return { row, status: 200, error: null };
}

/**
 * Per-table impact counts for the given (loser) clientId. Used by
 * both the merge-preview endpoint and (with the same predicates) the
 * merge transaction itself, so preview is authoritative.
 */
async function buildPerTableCounts(clientId: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = { project_info: await countActiveProjects(clientId) };
  for (const spec of NON_PROJECT_FK_TABLES) {
    counts[spec.name] = await spec.countActive(clientId);
  }
  return counts;
}

export function registerClientsMergeRoutes(app: Express) {
  // -------------------------------------------------------------------------
  // GET /api/pd/clients/:id/merge-preview?into=<survivorId>
  // Returns the per-table counts that would be re-pointed if this loser
  // were merged into <survivorId>. Both ids must resolve to non-deleted
  // clients and they must be different. The counts shown here are
  // EXACTLY the counts the merge will produce — same predicates, same
  // tables.
  // -------------------------------------------------------------------------
  app.get(
    "/api/pd/clients/:id/merge-preview",
    requireAuth,
    requirePermission("pd_clients", "view"),
    async (req: Request, res: Response) => {
      try {
        const loserId = parseId(req.params.id);
        const survivorId = parseId(req.query.into);
        if (!loserId || !survivorId) {
          return res.status(400).json({ error: "Both loser id and ?into=<survivorId> are required and must be positive integers" });
        }
        if (loserId === survivorId) {
          return res.status(400).json({ error: "Loser and survivor must be different clients" });
        }

        const loser = await loadActiveClient(loserId);
        if (loser.status !== 200) return res.status(loser.status).json({ error: `Loser: ${loser.error}` });
        const survivor = await loadActiveClient(survivorId);
        if (survivor.status !== 200) return res.status(survivor.status).json({ error: `Survivor: ${survivor.error}` });

        const counts = await buildPerTableCounts(loserId);
        const total = Object.values(counts).reduce((a, b) => a + b, 0);

        res.json({
          loser: { id: loser.row.id, name: loser.row.name, clientId: loser.row.clientId },
          survivor: { id: survivor.row.id, name: survivor.row.name, clientId: survivor.row.clientId },
          repointedCounts: counts,
          totalRepointed: total,
        });
      } catch (err: any) {
        console.error("[clients-merge] preview error:", err);
        res.status(500).json({ error: "Failed to compute merge preview" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/pd/clients/:loserId/merge   { survivorClientId, reason? }
  // Atomically re-points every active client_id reference from
  // loser→survivor, logs one project_client_history row per moved
  // project, inserts ONE client_merges audit row, and sets the loser's
  // deleted_at + merged_into_client_id. Returns the per-table counts.
  // -------------------------------------------------------------------------
  const mergeBodySchema = z.object({
    survivorClientId: z.number().int().positive(),
    reason: z.string().max(500).optional(),
  });

  app.post(
    "/api/pd/clients/:loserId/merge",
    requireAuth,
    requirePermission("pd_clients", "delete"),
    async (req: Request, res: Response) => {
      try {
        const loserId = parseId(req.params.loserId);
        if (!loserId) return res.status(400).json({ error: "Invalid loser id" });
        const parsed = mergeBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
        }
        const { survivorClientId, reason } = parsed.data;
        if (loserId === survivorClientId) {
          return res.status(400).json({ error: "Loser and survivor must be different clients" });
        }

        const loser = await loadActiveClient(loserId);
        if (loser.status !== 200) return res.status(loser.status).json({ error: `Loser: ${loser.error}` });
        const survivor = await loadActiveClient(survivorClientId);
        if (survivor.status !== 200) return res.status(survivor.status).json({ error: `Survivor: ${survivor.error}` });

        const userId = req.user?.id ?? null;
        // requireAuth guarantees a user, but we audit-log every merge
        // and project_client_history.moved_by_user_id is NOT NULL, so
        // assert defensively rather than silently skipping the audit.
        if (!Number.isInteger(userId)) {
          return res.status(401).json({ error: "Authenticated user required for merge" });
        }
        const actorId = userId as number;

        const result = await db.transaction(async (tx: Tx) => {
          // 1. Capture every ACTIVE project_id about to move so we can
          //    write project_client_history rows for them. We do this
          //    BEFORE the UPDATE so the rows are still attached to the
          //    loser. Same `deleted_at IS NULL` predicate as preview.
          const projectsToMove = await tx
            .select({ id: projectInfo.id })
            .from(projectInfo)
            .where(and(eq(projectInfo.clientId, loserId), isNull(projectInfo.deletedAt)));

          // 2. UPDATE active project_info rows. Same predicate as
          //    preview/blocker so counts stay consistent — soft-deleted
          //    projects are deliberately left attached to the loser
          //    (which is itself about to be tombstoned in step 6).
          const projectUpdate = await tx
            .update(projectInfo)
            .set({ clientId: survivorClientId, updatedAt: new Date() })
            .where(and(eq(projectInfo.clientId, loserId), isNull(projectInfo.deletedAt)))
            .returning({ id: projectInfo.id });
          const counts: Record<string, number> = { project_info: projectUpdate.length };

          // 3. Insert one history row per moved project so the existing
          //    project_client_history ledger remains canonical for
          //    project ↔ client movement. Unconditional now — actorId
          //    was asserted above.
          if (projectsToMove.length > 0) {
            await tx.insert(projectClientHistory).values(
              projectsToMove.map((p: { id: number }) => ({
                projectId: p.id,
                oldClientId: loserId,
                newClientId: survivorClientId,
                movedByUserId: actorId,
                reason: reason ?? "client merge",
              })),
            );
          }

          // 4. Re-point every other table in the same transaction via
          //    the typed FkTableSpec contract, which guarantees its
          //    predicate matches the preview/blocker predicates.
          for (const spec of NON_PROJECT_FK_TABLES) {
            counts[spec.name] = await spec.repoint(tx, loserId, survivorClientId);
          }

          // 5. Insert the audit row.
          const [auditRow] = await tx
            .insert(clientMerges)
            .values({
              loserClientId: loserId,
              survivorClientId,
              performedByUserId: actorId,
              loserNameSnapshot: loser.row.name,
              loserClientIdSnapshot: loser.row.clientId,
              repointedCounts: counts,
              reason: reason ?? null,
            })
            .returning();

          // 6. Soft-delete the loser and point it at the survivor.
          await tx
            .update(clients)
            .set({
              deletedAt: new Date(),
              mergedIntoClientId: survivorClientId,
              updatedAt: new Date(),
              updatedBy: actorId,
            })
            .where(eq(clients.id, loserId));

          return { counts, auditRow };
        });

        logAuditFromReq(req, {
          entityType: "client",
          entityId: String(loserId),
          action: "merge",
          changesJson: {
            survivorClientId,
            repointedCounts: result.counts,
            auditRowId: result.auditRow.id,
            reason: reason ?? null,
          },
        });

        const totalRepointed = Object.values(result.counts as Record<string, number>).reduce(
          (a: number, b: number) => a + b,
          0,
        );
        res.json({
          ok: true,
          merge: result.auditRow,
          repointedCounts: result.counts,
          totalRepointed,
        });
      } catch (err) {
        console.error("[clients-merge] merge error:", err);
        res.status(500).json({ error: "Failed to merge clients" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/pd/clients/:id
  // Soft-delete only. Refuses with 409 + per-table blocker counts when
  // any LIVE (non-deleted-where-applicable) row in any of the 7 FK
  // tables still references the client. Predicates match merge/preview
  // exactly, so "merge instead" always brings the blocker count down to
  // zero.
  // -------------------------------------------------------------------------
  app.delete(
    "/api/pd/clients/:id",
    requireAuth,
    requirePermission("pd_clients", "delete"),
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: "Invalid client id" });

        const loaded = await loadActiveClient(id);
        if (loaded.status !== 200) return res.status(loaded.status).json({ error: loaded.error });

        const blockers: Record<string, number> = {
          projects: await countActiveProjects(id),
        };
        for (const spec of NON_PROJECT_FK_TABLES) {
          blockers[spec.name] = await spec.countActive(id);
        }
        const totalBlockers = Object.values(blockers).reduce((a, b) => a + b, 0);
        if (totalBlockers > 0) {
          return res.status(409).json({
            error: "Client cannot be deleted while live records still reference it",
            blockers,
            hint: "Re-assign or merge the linked records first, or merge this client into another using POST /api/pd/clients/:id/merge",
          });
        }

        const userId = req.user?.id ?? null;
        const [updated] = await db
          .update(clients)
          .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId })
          .where(eq(clients.id, id))
          .returning();

        logAuditFromReq(req, {
          entityType: "client",
          entityId: String(id),
          action: "soft_delete",
          changesJson: { name: loaded.row.name, clientId: loaded.row.clientId },
        });

        res.json({ ok: true, client: updated });
      } catch (err: any) {
        console.error("[clients-merge] delete error:", err);
        res.status(500).json({ error: "Failed to delete client" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/pd/clients/:id/restore
  // Clear deleted_at + merged_into_client_id. Note: this does NOT undo
  // a prior merge's row re-pointing — those rows stay with the survivor
  // because re-pointing them back would corrupt the survivor's history.
  // The restore is only useful for soft-deletes that were not merges.
  // -------------------------------------------------------------------------
  app.post(
    "/api/pd/clients/:id/restore",
    requireAuth,
    requirePermission("pd_clients", "delete"),
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: "Invalid client id" });
        const [row] = await db.select().from(clients).where(eq(clients.id, id));
        if (!row) return res.status(404).json({ error: "Client not found" });
        if (!row.deletedAt) return res.status(409).json({ error: "Client is not deleted" });

        const userId = req.user?.id ?? null;
        const [updated] = await db
          .update(clients)
          .set({
            deletedAt: null,
            mergedIntoClientId: null,
            updatedAt: new Date(),
            updatedBy: userId,
          })
          .where(eq(clients.id, id))
          .returning();

        logAuditFromReq(req, {
          entityType: "client",
          entityId: String(id),
          action: "restore",
          changesJson: { previouslyMergedInto: row.mergedIntoClientId ?? null },
        });

        res.json({ ok: true, client: updated });
      } catch (err: any) {
        console.error("[clients-merge] restore error:", err);
        res.status(500).json({ error: "Failed to restore client" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/pd/clients/:id/aliases
  // Returns every client_merges row whose survivor_client_id is :id, so
  // the survivor's detail page can render a "previously known as" chip.
  // -------------------------------------------------------------------------
  app.get(
    "/api/pd/clients/:id/aliases",
    requireAuth,
    requirePermission("pd_clients", "view"),
    async (req: Request, res: Response) => {
      try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: "Invalid client id" });
        const rows = await db
          .select({
            id: clientMerges.id,
            loserClientId: clientMerges.loserClientId,
            loserName: clientMerges.loserNameSnapshot,
            loserClientIdCode: clientMerges.loserClientIdSnapshot,
            performedAt: clientMerges.performedAt,
            performedByUserId: clientMerges.performedByUserId,
            repointedCounts: clientMerges.repointedCounts,
            reason: clientMerges.reason,
          })
          .from(clientMerges)
          .where(eq(clientMerges.survivorClientId, id))
          .orderBy(sql`${clientMerges.performedAt} DESC`);
        res.json(rows);
      } catch (err: any) {
        console.error("[clients-merge] aliases error:", err);
        res.status(500).json({ error: "Failed to load client aliases" });
      }
    },
  );
}

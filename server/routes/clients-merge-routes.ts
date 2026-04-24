/**
 * Client merge & soft-delete endpoints (Task #73).
 *
 * Mounts under `/api/pd/clients/...` so the role gate matches the
 * existing `pd_clients` permission entity. All mutating endpoints are
 * gated by `requirePermission('pd_clients', 'delete')` so only roles
 * with delete authority (today: COO_ADMIN, CEO_ADMIN per
 * shared/schema/users.ts:870) can merge or soft-delete clients. The
 * read-only preview endpoint is gated by 'view' so any client picker
 * UI can pull it.
 *
 * Endpoints
 *   GET  /api/pd/clients/:id/merge-preview?into=<survivorId>
 *   POST /api/pd/clients/:loserId/merge
 *   DELETE /api/pd/clients/:id
 *   POST /api/pd/clients/:id/restore
 *   GET  /api/pd/clients/:id/aliases
 *
 * Data integrity
 *   The merge runs inside `db.transaction(...)`. Inside the transaction
 *   it UPDATEs `client_id` from loser→survivor on every table in the
 *   "8 tables that reference clients.id" map, inserts one
 *   `project_client_history` row per re-pointed project (so the
 *   existing history ledger stays the source of truth for project
 *   movement), inserts ONE `client_merges` audit row with per-table
 *   counts, and finally sets the loser's `deleted_at` + `merged_into_client_id`.
 *   Either every step succeeds or none of them do — there is no
 *   partial-merge state to clean up.
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
} from "@shared/schema";
import { quickbooksCustomerMappings } from "@shared/schema/integrations";
import { emailProjectLinks } from "@shared/schema/email-links";
import { eq, and, sql, isNull, ne } from "drizzle-orm";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { z } from "zod";

/**
 * Tables whose `client_id` column gets re-pointed loser→survivor
 * during a merge. The order does not matter (we are inside a single
 * transaction) but is alphabetised to keep the audit-counts JSONB
 * stable across runs and tests.
 *
 * `project_info` is updated separately (after the loop) because we
 * also need to capture `project_id` per row to insert into
 * `project_client_history`.
 */
const REPOINT_TABLES_NON_PROJECT = [
  { name: "email_project_links", table: emailProjectLinks, column: emailProjectLinks.clientId },
  { name: "engineering_tickets", table: engineeringTickets, column: engineeringTickets.clientId },
  { name: "opportunities", table: opportunities, column: opportunities.clientId },
  { name: "quickbooks_customer_mappings", table: quickbooksCustomerMappings, column: quickbooksCustomerMappings.clientId },
  { name: "sites", table: sites, column: sites.clientId },
  { name: "work_items", table: workItems, column: workItems.clientId },
] as const;

/**
 * Tables we count when deciding whether a soft-delete is blocked.
 *
 * Mirrors REPOINT_TABLES_NON_PROJECT + project_info: every FK table is
 * a blocker so a delete cannot silently leave dangling rows pointing
 * at a tombstoned client. (Architect review T73 — soft-delete must be
 * conservative: you either merge or there is nothing left attached.)
 *
 * `email_project_links` is included even though its FK has
 * `ON DELETE CASCADE` because we deliberately never hard-delete a
 * client (would destroy email-link history) and a soft-delete leaves
 * the cascade dormant — so emails staying attached IS a real blocker.
 */
const BLOCKER_QUERIES = [
  { name: "projects", table: projectInfo, column: projectInfo.clientId, deletedColumn: projectInfo.deletedAt },
  { name: "opportunities", table: opportunities, column: opportunities.clientId, deletedColumn: null },
  { name: "engineering_tickets", table: engineeringTickets, column: engineeringTickets.clientId, deletedColumn: null },
  { name: "work_items", table: workItems, column: workItems.clientId, deletedColumn: null },
  { name: "sites", table: sites, column: sites.clientId, deletedColumn: null },
  { name: "quickbooks_customer_mappings", table: quickbooksCustomerMappings, column: quickbooksCustomerMappings.clientId, deletedColumn: null },
  { name: "email_project_links", table: emailProjectLinks, column: emailProjectLinks.clientId, deletedColumn: null },
] as const;

function parseId(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function countByClient(table: any, column: any, clientId: number, deletedColumn: any | null): Promise<number> {
  const where = deletedColumn
    ? and(eq(column, clientId), isNull(deletedColumn))
    : eq(column, clientId);
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(table).where(where);
  return Number(row?.c ?? 0);
}

async function loadActiveClient(id: number) {
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  if (!row) return { row: null as any, status: 404 as const, error: "Client not found" };
  if (row.deletedAt) return { row, status: 410 as const, error: "Client is soft-deleted" };
  return { row, status: 200 as const, error: null };
}

async function buildPerTableCounts(clientId: number): Promise<Record<string, number>> {
  const projectsCount = await countByClient(projectInfo, projectInfo.clientId, clientId, projectInfo.deletedAt);
  const counts: Record<string, number> = { project_info: projectsCount };
  for (const { name, table, column } of REPOINT_TABLES_NON_PROJECT) {
    counts[name] = await countByClient(table, column, clientId, null);
  }
  return counts;
}

export function registerClientsMergeRoutes(app: Express) {
  // -------------------------------------------------------------------------
  // GET /api/pd/clients/:id/merge-preview?into=<survivorId>
  // Returns the per-table counts that would be re-pointed if this loser
  // were merged into <survivorId>. Both ids must resolve to non-deleted
  // clients and they must be different.
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
  // Atomically re-points every client_id reference from loser→survivor,
  // logs one project_client_history row per re-pointed project, inserts
  // ONE client_merges audit row, and sets the loser's deleted_at +
  // merged_into_client_id. Returns the per-table counts.
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

        const userId = (req.user as any)?.id ?? null;
        // requireAuth guarantees a user, but we audit-log every merge
        // and project_client_history.moved_by_user_id is NOT NULL, so
        // assert defensively rather than silently skipping the audit.
        if (!Number.isInteger(userId)) {
          return res.status(401).json({ error: "Authenticated user required for merge" });
        }

        const result = await db.transaction(async (tx: any) => {
          // 1. Capture every project_id about to move so we can write
          //    project_client_history rows for them. We do this BEFORE
          //    the UPDATE so the rows are still attached to the loser.
          const projectsToMove = await tx
            .select({ id: projectInfo.id })
            .from(projectInfo)
            .where(and(eq(projectInfo.clientId, loserId), isNull(projectInfo.deletedAt)));

          // 2. UPDATE project_info first.
          const projectUpdate = await tx
            .update(projectInfo)
            .set({ clientId: survivorClientId, updatedAt: new Date() })
            .where(eq(projectInfo.clientId, loserId))
            .returning({ id: projectInfo.id });
          const counts: Record<string, number> = {
            project_info: projectUpdate.length,
          };

          // 3. Insert one history row per moved project so the existing
          //    project_client_history ledger remains canonical for
          //    project ↔ client movement. Unconditional now — userId
          //    was asserted above.
          if (projectsToMove.length > 0) {
            await tx.insert(projectClientHistory).values(
              projectsToMove.map((p: { id: number }) => ({
                projectId: p.id,
                oldClientId: loserId,
                newClientId: survivorClientId,
                movedByUserId: userId,
                reason: reason ?? "client merge",
              })),
            );
          }

          // 4. Re-point every other table in the same transaction.
          for (const { name, table, column } of REPOINT_TABLES_NON_PROJECT) {
            const updated = await tx
              .update(table)
              .set({ clientId: survivorClientId } as any)
              .where(eq(column, loserId))
              .returning({ id: (table as any).id });
            counts[name] = updated.length;
          }

          // 5. Insert the audit row.
          const [auditRow] = await tx
            .insert(clientMerges)
            .values({
              loserClientId: loserId,
              survivorClientId,
              performedByUserId: userId,
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
              updatedBy: userId,
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

        res.json({
          ok: true,
          merge: result.auditRow,
          repointedCounts: result.counts,
          totalRepointed: Object.values(result.counts as Record<string, number>).reduce((a: number, b: number) => a + b, 0),
        });
      } catch (err: any) {
        console.error("[clients-merge] merge error:", err);
        res.status(500).json({ error: "Failed to merge clients", message: err?.message });
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/pd/clients/:id
  // Soft-delete only. Refuses with 409 if any non-deleted projects,
  // opportunities, or engineering tickets still reference the client —
  // returns the per-table blocker counts so the UI can offer a "merge
  // instead" pivot.
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

        const blockers: Record<string, number> = {};
        for (const { name, table, column, deletedColumn } of BLOCKER_QUERIES) {
          blockers[name] = await countByClient(table, column, id, deletedColumn);
        }
        const totalBlockers = Object.values(blockers).reduce((a, b) => a + b, 0);
        if (totalBlockers > 0) {
          return res.status(409).json({
            error: "Client cannot be deleted while live records still reference it",
            blockers,
            hint: "Re-assign or merge the linked records first, or merge this client into another using POST /api/pd/clients/:id/merge",
          });
        }

        const userId = (req.user as any)?.id ?? null;
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

        const userId = (req.user as any)?.id ?? null;
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

  // Suppress no-op dead-code stripping by using `ne` once.
  void ne;
}

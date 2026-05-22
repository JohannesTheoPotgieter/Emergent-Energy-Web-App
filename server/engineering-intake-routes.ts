import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { syncAuditLog, intakeRequests, projectInfo } from "@shared/schema";
import { getConnector, getConfig, mapSpFieldsToApp, normalizeClientKey, hashFields } from "./intake-connector";
import { getEffectiveUser, jwtAuth, requireAuth, type AuthenticatedUser } from "./auth-context";
import { logAuditFromReq } from "./audit-logger";
import { sendError, ApiError, notFound } from "./lib/api-error";
// Engineering PR 2 — canonical RBAC. Replaces local `requireCOO` shim
// (which hardcoded ["COO_ADMIN", "CEO_ADMIN"] and emitted a raw 403).
import { requireRole as requireRoleCanonical } from "./middleware/requireRole";
import { ADMIN_ROLES } from "@shared/schema";

function getUser(req: Request): { id: number; name: string; role: string } {
  const user = getEffectiveUser(req);
  return user ? { id: user.id, name: user.name, role: user.role } : { id: 0, name: "Unknown", role: "viewer" };
}

// Engineering PR 2: replaced the local `requireCOO` function (which had a
// raw 403 JSON response) with the canonical `requireRole` middleware over
// the canonical ADMIN_ROLES constant. Same semantics; canonical error
// envelope.
const requireCOO = requireRoleCanonical([...ADMIN_ROLES]);

export function registerEngineeringIntakeRoutes(app: Express) {

  // ========== INTAKE ITEMS (from connector) ==========

  app.get("/api/eng/intake/items", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const connector = getConnector();
      const config = await getConfig();
      const siteId = config?.siteId || "mock";
      const listId = config?.listId || "mock";
      const filter = req.query.filter as string | undefined;

      const items = await connector.fetchItems(siteId, listId, filter);

      await db.insert(syncAuditLog).values({
        action: "intake_items_fetched",
        direction: "pull",
        actorRole: getUser(req).role,
        summary: `Fetched ${items.length} items via ${connector.name} connector`,
        itemCount: items.length,
      });

      res.json({
        connector: connector.name,
        count: items.length,
        items: items.map(item => ({
          id: item.id,
          fields: item.fields,
          etag: item.etag,
          lastModified: item.lastModifiedDateTime,
        })),
      });
    } catch (err: unknown) {
      console.error("[EngIntake] Fetch items error:", err);
      sendError(res, new ApiError(500, "CONNECTOR_ERROR", "Failed to fetch intake items"));
    }
  });

  app.get("/api/eng/intake/items/:id", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const connector = getConnector();
      const config = await getConfig();
      const siteId = config?.siteId || "mock";
      const listId = config?.listId || "mock";

      const items = await connector.fetchItems(siteId, listId);
      const item = items.find(i => i.id === req.params.id);

      if (!item) return sendError(res, notFound("Item"));

      const columns = await connector.getColumns(siteId, listId);

      res.json({
        ...item,
        columns,
      });
    } catch (err: unknown) {
      console.error("[EngIntake] Get item error:", err);
      sendError(res, new ApiError(500, "CONNECTOR_ERROR", "Failed to get intake item"));
    }
  });

  // ========== SYNC OPERATIONS ==========

  app.post("/api/eng/intake/sync/pull", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const connector = getConnector();
      const config = await getConfig();
      const siteId = config?.siteId || "mock";
      const listId = config?.listId || "mock";
      const user = getUser(req);

      const items = await connector.fetchItems(siteId, listId);
      let newRequests = 0;
      let updatedRequests = 0;
      let conflicts = 0;
      const errors: string[] = [];

      for (const item of items) {
        try {
          const fields = item.fields as Record<string, unknown>;
          const clientName = fields.Client || fields.Title || "Unknown";
          const clientKey = normalizeClientKey(clientName as string);
          const spItemId = item.id;
          const mapped = mapSpFieldsToApp(fields as any, {} as any, {} as any);
          const pullHash = hashFields(fields);

          const [existing] = await db.select().from(intakeRequests)
            .where(eq(intakeRequests.spItemId, spItemId));

          if (!existing) {
            // New request — find or skip project linking
            let projectId: number | null = null;
            const [project] = await db.select({ id: projectInfo.id })
              .from(projectInfo)
              .where(sql`LOWER(${projectInfo.projectName}) LIKE LOWER(${`%${clientKey}%`})`)
              .limit(1);
            if (project) projectId = project.id;

            await db.insert(intakeRequests).values({
              spItemId,
              spEtag: item.etag,
              clientName,
              clientKey,
              projectId,
              ...mapped,
              spRawJson: fields,
              lastPulledAt: new Date(),
              lastPulledHash: pullHash,
              syncConflict: false,
            });
            newRequests++;
          } else {
            // Check for conflicts on shared fields
            const sharedFields = ["status", "comments", "priority"];
            let hasConflict = false;
            const conflictFields: Record<string, { sp: unknown; app: unknown }> = {};

            if (existing.lastAppEditAt && existing.lastPulledAt && existing.lastAppEditAt > existing.lastPulledAt) {
              for (const field of sharedFields) {
                const spVal = (mapped as Record<string, unknown>)[field];
                const appVal = (existing as Record<string, unknown>)[field];
                if (spVal && appVal && String(spVal) !== String(appVal)) {
                  hasConflict = true;
                  conflictFields[field] = { sp: spVal, app: appVal };
                }
              }
            }

            if (hasConflict) {
              await db.update(intakeRequests).set({
                spEtag: item.etag,
                spRawJson: fields,
                lastPulledAt: new Date(),
                lastPulledHash: pullHash,
                syncConflict: true,
                conflictFieldsJson: conflictFields,
              }).where(eq(intakeRequests.id, existing.id));
              conflicts++;
            } else {
              await db.update(intakeRequests).set({
                spEtag: item.etag,
                ...mapped,
                spRawJson: fields,
                lastPulledAt: new Date(),
                lastPulledHash: pullHash,
                syncConflict: false,
                conflictFieldsJson: null,
              }).where(eq(intakeRequests.id, existing.id));
              updatedRequests++;
            }
          }
        } catch (itemErr: unknown) {
          const itemErrMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
          errors.push(`Item ${item.id}: ${itemErrMsg}`);
        }
      }

      await db.insert(syncAuditLog).values({
        action: "pull",
        direction: "pull",
        actorRole: user.role,
        summary: `Pull: ${newRequests} new, ${updatedRequests} updated, ${conflicts} conflicts`,
        itemCount: items.length,
        conflictCount: conflicts,
        errorCount: errors.length,
      });

      logAuditFromReq(req, {
        entityType: "intake_sync",
        entityId: "pull",
        action: "pull",
        changesJson: { newRequests, updatedRequests, conflicts, errors: errors.length },
      });

      res.json({
        success: true,
        connector: connector.name,
        pulled: items.length,
        newRequests,
        updatedRequests,
        conflicts,
        errors,
      });
    } catch (err: unknown) {
      console.error("[EngIntake] Pull error:", err);
      sendError(res, new ApiError(500, "SYNC_ERROR", "Pull failed"));
    }
  });

  app.post("/api/eng/intake/sync/push", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const connector = getConnector();
      const config = await getConfig();
      const siteId = config?.siteId || "mock";
      const listId = config?.listId || "mock";
      const user = getUser(req);

      const requests = await db.select().from(intakeRequests)
        .where(sql`${intakeRequests.spItemId} IS NOT NULL`);

      let pushed = 0;
      const errors: string[] = [];

      for (const intakeReq of requests) {
        try {
          if (!intakeReq.spItemId) continue;

          const pushFields: Record<string, unknown> = {
            AppProjectKey: intakeReq.clientKey || "",
            AppLastPushed: new Date().toISOString(),
            AppSyncStatus: intakeReq.syncConflict ? "CONFLICT" : "SYNCED",
            AppLink: intakeReq.projectId ? `/project/${intakeReq.projectId}` : "",
          };

          if (intakeReq.cpSigned) {
            pushFields.CPSigned = "Yes";
            pushFields.CPSignedDate = intakeReq.cpSignedDate || "";
          }

          await connector.updateItem(siteId, listId, intakeReq.spItemId, pushFields);

          await db.update(intakeRequests).set({
            lastPushedAt: new Date(),
          }).where(eq(intakeRequests.id, intakeReq.id));

          pushed++;
        } catch (itemErr: unknown) {
          const itemErrMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
          errors.push(`Request ${intakeReq.id}: ${itemErrMsg}`);
        }
      }

      await db.insert(syncAuditLog).values({
        action: "push",
        direction: "push",
        actorRole: user.role,
        summary: `Push: ${pushed} items updated in ${connector.name}`,
        itemCount: pushed,
        errorCount: errors.length,
      });

      logAuditFromReq(req, {
        entityType: "intake_sync",
        entityId: "push",
        action: "push",
        changesJson: { pushed, errors: errors.length },
      });

      res.json({
        success: true,
        connector: connector.name,
        pushed,
        errors,
      });
    } catch (err: unknown) {
      console.error("[EngIntake] Push error:", err);
      sendError(res, new ApiError(500, "SYNC_ERROR", "Push failed"));
    }
  });

  // ========== CONNECTOR STATUS ==========

  app.get("/api/eng/intake/status", jwtAuth, requireAuth, requireCOO, async (_req, res) => {
    try {
      const connector = getConnector();
      const config = await getConfig();

      const [requestCount] = await db.select({ count: sql<number>`count(*)` }).from(intakeRequests);
      const [conflictCount] = await db.select({ count: sql<number>`count(*)` }).from(intakeRequests)
        .where(eq(intakeRequests.syncConflict, true));

      res.json({
        connector: connector.name,
        available: connector.isAvailable(),
        configured: !!config,
        siteName: config?.siteName || null,
        listName: config?.listName || null,
        lastPulledAt: config?.lastPulledAt || null,
        lastPushedAt: config?.lastPushedAt || null,
        totalRequests: requestCount?.count || 0,
        conflictsCount: conflictCount?.count || 0,
      });
    } catch (err: unknown) {
      console.error("[EngIntake] Status error:", err);
      sendError(res, new ApiError(500, "INTERNAL_ERROR", "Failed to get intake status"));
    }
  });
}

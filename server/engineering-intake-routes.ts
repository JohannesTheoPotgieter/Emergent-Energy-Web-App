// @ts-nocheck
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { syncAuditLog, intakeRequests, projectInfo, spListConfig } from "@shared/schema";
import { getConnector, getConfig, mapSpFieldsToApp, normalizeClientKey, hashFields } from "./intake-connector";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import { logAuditFromReq } from "./audit-logger";

function getUser(req: Request) {
  return getEffectiveUser(req) || { id: 0, name: "Unknown", role: "viewer" };
}

function requireCOO(req: Request, res: Response, next: NextFunction) {
  const role = getUser(req)?.role || "";
  const cooRoles = ["COO_ADMIN", "CEO_ADMIN", "admin"];
  if (cooRoles.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "COO access required" });
}

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
    } catch (err: any) {
      console.error("[EngIntake] Fetch items error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch intake items", code: "CONNECTOR_ERROR" });
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

      if (!item) return res.status(404).json({ error: "Item not found" });

      const columns = await connector.getColumns(siteId, listId);

      res.json({
        ...item,
        columns,
      });
    } catch (err: any) {
      console.error("[EngIntake] Get item error:", err);
      res.status(500).json({ error: err.message || "Failed to get intake item", code: "CONNECTOR_ERROR" });
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
          const fields = item.fields as Record<string, any>;
          const clientName = fields.Client || fields.Title || "Unknown";
          const clientKey = normalizeClientKey(clientName);
          const spItemId = item.id;
          const mapped = mapSpFieldsToApp(fields);
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
            const conflictFields: Record<string, { sp: any; app: any }> = {};

            if (existing.lastAppEditAt && existing.lastPulledAt && existing.lastAppEditAt > existing.lastPulledAt) {
              for (const field of sharedFields) {
                const spVal = (mapped as any)[field];
                const appVal = (existing as any)[field];
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
        } catch (itemErr: any) {
          errors.push(`Item ${item.id}: ${itemErr.message}`);
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
    } catch (err: any) {
      console.error("[EngIntake] Pull error:", err);
      res.status(500).json({ error: err.message || "Pull failed", code: "SYNC_ERROR" });
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

      for (const req of requests) {
        try {
          if (!req.spItemId) continue;

          const pushFields: Record<string, any> = {
            AppProjectKey: req.clientKey || "",
            AppLastPushed: new Date().toISOString(),
            AppSyncStatus: req.syncConflict ? "CONFLICT" : "SYNCED",
            AppLink: req.projectId ? `/project/${req.projectId}` : "",
          };

          if (req.cpSigned) {
            pushFields.CPSigned = "Yes";
            pushFields.CPSignedDate = req.cpSignedDate || "";
          }

          await connector.updateItem(siteId, listId, req.spItemId, pushFields);

          await db.update(intakeRequests).set({
            lastPushedAt: new Date(),
          }).where(eq(intakeRequests.id, req.id));

          pushed++;
        } catch (itemErr: any) {
          errors.push(`Request ${req.id}: ${itemErr.message}`);
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
    } catch (err: any) {
      console.error("[EngIntake] Push error:", err);
      res.status(500).json({ error: err.message || "Push failed", code: "SYNC_ERROR" });
    }
  });

  // ========== CONNECTOR STATUS ==========

  app.get("/api/eng/intake/status", jwtAuth, requireAuth, requireCOO, async (_req, res) => {
    try {
      const connector = getConnector();
      const config = await getConfig();

      const [requestCount] = await db.select({ count: sql<number>`count(*)::int` }).from(intakeRequests);
      const [conflictCount] = await db.select({ count: sql<number>`count(*)::int` }).from(intakeRequests)
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
    } catch (err: any) {
      console.error("[EngIntake] Status error:", err);
      res.status(500).json({ error: "Failed to get intake status", code: "INTERNAL_ERROR" });
    }
  });
}

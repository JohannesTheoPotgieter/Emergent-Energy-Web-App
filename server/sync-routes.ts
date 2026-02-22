import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  intakeRequests, intakeTasks, intakeTaskTemplates,
  spListConfig, syncAuditLog, projectInfo,
  SP_OWNED_FIELDS, APP_OWNED_FIELDS, SHARED_FIELDS,
  type IntakeRequest, type InsertIntakeRequest,
} from "@shared/schema";
import {
  discoverSites, discoverSiteByUrl, discoverLists,
  getListColumns, getListItems, updateListItemFields,
  normalizeClientKey, hashFields, mapSpFieldsToApp,
  DEFAULT_COLUMN_MAP, getConfig, saveConfig,
  isSharePointListConfigured,
} from "./sharepoint-list";
import { getConnector } from "./intake-connector";

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required" });
}

function requireCOO(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role || "";
  if (role === "COO_ADMIN") return next();
  res.status(403).json({ error: "forbidden", message: "COO access required" });
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req as any).user?.role || "";
    if (roles.includes(role)) return next();
    res.status(403).json({ error: "forbidden", message: `Required role: ${roles.join(" or ")}` });
  };
}

function getUserRole(req: Request): string {
  return (req as any).user?.role || "";
}

export function registerSyncRoutes(app: Express) {

  // ===== SharePoint discovery =====
  app.get("/api/sp-sync/discover/sites", jwtAuth, requireAuth, requireCOO, async (_req, res) => {
    try {
      const sites = await discoverSites();
      res.json({ sites });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sp-sync/discover/site-by-url", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const { hostAndPath } = req.query;
      if (!hostAndPath) return res.status(400).json({ error: "hostAndPath required" });
      const site = await discoverSiteByUrl(hostAndPath as string);
      res.json(site);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sp-sync/discover/lists/:siteId", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const lists = await discoverLists(req.params.siteId);
      res.json({ lists });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sp-sync/discover/list-by-name/:siteId/:listName", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const { siteId, listName } = req.params;
      const { graphGet } = await import("./sharepoint-list");
      const result = await graphGet(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${encodeURIComponent(listName)}?$select=id,displayName,list`
      );
      if (result?.id) {
        res.json({ list: { id: result.id, displayName: result.displayName } });
      } else {
        res.json({ list: null, error: "List not found" });
      }
    } catch (err: any) {
      res.json({ list: null, error: err.message || "List not found with that name" });
    }
  });

  app.get("/api/sp-sync/discover/columns/:siteId/:listId", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const columns = await getListColumns(req.params.siteId, req.params.listId);
      res.json({ columns });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Config =====
  app.get("/api/sp-sync/config", jwtAuth, requireAuth, requireCOO, async (_req, res) => {
    try {
      const config = await getConfig();
      res.json({ config, isConfigured: isSharePointListConfigured() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sp-sync/config", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const { siteId, listId, siteName, listName, siteUrl, columnMappingJson, fieldOwnershipJson, syncViewFilter } = req.body;
      if (!siteId || !listId) return res.status(400).json({ error: "siteId and listId required" });
      const config = await saveConfig({
        siteId, listId, siteName, listName, siteUrl,
        columnMappingJson, fieldOwnershipJson,
        syncViewFilter: syncViewFilter || "IN PROGRESS",
        configuredByRole: getUserRole(req),
      });
      res.json({ config });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sp-sync/config/auto-detect", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const config = await getConfig();
      if (!config) return res.status(400).json({ error: "Configure site and list first" });

      const connector = getConnector();
      const columns = await connector.getColumns(config.siteId, config.listId);
      const mapping: Record<string, string> = {};
      const columnTypes: Record<string, string> = {};

      for (const col of columns) {
        if (col.readOnly && col.name !== "Title") continue;
        const defaultMap = DEFAULT_COLUMN_MAP[col.name] || DEFAULT_COLUMN_MAP[col.displayName];
        if (defaultMap) {
          mapping[col.name] = defaultMap;
          columnTypes[col.name] = col.columnType;
        }
      }

      await saveConfig({
        ...config,
        columnMappingJson: { mapping, columnTypes, detectedColumns: columns },
      });

      res.json({ mapping, columnTypes, totalColumns: columns.length, mappedColumns: Object.keys(mapping).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/sp-sync/config/mapping", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const config = await getConfig();
      if (!config) return res.status(400).json({ error: "Not configured" });

      const { mapping, columnTypes } = req.body;
      const existing = (config.columnMappingJson as any) || {};
      await saveConfig({
        ...config,
        columnMappingJson: {
          ...existing,
          mapping: { ...existing.mapping, ...mapping },
          columnTypes: { ...existing.columnTypes, ...columnTypes },
        },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== PULL from SharePoint =====
  app.post("/api/sp-sync/pull", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const config = await getConfig();
      if (!config) return res.status(400).json({ error: "SharePoint not configured" });

      const mappingData = config.columnMappingJson as any;
      if (!mappingData?.mapping) return res.status(400).json({ error: "Column mapping not configured. Run auto-detect first." });

      const columnMapping: Record<string, string> = mappingData.mapping;
      const columnTypes: Record<string, string> = mappingData.columnTypes || {};

      const statusFieldName = Object.entries(columnMapping).find(([, v]) => v === "status")?.[0] || "Status";

      const connector = getConnector();
      let items;
      if (config.syncViewFilter && config.syncViewFilter !== "ALL") {
        items = await connector.fetchItems(
          config.siteId,
          config.listId,
          `${statusFieldName} eq '${config.syncViewFilter}'`
        );
      } else {
        items = await connector.fetchItems(config.siteId, config.listId);
      }

      let newProjects = 0, newRequests = 0, updatedRequests = 0, conflicts = 0, errors = 0;
      const errorList: any[] = [];
      const conflictList: any[] = [];

      for (const item of items) {
        try {
          const mapped = mapSpFieldsToApp(item.fields, columnMapping, columnTypes);
          const clientName = mapped.clientName || item.fields.Title || "";
          if (!clientName) {
            errors++;
            errorList.push({ spItemId: item.id, error: "No client name found" });
            continue;
          }

          const clientKey = normalizeClientKey(clientName);

          let project = await db.select().from(projectInfo)
            .where(sql`LOWER(REPLACE(REPLACE(${projectInfo.projectName}, ' ', '_'), '-', '_')) = ${clientKey}`)
            .limit(1);

          let projectId: number | null = null;
          if (project.length === 0) {
            const existing = await db.select().from(projectInfo)
              .where(sql`LOWER(${projectInfo.projectName}) = LOWER(${clientName})`)
              .limit(1);

            if (existing.length > 0) {
              projectId = existing[0].id;
            } else {
              const [newProj] = await db.insert(projectInfo).values({
                projectName: clientName,
                phase: "First Assessment",
                isActive: true,
              }).returning();
              projectId = newProj.id;
              newProjects++;
            }
          } else {
            projectId = project[0].id;
          }

          const existingReq = await db.select().from(intakeRequests)
            .where(eq(intakeRequests.spItemId, item.id))
            .limit(1);

          const spFieldsHash = hashFields(mapped);

          if (existingReq.length === 0) {
            await db.insert(intakeRequests).values({
              spItemId: item.id,
              projectId,
              clientKey,
              clientName,
              requestType: mapped.requestType || null,
              status: mapped.status || null,
              priority: mapped.priority || null,
              dueDate: mapped.dueDate || null,
              daysInProgress: mapped.daysInProgress ? parseInt(String(mapped.daysInProgress)) : null,
              projectDeveloper: mapped.projectDeveloper || null,
              designer: mapped.designer || null,
              sizeKwp: mapped.sizeKwp || null,
              province: mapped.province || null,
              gpsCoordinates: mapped.gpsCoordinates || null,
              fundingType: mapped.fundingType || null,
              billsTariffData: mapped.billsTariffData || null,
              meteringData: mapped.meteringData || null,
              siteInspectionForm: mapped.siteInspectionForm || null,
              comments: mapped.comments || null,
              workingSchedule: mapped.workingSchedule || null,
              batteriesNeeded: mapped.batteriesNeeded || null,
              batterySize: mapped.batterySize || null,
              dieselGenNeeded: mapped.dieselGenNeeded || null,
              roofReplacementNeeded: mapped.roofReplacementNeeded || null,
              hseDiscussed: mapped.hseDiscussed || null,
              numberOfReworks: mapped.numberOfReworks ? parseInt(String(mapped.numberOfReworks)) : null,
              clickUpSynced: mapped.clickUpSynced || null,
              itemType: mapped.itemType || null,
              spPath: mapped.spPath || null,
              spEtag: item.etag || null,
              spRawJson: item.fields,
              lastPulledAt: new Date(),
              lastPulledHash: spFieldsHash,
            });
            newRequests++;
          } else {
            const existing = existingReq[0];

            if (existing.lastPulledHash === spFieldsHash) {
              continue;
            }

            const conflictFields: string[] = [];
            for (const sharedField of SHARED_FIELDS) {
              const spVal = mapped[sharedField];
              const appVal = (existing as any)[sharedField];
              if (
                spVal !== undefined &&
                appVal !== null &&
                appVal !== undefined &&
                String(spVal) !== String(appVal) &&
                existing.lastAppEditAt &&
                existing.lastPulledAt &&
                existing.lastAppEditAt > existing.lastPulledAt
              ) {
                conflictFields.push(sharedField);
              }
            }

            if (conflictFields.length > 0) {
              const conflictData: Record<string, { spValue: any; appValue: any }> = {};
              for (const field of conflictFields) {
                conflictData[field] = {
                  spValue: mapped[field],
                  appValue: (existing as any)[field],
                };
              }
              await db.update(intakeRequests)
                .set({
                  syncConflict: true,
                  conflictFieldsJson: conflictData,
                  spRawJson: item.fields,
                  spEtag: item.etag || null,
                  updatedAt: new Date(),
                })
                .where(eq(intakeRequests.id, existing.id));
              conflicts++;
              conflictList.push({ spItemId: item.id, clientName, fields: conflictFields, conflictData });
            } else {
              const updateData: any = {
                projectId,
                clientKey,
                spEtag: item.etag || null,
                spRawJson: item.fields,
                lastPulledAt: new Date(),
                lastPulledHash: spFieldsHash,
                syncConflict: false,
                conflictFieldsJson: null,
                updatedAt: new Date(),
              };

              for (const [, appField] of Object.entries(columnMapping)) {
                if ([...SP_OWNED_FIELDS, ...SHARED_FIELDS].includes(appField as any)) {
                  if (mapped[appField] !== undefined) {
                    updateData[appField] = mapped[appField];
                  }
                }
              }

              await db.update(intakeRequests)
                .set(updateData)
                .where(eq(intakeRequests.id, existing.id));
              updatedRequests++;
            }
          }
        } catch (err: any) {
          errors++;
          errorList.push({ spItemId: item.id, error: err.message });
        }
      }

      await saveConfig({ ...config, lastPulledAt: new Date() });

      const auditEntry = {
        action: "PULL",
        actorRole: getUserRole(req),
        direction: "SP_TO_APP",
        summary: { totalItems: items.length, syncViewFilter: config.syncViewFilter },
        errorsJson: errorList.length > 0 ? errorList : null,
        conflictsJson: conflictList.length > 0 ? conflictList : null,
        itemCount: items.length,
        newProjectsCount: newProjects,
        newRequestsCount: newRequests,
        updatedRequestsCount: updatedRequests,
        conflictsCount: conflicts,
        errorsCount: errors,
      };
      await db.insert(syncAuditLog).values(auditEntry);

      res.json({
        success: true,
        totalItems: items.length,
        newProjects,
        newRequests,
        updatedRequests,
        conflicts,
        errors,
        conflictList: conflictList.length > 0 ? conflictList : undefined,
        errorList: errorList.length > 0 ? errorList : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== PUSH to SharePoint =====
  app.post("/api/sp-sync/push", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const config = await getConfig();
      if (!config) return res.status(400).json({ error: "SharePoint not configured" });

      const requests = await db.select().from(intakeRequests);
      let pushed = 0, errors = 0;
      const errorList: any[] = [];
      const appUrl = req.protocol + "://" + req.get("host");

      for (const request of requests) {
        if (!request.spItemId) continue;

        try {
          const pushFields: Record<string, any> = {};

          const mappingData = config.columnMappingJson as any;
          const reverseMap: Record<string, string> = {};
          if (mappingData?.mapping) {
            for (const [spName, appField] of Object.entries(mappingData.mapping)) {
              reverseMap[appField as string] = spName;
            }
          }

          const appLinkCol = reverseMap["appLink"] || "AppLink";
          const appProjectKeyCol = reverseMap["appProjectKey"] || "AppProjectKey";
          const appLastPushedCol = reverseMap["appLastPushed"] || "AppLastPushed";
          const appSyncStatusCol = reverseMap["appSyncStatus"] || "AppSyncStatus";
          const cpSignedCol = reverseMap["cpSigned"] || "CPSigned";
          const cpSignedDateCol = reverseMap["cpSignedDate"] || "CPSignedDate";
          const pmCreatedCol = reverseMap["pmCreated"] || "PMCreated";

          pushFields[appProjectKeyCol] = request.clientKey;
          pushFields[appLastPushedCol] = new Date().toISOString();
          pushFields[appSyncStatusCol] = request.syncConflict ? "Conflict" : "Synced";

          if (request.cpSigned) {
            pushFields[cpSignedCol] = true;
            if (request.cpSignedDate) pushFields[cpSignedDateCol] = request.cpSignedDate;
          }
          if (request.pmCreated) {
            pushFields[pmCreatedCol] = true;
          }

          if (request.projectId) {
            pushFields[appLinkCol] = {
              Description: `${request.clientName} - EE Dashboard`,
              Url: `${appUrl}/projects/${request.projectId}`,
            };
          }

          const { forcePushShared } = req.body || {};
          if (forcePushShared) {
            if (reverseMap["status"] && request.status) pushFields[reverseMap["status"]] = request.status;
            if (reverseMap["comments"] && request.comments) pushFields[reverseMap["comments"]] = request.comments;
          }

          const connector = getConnector();
          await connector.updateItem(config.siteId, config.listId, request.spItemId, pushFields);

          await db.update(intakeRequests)
            .set({ lastPushedAt: new Date(), updatedAt: new Date() })
            .where(eq(intakeRequests.id, request.id));

          pushed++;
        } catch (err: any) {
          errors++;
          errorList.push({ spItemId: request.spItemId, clientName: request.clientName, error: err.message });
        }
      }

      await saveConfig({ ...config, lastPushedAt: new Date() });

      await db.insert(syncAuditLog).values({
        action: "PUSH",
        actorRole: getUserRole(req),
        direction: "APP_TO_SP",
        summary: { totalPushed: pushed },
        errorsJson: errorList.length > 0 ? errorList : null,
        itemCount: pushed,
        newProjectsCount: 0,
        newRequestsCount: 0,
        updatedRequestsCount: pushed,
        conflictsCount: 0,
        errorsCount: errors,
      });

      res.json({ success: true, pushed, errors, errorList: errorList.length > 0 ? errorList : undefined });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Resolve conflicts =====
  app.post("/api/sp-sync/resolve-conflict/:requestId", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const { requestId } = req.params;
      const { resolutions } = req.body;

      const [request] = await db.select().from(intakeRequests)
        .where(eq(intakeRequests.id, parseInt(requestId)));
      if (!request) return res.status(404).json({ error: "Request not found" });
      if (!request.syncConflict) return res.status(400).json({ error: "No conflict to resolve" });

      const updates: any = { syncConflict: false, conflictFieldsJson: null, updatedAt: new Date() };

      for (const [field, decision] of Object.entries(resolutions as Record<string, string>)) {
        const conflictData = request.conflictFieldsJson as any;
        if (decision === "keep_sp") {
          updates[field] = conflictData?.[field]?.spValue;
        } else if (decision === "keep_app") {
          // keep current app value
        } else if (decision === "merge" && field === "comments") {
          const spVal = conflictData?.[field]?.spValue || "";
          const appVal = (request as any)[field] || "";
          updates[field] = `${appVal}\n---\n[SP] ${spVal}`;
        }
      }

      await db.update(intakeRequests).set(updates).where(eq(intakeRequests.id, parseInt(requestId)));

      await db.insert(syncAuditLog).values({
        action: "RESOLVE_CONFLICT",
        actorRole: getUserRole(req),
        direction: "MANUAL",
        summary: { requestId: parseInt(requestId), resolutions },
        itemCount: 1,
        newProjectsCount: 0,
        newRequestsCount: 0,
        updatedRequestsCount: 1,
        conflictsCount: 0,
        errorsCount: 0,
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== CP Signed Gate =====
  app.post("/api/sp-sync/cp-signed/:requestId", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const { requestId } = req.params;
      const { evidenceType, evidenceRef, signedDate } = req.body;

      const [request] = await db.select().from(intakeRequests)
        .where(eq(intakeRequests.id, parseInt(requestId)));
      if (!request) return res.status(404).json({ error: "Request not found" });
      if (request.cpSigned) return res.status(400).json({ error: "CP already signed" });

      await db.update(intakeRequests).set({
        cpSigned: true,
        cpSignedDate: signedDate || new Date().toISOString().split("T")[0],
        cpSignedBy: getUserRole(req),
        cpEvidenceType: evidenceType || "manual",
        cpEvidenceRef: evidenceRef || null,
        updatedAt: new Date(),
      }).where(eq(intakeRequests.id, parseInt(requestId)));

      if (request.projectId && !request.pmCreated) {
        await db.update(intakeRequests).set({
          pmCreated: true,
          updatedAt: new Date(),
        }).where(eq(intakeRequests.id, parseInt(requestId)));
      }

      if (!request.tasksGenerated && request.requestType) {
        const templates = await db.select().from(intakeTaskTemplates)
          .where(and(
            eq(intakeTaskTemplates.requestType, request.requestType),
            eq(intakeTaskTemplates.isActive, true),
          ))
          .orderBy(intakeTaskTemplates.sortOrder);

        if (templates.length > 0) {
          for (const tmpl of templates) {
            await db.insert(intakeTasks).values({
              intakeRequestId: parseInt(requestId),
              templateItemId: tmpl.id,
              title: tmpl.title,
              description: tmpl.description,
              dodItems: tmpl.dodItems,
              dodCompletedJson: null,
              sortOrder: tmpl.sortOrder,
            });
          }
          await db.update(intakeRequests).set({
            tasksGenerated: true,
            updatedAt: new Date(),
          }).where(eq(intakeRequests.id, parseInt(requestId)));
        }
      }

      await db.insert(syncAuditLog).values({
        action: "CP_SIGNED",
        actorRole: getUserRole(req),
        direction: "APP",
        summary: { requestId: parseInt(requestId), clientName: request.clientName, evidenceType, evidenceRef },
        itemCount: 1,
        newProjectsCount: 0,
        newRequestsCount: 0,
        updatedRequestsCount: 1,
        conflictsCount: 0,
        errorsCount: 0,
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Intake Requests CRUD =====
  app.get("/api/sp-sync/intake-requests", jwtAuth, requireAuth, async (_req, res) => {
    try {
      const requests = await db.select().from(intakeRequests).orderBy(desc(intakeRequests.updatedAt));
      res.json({ requests });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sp-sync/intake-requests/:id", jwtAuth, requireAuth, async (req, res) => {
    try {
      const [request] = await db.select().from(intakeRequests)
        .where(eq(intakeRequests.id, parseInt(req.params.id)));
      if (!request) return res.status(404).json({ error: "Not found" });

      const tasks = await db.select().from(intakeTasks)
        .where(eq(intakeTasks.intakeRequestId, request.id))
        .orderBy(intakeTasks.sortOrder);

      res.json({ request, tasks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sp-sync/intake-requests/by-project/:projectId", jwtAuth, requireAuth, async (req, res) => {
    try {
      const requests = await db.select().from(intakeRequests)
        .where(eq(intakeRequests.projectId, parseInt(req.params.projectId)))
        .orderBy(desc(intakeRequests.updatedAt));
      res.json({ requests });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/sp-sync/intake-requests/:id", jwtAuth, requireAuth, async (req, res) => {
    try {
      const allowedFields = ["appNotes", "appInternalBlockers", "status", "comments", "priority"];
      const updates: any = { lastAppEditAt: new Date(), updatedAt: new Date() };

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const [updated] = await db.update(intakeRequests)
        .set(updates)
        .where(eq(intakeRequests.id, parseInt(req.params.id)))
        .returning();

      res.json({ request: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Intake Tasks =====
  app.get("/api/sp-sync/intake-tasks/:requestId", jwtAuth, requireAuth, async (req, res) => {
    try {
      const tasks = await db.select().from(intakeTasks)
        .where(eq(intakeTasks.intakeRequestId, parseInt(req.params.requestId)))
        .orderBy(intakeTasks.sortOrder);
      res.json({ tasks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/sp-sync/intake-tasks/:taskId", jwtAuth, requireAuth, async (req, res) => {
    try {
      const { status, dodCompletedJson, assignedTo } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (status !== undefined) updates.status = status;
      if (dodCompletedJson !== undefined) updates.dodCompletedJson = dodCompletedJson;
      if (assignedTo !== undefined) updates.assignedTo = assignedTo;
      if (status === "COMPLETED") {
        updates.completedAt = new Date();
        updates.completedBy = getUserRole(req);
      }

      const [updated] = await db.update(intakeTasks)
        .set(updates)
        .where(eq(intakeTasks.id, parseInt(req.params.taskId)))
        .returning();
      res.json({ task: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Generate tasks for a request =====
  app.post("/api/sp-sync/generate-tasks/:requestId", jwtAuth, requireAuth, requireCOO, async (req, res) => {
    try {
      const [request] = await db.select().from(intakeRequests)
        .where(eq(intakeRequests.id, parseInt(req.params.requestId)));
      if (!request) return res.status(404).json({ error: "Not found" });
      if (request.tasksGenerated) return res.status(400).json({ error: "Tasks already generated" });

      const requestType = req.body.requestType || request.requestType;
      if (!requestType) return res.status(400).json({ error: "No request type specified" });

      const templates = await db.select().from(intakeTaskTemplates)
        .where(and(
          eq(intakeTaskTemplates.requestType, requestType),
          eq(intakeTaskTemplates.isActive, true),
        ))
        .orderBy(intakeTaskTemplates.sortOrder);

      for (const tmpl of templates) {
        await db.insert(intakeTasks).values({
          intakeRequestId: parseInt(req.params.requestId),
          templateItemId: tmpl.id,
          title: tmpl.title,
          description: tmpl.description,
          dodItems: tmpl.dodItems,
          sortOrder: tmpl.sortOrder,
        });
      }

      await db.update(intakeRequests).set({
        tasksGenerated: true,
        requestType: requestType,
        updatedAt: new Date(),
      }).where(eq(intakeRequests.id, parseInt(req.params.requestId)));

      res.json({ success: true, tasksCreated: templates.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Task templates CRUD =====
  app.get("/api/sp-sync/task-templates", jwtAuth, requireAuth, async (_req, res) => {
    try {
      const templates = await db.select().from(intakeTaskTemplates)
        .orderBy(intakeTaskTemplates.requestType, intakeTaskTemplates.sortOrder);
      res.json({ templates });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Sync Audit Log =====
  app.get("/api/sp-sync/audit-log", jwtAuth, requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await db.select().from(syncAuditLog)
        .orderBy(desc(syncAuditLog.createdAt))
        .limit(limit);
      res.json({ logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== Status =====
  app.get("/api/sp-sync/status", jwtAuth, requireAuth, async (_req, res) => {
    try {
      const config = await getConfig();
      const totalRequests = await db.select({ count: sql<number>`count(*)` }).from(intakeRequests);
      const conflictRequests = await db.select({ count: sql<number>`count(*)` }).from(intakeRequests)
        .where(eq(intakeRequests.syncConflict, true));

      const connector = getConnector();
      res.json({
        configured: !!config,
        connectorAvailable: connector.isAvailable(),
        connectorName: connector.name,
        lastPulledAt: config?.lastPulledAt,
        lastPushedAt: config?.lastPushedAt,
        totalRequests: totalRequests[0]?.count || 0,
        conflictsCount: conflictRequests[0]?.count || 0,
        siteName: config?.siteName,
        listName: config?.listName,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

}

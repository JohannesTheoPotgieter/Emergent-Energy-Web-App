import type { Express } from "express";
import { getEffectiveUser, requireAuth } from "./auth-context";
import { getPresenceCached } from "./microsoft/presence";
import { graphWithResilience } from "./microsoft/tokenManager";
import { isConnectorMocked } from "./lib/connector-mode";
import { getSharePointToken } from "./sharepoint-token";
import { getSsoTokenForUser } from "./ms-account-service";
import { getProjectRootByProjectId } from "./repositories/project-sharepoint-roots-repository";
import { listChildren as listDocumentChildren } from "./services/sharepoint-document-service";

export function registerMicrosoftIntegrationEnhancementRoutes(app: Express) {
  app.get("/api/microsoft/presence/:id", requireAuth, async (req, res) => {
    if (isConnectorMocked("ms-graph")) {
      return res.json({ availability: "Available", activity: "Available", fetchedAt: Date.now() });
    }
    try {
      const user = getEffectiveUser(req);
      const token = user ? await getSsoTokenForUser(user.id) : null;
      if (!token) {
        return res.json({ availability: "Unknown", activity: "Unknown", fetchedAt: Date.now() });
      }
      const data = await getPresenceCached(req.params.id as string, token);
      res.json(data);
    } catch {
      res.json({ availability: "Unknown", activity: "Unknown", fetchedAt: Date.now() });
    }
  });

  app.get("/api/projects/:id/sharepoint-documents", requireAuth, async (req, res) => {
    const rawId = req.params.id as string;
    const projectId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return res.json({ items: [] });
    }
    try {
      const root = await getProjectRootByProjectId(projectId);
      if (!root?.driveId) return res.json({ items: [] });
      const items = await listDocumentChildren(root.driveId, root.rootItemId ?? null);
      res.json({
        items: items.map((d) => ({
          id: d.id,
          name: d.name,
          webUrl: d.webUrl,
          lastModifiedDateTime: d.lastModifiedDateTime,
        })),
      });
    } catch {
      res.json({ items: [] });
    }
  });

  app.get("/api/projects/:id/meetings", requireAuth, async (req, res) => {
    if (isConnectorMocked("ms-graph")) {
      return res.json({ items: [] });
    }
    try {
      const user = getEffectiveUser(req);
      const token = user ? await getSsoTokenForUser(user.id) : null;
      if (!token) return res.json({ items: [] });
      const events = await graphWithResilience<{ value?: Array<Record<string, unknown>> }>(
        `/me/events?$search="Project ${req.params.id}"`,
        token,
      );
      res.json({
        items: (events?.value || []).map((e) => {
          const event = e as {
            id?: string;
            subject?: string;
            start?: { dateTime?: string };
            end?: { dateTime?: string };
            attendees?: Array<{ emailAddress?: { name?: string } }>;
          };
          return {
            id: event.id,
            title: event.subject,
            start: event.start?.dateTime,
            end: event.end?.dateTime,
            attendees: (event.attendees || []).map((a) => a?.emailAddress?.name).filter(Boolean),
          };
        }),
      });
    } catch {
      res.json({ items: [] });
    }
  });
}

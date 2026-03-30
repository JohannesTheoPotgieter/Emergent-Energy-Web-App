import type { Express } from "express";
import { requireAuth } from "./auth-context";
import { getPresenceCached } from "./microsoft/presence";
import { graphWithResilience } from "./microsoft/tokenManager";

export function registerMicrosoftIntegrationEnhancementRoutes(app: Express) {
  app.get("/api/microsoft/presence/:id", requireAuth, async (req, res) => {
    try {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      const data = await getPresenceCached(req.params.id as string, token);
      res.json(data);
    } catch {
      res.json({ availability: "Unknown", activity: "Unknown", fetchedAt: Date.now() });
    }
  });

  app.get("/api/projects/:id/sharepoint-documents", requireAuth, async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    try {
      const docs = await graphWithResilience<any>(`/sites/root/drive/root:/Projects/${req.params.id}:/children`, token);
      res.json({ items: (docs?.value || []).map((d: any) => ({ id: d.id, name: d.name, webUrl: d.webUrl, lastModifiedDateTime: d.lastModifiedDateTime })) });
    } catch {
      res.json({ items: [] });
    }
  });

  app.get("/api/projects/:id/meetings", requireAuth, async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    try {
      const events = await graphWithResilience<any>(`/me/events?$search="Project ${req.params.id}"`, token);
      res.json({ items: (events?.value || []).map((e: any) => ({ id: e.id, title: e.subject, start: e.start?.dateTime, end: e.end?.dateTime, attendees: (e.attendees || []).map((a: any) => a?.emailAddress?.name).filter(Boolean) })) });
    } catch {
      res.json({ items: [] });
    }
  });
}

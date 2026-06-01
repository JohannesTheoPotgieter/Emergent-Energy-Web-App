import type { Express } from "express";
import { getEffectiveUser, requireAuth } from "./auth-context";
import { getPresenceCached } from "./microsoft/presence";
import { graphWithResilience } from "./microsoft/tokenManager";
import { isConnectorMocked } from "./lib/connector-mode";
import { getSharePointToken } from "./sharepoint-token";
import { getSsoTokenForUser } from "./ms-account-service";

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

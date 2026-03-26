import type { Express } from "express";
import { db, getDbMode } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth, getEffectiveUser } from "./auth-context";

const DEFAULTS = {
  layout: [],
  pinned_projects: [],
  default_period: "ytd",
  theme: "system",
};

async function ensureTable() {
  const isPostgres = getDbMode() === "postgres";
  const idCol = isPostgres ? "id SERIAL PRIMARY KEY" : "id INTEGER PRIMARY KEY AUTOINCREMENT";
  const timestampDefault = isPostgres ? "DEFAULT NOW()" : "DEFAULT CURRENT_TIMESTAMP";

  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
    ${idCol},
    user_id INTEGER NOT NULL UNIQUE,
    layout TEXT NOT NULL DEFAULT '[]',
    pinned_projects TEXT NOT NULL DEFAULT '[]',
    default_period TEXT NOT NULL DEFAULT 'ytd',
    theme TEXT NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL ${timestampDefault}
  )`));
}

export function registerUserDashboardPreferenceRoutes(app: Express) {
  app.get("/api/user/dashboard-preferences", requireAuth, async (req, res) => {
    try {
      await ensureTable();
      const user = getEffectiveUser(req);
      const rows = await db.execute(sql`SELECT * FROM user_dashboard_preferences WHERE user_id = ${user?.id} LIMIT 1`);
      const row = (rows as any).rows?.[0];
      if (!row) return res.json(DEFAULTS);
      res.json({
        layout: JSON.parse(String(row.layout || "[]")),
        pinned_projects: JSON.parse(String(row.pinned_projects || "[]")),
        default_period: row.default_period || "ytd",
        theme: row.theme || "system",
        updated_at: row.updated_at,
      });
    } catch (err) {
      console.error("[DashPrefs] Failed to fetch preferences:", err);
      res.status(500).json({ error: "Failed to fetch dashboard preferences" });
    }
  });

  app.put("/api/user/dashboard-preferences", requireAuth, async (req, res) => {
    try {
      await ensureTable();
      const user = getEffectiveUser(req);
      const payload = {
        layout: JSON.stringify(req.body?.layout || []),
        pinned_projects: JSON.stringify(req.body?.pinned_projects || []),
        default_period: req.body?.default_period || "ytd",
        theme: req.body?.theme || "system",
        updated_at: new Date().toISOString(),
      };
      await db.execute(sql`
        INSERT INTO user_dashboard_preferences (user_id, layout, pinned_projects, default_period, theme, updated_at)
        VALUES (${user?.id}, ${payload.layout}, ${payload.pinned_projects}, ${payload.default_period}, ${payload.theme}, ${payload.updated_at})
        ON CONFLICT(user_id) DO UPDATE SET
          layout = excluded.layout,
          pinned_projects = excluded.pinned_projects,
          default_period = excluded.default_period,
          theme = excluded.theme,
          updated_at = excluded.updated_at
      `);
      res.json({ ok: true });
    } catch (err) {
      console.error("[DashPrefs] Failed to save preferences:", err);
      res.status(500).json({ error: "Failed to save dashboard preferences" });
    }
  });
}

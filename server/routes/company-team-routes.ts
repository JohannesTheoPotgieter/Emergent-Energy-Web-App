import type { Express } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { getCompanyTeamData } from "../services/company-team-service";

export function registerCompanyTeamRoutes(app: Express) {
  app.get(
    "/api/company/team",
    requireAuth,
    requirePermission("company_team", "view"),
    async (_req, res) => {
      try {
        const data = await getCompanyTeamData();
        res.json(data);
      } catch (err: unknown) {
        console.error(
          "[CompanyTeam] Error:",
          err instanceof Error ? err.message : String(err),
        );
        res.status(500).json({ error: "Failed to load company team data" });
      }
    },
  );
}

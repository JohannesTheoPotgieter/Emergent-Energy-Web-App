import type { Express } from "express";
import { requireAuth } from "../auth-context";
import { getCompanyOverviewData } from "../services/company-overview-service";

export function registerCompanyOverviewRoutes(app: Express) {
  app.get("/api/company-overview", requireAuth, async (_req, res) => {
    try {
      const data = await getCompanyOverviewData();
      res.json(data);
    } catch (err: unknown) {
      console.error("[CompanyOverview] Error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to load company overview data" });
    }
  });
}

import type { Express } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { getCompanyOverviewData } from "../services/company-overview-service";
import { setFinanceTrustHeaders } from "../lib/finance-trust/envelope";

export function registerCompanyOverviewRoutes(app: Express) {
  app.get("/api/company-overview", requireAuth, requirePermission("execution_board", "view"), async (_req, res) => {
    try {
      const data = await getCompanyOverviewData();
      setFinanceTrustHeaders(res, {
        sourceLayer: "canonical",
        canonicalTable: "normalized_cost_lines,normalized_revenue_lines,project_info",
        refreshedAt: (data as any)?.meta?.refreshedAt,
        nullCount: (data as any)?.nullCount,
      });
      res.json(data);
    } catch (err: unknown) {
      console.error("[CompanyOverview] Error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to load company overview data" });
    }
  });
}

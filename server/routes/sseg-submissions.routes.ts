/**
 * SSEG Submissions routes — canonical Project Delivery screen.
 *
 * Reuses existing `sseg_applications` data via
 * `ssegSubmissionsRepository`. Permission entity: `hse_sseg`.
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "../departments/shared-middleware";
import { checkPermission, normalizeRoleForPermissions } from "@shared/schema";
import { ssegSubmissionsRepository } from "../repositories/sseg-submissions-repository";

const router = Router();

function getRole(req: Request): string {
  const r = (req.user as any)?.role || (req as any).session?.user?.role || "";
  return normalizeRoleForPermissions(r);
}

router.get("/api/sseg-submissions", requireAuth, async (req: Request, res: Response) => {
  try {
    const role = getRole(req);
    if (!checkPermission(role, "hse_sseg", "view")) {
      return res.status(403).json({ error: "forbidden" });
    }

    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const [rows, kpis] = await Promise.all([
      ssegSubmissionsRepository.list({ projectId }),
      ssegSubmissionsRepository.kpis(),
    ]);

    res.json({
      rows,
      kpis,
      capabilities: {
        canCreate: checkPermission(role, "hse_sseg", "create"),
        canEdit: checkPermission(role, "hse_sseg", "edit"),
      },
    });
  } catch (err) {
    console.error("[SsegSubmissions] Failed to list:", err);
    res.status(500).json({ error: "Failed to fetch SSEG submissions" });
  }
});

export function registerSsegSubmissionsRoutes(app: Express) {
  app.use(router);
}

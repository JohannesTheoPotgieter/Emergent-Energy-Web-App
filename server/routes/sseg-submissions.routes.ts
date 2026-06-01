/**
 * SSEG Submissions routes — canonical Project Delivery screen.
 *
 * Reuses existing `sseg_applications` data via
 * `ssegSubmissionsRepository`. Permission entity: `hse_sseg`.
 *
 * F28: uses the canonical `requirePermission` middleware + the entity
 * permission resolver (which understands lens-impersonation and role
 * aliases). The previous hand-rolled role read missed both.
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "../departments/shared-middleware";
import { requirePermission, evaluatePermissionForRequest } from "../permission-middleware";
import { ssegSubmissionsRepository } from "../repositories/sseg-submissions-repository";

const router = Router();

router.get(
  "/api/sseg-submissions",
  requireAuth,
  requirePermission("hse_sseg", "view"),
  async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      const [rows, kpis, canCreateResult, canEditResult] = await Promise.all([
        ssegSubmissionsRepository.list({ projectId }),
        ssegSubmissionsRepository.kpis(),
        evaluatePermissionForRequest(req, "hse_sseg", "create"),
        evaluatePermissionForRequest(req, "hse_sseg", "edit"),
      ]);

      res.json({
        rows,
        kpis,
        capabilities: {
          canCreate: canCreateResult.allowed,
          canEdit: canEditResult.allowed,
        },
      });
    } catch (err) {
      console.error("[SsegSubmissions] Failed to list:", err);
      res.status(500).json({ error: "Failed to fetch SSEG submissions" });
    }
  },
);

export function registerSsegSubmissionsRoutes(app: Express) {
  app.use(router);
}

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  derivedProjectKpis,
  derivedPortfolioKpis,
  derivedRagSummary,
  projectInfo,
  normalizedCostLines,
  normalizedRevenueLines,
  normalizedPlanTasks,
  normalizedExecutionPhases,
} from "@shared/schema";
import {
  previewTrackerUpload,
  commitProjectFromTracker,
  rebuildDerivedTables,
  getFeatureFlag,
  setFeatureFlag,
} from "./lib/bootstrap-import";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return next();
  const token = authHeader.substring(7);
  try {
    const payload = verifyToken(token);
    (req as any).user = payload;
    next();
  } catch {
    next();
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  res.status(401).json({ error: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const role = user.role || "";
  const adminRoles = ["COO_ADMIN", "CEO_ADMIN", "admin"];
  if (!adminRoles.includes(role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

router.use(jwtAuth);

router.post("/preview", requireAuth, requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const result = await previewTrackerUpload(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/preview-batch", requireAuth, requireAdmin, upload.array("files", 50), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

    const results: Array<{ fileName: string; preview?: any; error?: string }> = [];
    for (const file of files) {
      try {
        const preview = await previewTrackerUpload(file.buffer, file.originalname);
        results.push({ fileName: file.originalname, preview });
      } catch (err: any) {
        results.push({ fileName: file.originalname, error: err.message });
      }
    }
    res.json({ results, totalFiles: files.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/commit", requireAuth, requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const user = (req as any).user;
    const overrideName = req.body.projectName || undefined;
    const result = await commitProjectFromTracker(
      req.file.buffer,
      req.file.originalname,
      overrideName,
      user.id || 1
    );
    res.json(result);
  } catch (error: any) {
    if (error.message.includes("already exists")) {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post("/commit-batch", requireAuth, requireAdmin, upload.array("files", 50), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

    const user = (req as any).user;
    let nameOverrides: Record<string, string> = {};
    try {
      if (req.body.nameOverrides) nameOverrides = JSON.parse(req.body.nameOverrides);
    } catch {}

    const results: Array<{ fileName: string; result?: any; error?: string }> = [];
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      try {
        const overrideName = nameOverrides[String(idx)] || nameOverrides[file.originalname] || undefined;
        const result = await commitProjectFromTracker(
          file.buffer,
          file.originalname,
          overrideName,
          user.id || 1
        );
        results.push({ fileName: file.originalname, result });
      } catch (err: any) {
        results.push({ fileName: file.originalname, error: err.message });
      }
    }
    res.json({ results, committed: results.filter(r => r.result).length, failed: results.filter(r => r.error).length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/projects", requireAuth, async (_req: Request, res: Response) => {
  try {
    const projects = await db.select().from(projectInfo);
    const costs = await db.select({ projectId: normalizedCostLines.projectId }).from(normalizedCostLines);
    const revenue = await db.select({ projectId: normalizedRevenueLines.projectId }).from(normalizedRevenueLines);
    const plans = await db.select({ projectId: normalizedPlanTasks.projectId }).from(normalizedPlanTasks);

    const summary = projects.map((p: any) => ({
      id: p.id,
      projectName: p.projectName,
      projectPhase: p.projectPhase || null,
      contractValue: p.contractValue,
      costLineCount: costs.filter((c: any) => c.projectId === p.id).length,
      revenueLineCount: revenue.filter((r: any) => r.projectId === p.id).length,
      planTaskCount: plans.filter((t: any) => t.projectId === p.id).length,
    }));

    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/rebuild-derived", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    await rebuildDerivedTables();
    res.json({ message: "Derived tables rebuilt successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/derived/projects", requireAuth, async (_req: Request, res: Response) => {
  try {
    const kpis = await db.select().from(derivedProjectKpis);
    res.json(kpis);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/derived/portfolio", requireAuth, async (_req: Request, res: Response) => {
  try {
    const [portfolio] = await db.select().from(derivedPortfolioKpis)
      .where(eq(derivedPortfolioKpis.snapshotKey, "current")).limit(1);
    res.json(portfolio || null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/derived/rag", requireAuth, async (_req: Request, res: Response) => {
  try {
    const rag = await db.select().from(derivedRagSummary);
    res.json(rag);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/feature-flag", requireAuth, async (_req: Request, res: Response) => {
  try {
    const enabled = await getFeatureFlag("USE_NEW_DASHBOARD_ROLLUPS");
    res.json({ USE_NEW_DASHBOARD_ROLLUPS: enabled });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/feature-flag", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    const user = (req as any).user;
    await setFeatureFlag("USE_NEW_DASHBOARD_ROLLUPS", !!enabled, user.role || "admin");
    res.json({ USE_NEW_DASHBOARD_ROLLUPS: !!enabled, message: `Dashboard rollups ${enabled ? "enabled" : "disabled"}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export function registerBootstrapImportRoutes(app: any) {
  app.use("/api/bootstrap-import", router);
}

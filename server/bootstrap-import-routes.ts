import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  bootstrapImportRuns,
  stagingBootstrapProjects,
  derivedProjectKpis,
  derivedPortfolioKpis,
  derivedRagSummary,
} from "@shared/schema";
import {
  discoverSourceFiles,
  runBootstrapImport,
  rebuildDerivedTables,
  getFeatureFlag,
  setFeatureFlag,
} from "./lib/bootstrap-import";

const router = Router();

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

router.post("/scan", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const sourcePath = req.body.sourcePath || process.cwd() + "/uploads";
    const result = await discoverSourceFiles(sourcePath);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/run", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const sourcePath = req.body.sourcePath || process.cwd() + "/uploads";
    const { runId } = await runBootstrapImport(sourcePath, user.id || 1, user.role || "admin");
    res.json({ runId, message: "Bootstrap import started" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/runs", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const runs = await db.select().from(bootstrapImportRuns).orderBy(desc(bootstrapImportRuns.startedAt)).limit(50);
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/runs/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [run] = await db.select().from(bootstrapImportRuns).where(eq(bootstrapImportRuns.id, id));
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json(run);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/report/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [run] = await db.select().from(bootstrapImportRuns).where(eq(bootstrapImportRuns.id, id));
    if (!run) return res.status(404).json({ error: "Run not found" });

    const staging = await db.select().from(stagingBootstrapProjects)
      .where(eq(stagingBootstrapProjects.importRunId, id));

    const quarantined = staging.filter(s => s.needsReview || s.parseStatus === "FAILED");
    const successful = staging.filter(s => s.parseStatus === "OK" && !s.needsReview);

    res.json({
      run,
      staging: staging.map(s => ({
        id: s.id,
        sourcePath: s.sourcePath,
        projectNameExtracted: s.projectNameExtracted,
        canonicalProjectName: s.canonicalProjectName,
        parseStatus: s.parseStatus,
        errorReason: s.errorReason,
        planRowCount: s.planRowCount,
        revenueRowCount: s.revenueRowCount,
        costRowCount: s.costRowCount,
        needsReview: s.needsReview,
        sheetsFound: s.sheetsFound,
      })),
      quarantined: quarantined.map(q => ({
        id: q.id,
        projectNameExtracted: q.projectNameExtracted,
        parseStatus: q.parseStatus,
        errorReason: q.errorReason,
        rawJson: q.rawJson,
      })),
      validation: run.validationJson,
      summary: {
        discovered: run.discoveredCount,
        imported: run.importedCount,
        updated: run.updatedCount,
        skipped: run.skippedCount,
        quarantined: run.quarantinedCount,
        errors: run.errorsCount,
        successCount: successful.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/report/:id/download", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [run] = await db.select().from(bootstrapImportRuns).where(eq(bootstrapImportRuns.id, id));
    if (!run) return res.status(404).json({ error: "Run not found" });

    const staging = await db.select().from(stagingBootstrapProjects)
      .where(eq(stagingBootstrapProjects.importRunId, id));

    const report = {
      run: { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt },
      counts: {
        discovered: run.discoveredCount,
        imported: run.importedCount,
        updated: run.updatedCount,
        skipped: run.skippedCount,
        quarantined: run.quarantinedCount,
        errors: run.errorsCount,
      },
      validation: run.validationJson,
      projects: staging.map(s => ({
        projectName: s.projectNameExtracted,
        canonicalName: s.canonicalProjectName,
        parseStatus: s.parseStatus,
        errorReason: s.errorReason,
        plans: s.planRowCount,
        revenue: s.revenueRowCount,
        costs: s.costRowCount,
        needsReview: s.needsReview,
      })),
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="bootstrap-import-run-${id}.json"`);
    res.send(JSON.stringify(report, null, 2));
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

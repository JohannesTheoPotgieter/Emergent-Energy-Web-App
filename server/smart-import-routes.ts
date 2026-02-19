// Smart Import API Routes
// Register in server/index.ts: import { registerSmartImportRoutes } from "./smart-import-routes"; registerSmartImportRoutes(app);

import { Express, Request, Response, NextFunction, Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "./db";
import { verifyToken } from "./jwt";
import { runSmartImportPreview } from "./lib/import/index";
import {
  smartImportRuns,
  importIssues,
  normalizedPlanTasks,
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedExecutionPhases,
  counterparties,
  mappingRules,
  templateProfiles,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
      cb(null, `${timestamp}_${sanitized}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
      "application/vnd.ms-excel",
    ];
    if (
      allowedMimes.includes(file.mimetype) ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xlsm") ||
      file.originalname.endsWith(".xls")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only Excel files (.xlsx, .xlsm, .xls) are allowed."));
    }
  },
});

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

router.use(jwtAuth);

// POST /api/smart-import/upload
router.post("/api/smart-import/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;

    const buffer = fs.readFileSync(filePath);

    console.log(`[SmartImport] Processing file: ${fileName} (${buffer.length} bytes)`);
    
    const ExcelJS = require("exceljs");
    const debugWorkbook = new ExcelJS.Workbook();
    await debugWorkbook.xlsx.load(buffer);
    const sheetNames = debugWorkbook.worksheets.map((ws: any) => ws.name);
    console.log(`[SmartImport] Sheet names found: ${JSON.stringify(sheetNames)}`);

    const preview = await runSmartImportPreview(buffer, fileName);
    
    console.log(`[SmartImport] Detection result: ${preview.detection.sections.length} sections detected, ${preview.detection.unmatched.length} unmatched`);
    for (const s of preview.detection.sections) {
      console.log(`[SmartImport]   Section: ${s.section} in sheet "${s.sheetName}" (confidence: ${s.confidence}, headers: ${s.detectedHeaders.length})`);
    }
    for (const u of preview.detection.unmatched) {
      console.log(`[SmartImport]   Unmatched: "${u.sheetName}" - ${u.reason}`);
    }

    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const projectName =
      fileName.replace(/\.(xlsx|xlsm|xls)$/i, "").replace(/_Tracker$/i, "").replace(/_/g, " ");

    const userId = (req as any).user?.id || null;

    const [run] = await db
      .insert(smartImportRuns)
      .values({
        projectId: projectId,
        projectName,
        uploadedBy: userId,
        sourceFileName: fileName,
        sourceFileHash: fileHash,
        status: "PREVIEW",
        summaryJson: preview as any,
      })
      .returning();

    if (preview.normalization.issues.length > 0) {
      const issueValues = preview.normalization.issues.map((issue) => ({
        importRunId: run.id,
        severity: issue.severity as any,
        section: issue.section as any,
        message: issue.message,
        suggestedAction: issue.suggestedAction,
        resolved: false,
        payloadJson: issue.payloadJson || null,
      }));
      await db.insert(importIssues).values(issueValues);
    }

    res.json({ runId: run.id, preview });
  } catch (err: any) {
    console.error("[smart-import] POST upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/history/:projectName
router.get("/api/smart-import/history/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const runs = await db
      .select()
      .from(smartImportRuns)
      .where(eq(smartImportRuns.projectName, projectName))
      .orderBy(desc(smartImportRuns.uploadedAt));

    res.json(runs);
  } catch (err: any) {
    console.error("[smart-import] GET history error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/:runId
router.get("/api/smart-import/:runId", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const issues = await db.select().from(importIssues).where(eq(importIssues.importRunId, runId));

    res.json({
      run,
      issues,
      preview: run.summaryJson,
    });
  } catch (err: any) {
    console.error("[smart-import] GET run error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/smart-import/:runId/mapping
router.patch("/api/smart-import/:runId/mapping", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const { section, colIndex, canonicalField } = req.body;
    if (!section || colIndex == null || !canonicalField) {
      return res.status(400).json({ error: "section, colIndex, and canonicalField are required" });
    }

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    if (summary && summary.mappings) {
      const sectionMapping = summary.mappings.find((m: any) => m.section === section);
      if (sectionMapping && sectionMapping.mappings) {
        const existing = sectionMapping.mappings.find((m: any) => m.colIndex === colIndex);
        if (existing) {
          existing.canonicalField = canonicalField;
          existing.confidence = 1.0;
          existing.source = "USER_OVERRIDE";
        } else {
          sectionMapping.mappings.push({
            colIndex,
            canonicalField,
            confidence: 1.0,
            source: "USER_OVERRIDE",
          });
        }
      }

      await db
        .update(smartImportRuns)
        .set({ summaryJson: summary })
        .where(eq(smartImportRuns.id, runId));
    }

    const sourceHeader = (() => {
      if (summary && summary.mappings) {
        const sectionMapping = summary.mappings.find((m: any) => m.section === section);
        if (sectionMapping && sectionMapping.mappings) {
          const col = sectionMapping.mappings.find((m: any) => m.colIndex === colIndex);
          if (col) return col.rawHeader || col.excelHeader || null;
        }
      }
      if (summary && summary.sections) {
        const sec = summary.sections.find((s: any) => (s.section || s.name) === section);
        if (sec) {
          const cols = sec.columnMappings || sec.columns || [];
          const col = cols.find((c: any) => (c.colIndex ?? c.index) === colIndex);
          if (col) return col.excelHeader || col.header || col.rawHeader || null;
        }
      }
      return null;
    })();

    if (sourceHeader) {
      try {
        const filePattern = run.sourceFileName
          .replace(/^\d+_/, "")
          .replace(/\.(xlsx|xlsm|xls)$/i, "")
          .replace(/_/g, " ")
          .trim();

        const profileName = filePattern || run.projectName || "Default Template";

        const existingProfiles = await db
          .select()
          .from(templateProfiles)
          .where(eq(templateProfiles.name, profileName))
          .limit(1);

        let profileId: number;
        if (existingProfiles.length > 0) {
          profileId = existingProfiles[0].id;
        } else {
          const userId = (req as any).user?.id || null;
          const [newProfile] = await db
            .insert(templateProfiles)
            .values({
              name: profileName,
              isDefault: false,
              createdBy: userId,
            })
            .returning();
          profileId = newProfile.id;
        }

        const existingRules = await db
          .select()
          .from(mappingRules)
          .where(
            and(
              eq(mappingRules.templateProfileId, profileId),
              eq(mappingRules.section, section as any),
              eq(mappingRules.sourceHeader, sourceHeader)
            )
          )
          .limit(1);

        if (existingRules.length > 0) {
          await db
            .update(mappingRules)
            .set({
              canonicalField: canonicalField,
              confidenceWeight: 1.0,
            })
            .where(eq(mappingRules.id, existingRules[0].id));
        } else {
          await db
            .insert(mappingRules)
            .values({
              templateProfileId: profileId,
              section: section as any,
              sourceHeader: sourceHeader,
              canonicalField: canonicalField,
              confidenceWeight: 1.0,
            });
        }
      } catch (learnErr: any) {
        console.warn("[smart-import] Failed to persist learned mapping:", learnErr.message);
      }
    }

    res.json({ success: true, updatedMapping: { section, colIndex, canonicalField } });
  } catch (err: any) {
    console.error("[smart-import] PATCH mapping error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/smart-import/:runId/issue/:issueId/resolve
router.patch("/api/smart-import/:runId/issue/:issueId/resolve", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    const issueId = parseInt(req.params.issueId as string);
    if (isNaN(runId) || isNaN(issueId)) return res.status(400).json({ error: "Invalid runId or issueId" });

    const { resolved } = req.body;
    if (resolved === undefined) return res.status(400).json({ error: "resolved field is required" });

    const userId = (req as any).user?.id || null;

    const [updated] = await db
      .update(importIssues)
      .set({
        resolved: !!resolved,
        resolvedBy: resolved ? userId : null,
        resolvedAt: resolved ? new Date() : null,
      })
      .where(and(eq(importIssues.id, issueId), eq(importIssues.importRunId, runId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Issue not found" });

    res.json(updated);
  } catch (err: any) {
    console.error("[smart-import] PATCH resolve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/commit
router.post("/api/smart-import/:runId/commit", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status === "COMMITTED") {
      return res.status(400).json({ error: "This import has already been committed" });
    }

    const issues = await db
      .select()
      .from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    const unresolvedBlockers = issues.filter((i: any) => i.severity === "BLOCKER" && !i.resolved);
    if (unresolvedBlockers.length > 0) {
      return res.status(400).json({
        error: "Unresolved blocker issues must be resolved before committing",
        unresolvedBlockers: unresolvedBlockers.map((b: any) => ({ id: b.id, message: b.message, section: b.section })),
      });
    }

    const summary = run.summaryJson as any;
    if (!summary || !summary.normalization) {
      return res.status(400).json({ error: "No normalization data found in this import run" });
    }

    const norm = summary.normalization;
    const projectName = run.projectName;
    const projectId = run.projectId;
    const userId = (req as any).user?.id || null;

    const counts = { planTasks: 0, revenueLines: 0, costLines: 0, executionPhases: 0, counterparties: 0 };

    await db.transaction(async (tx: any) => {
      if (projectId) {
        await tx.delete(normalizedPlanTasks).where(eq(normalizedPlanTasks.projectId, projectId));
        await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectId, projectId));
        await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId));
        await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectId, projectId));
      } else {
        await tx.delete(normalizedPlanTasks).where(eq(normalizedPlanTasks.projectName, projectName));
        await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectName, projectName));
        await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.projectName, projectName));
        await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectName, projectName));
      }

      if (norm.planTasks && norm.planTasks.length > 0) {
        const planValues = norm.planTasks.map((t: any) => ({
          projectId,
          projectName,
          taskName: t.taskName,
          phase: t.phase,
          startDate: t.startDate,
          endDate: t.endDate,
          durationDays: t.durationDays,
          owner: t.owner,
          status: t.status,
          pctComplete: t.pctComplete,
          sourceSheet: t.sourceSheet,
          sourceRow: t.sourceRow,
          importRunId: runId,
        }));
        await tx.insert(normalizedPlanTasks).values(planValues);
        counts.planTasks = planValues.length;
      }

      if (norm.revenueLines && norm.revenueLines.length > 0) {
        const revValues = norm.revenueLines.map((r: any) => ({
          projectId,
          projectName,
          description: r.description,
          milestoneName: r.milestoneName,
          amountExVat: r.amountExVat,
          vat: r.vat,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate,
          expectedPaymentDate: r.expectedPaymentDate,
          paidDate: r.paidDate,
          inBankDate: r.inBankDate,
          status: r.status,
          sourceSheet: r.sourceSheet,
          sourceRow: r.sourceRow,
          importRunId: runId,
          turnaroundDays: r.turnaroundDays,
        }));
        await tx.insert(normalizedRevenueLines).values(revValues);
        counts.revenueLines = revValues.length;
      }

      const counterpartyMap = new Map<string, number>();
      if (norm.counterpartyNames && norm.counterpartyNames.length > 0) {
        for (const name of norm.counterpartyNames) {
          const normalized = name.trim().toLowerCase();
          const existing = await tx
            .select()
            .from(counterparties)
            .where(eq(counterparties.nameCanonical, name.trim()));

          if (existing.length > 0) {
            counterpartyMap.set(normalized, existing[0].id);
            await tx
              .update(counterparties)
              .set({ lastSeenAt: new Date() })
              .where(eq(counterparties.id, existing[0].id));
          } else {
            const [created] = await tx
              .insert(counterparties)
              .values({
                nameCanonical: name.trim(),
                nameAliases: [],
                typeDefault: "OTHER",
                isCore: false,
                createdBy: userId,
                lastSeenAt: new Date(),
              })
              .returning();
            counterpartyMap.set(normalized, created.id);
            counts.counterparties++;
          }
        }
      }

      if (norm.costLines && norm.costLines.length > 0) {
        const costValues = norm.costLines.map((c: any) => {
          const cpName = c.counterpartyName?.trim();
          const cpId = cpName ? counterpartyMap.get(cpName.toLowerCase()) || null : null;
          return {
            projectId,
            projectName,
            costCategory: c.costCategory,
            counterpartyId: cpId,
            counterpartyName: c.counterpartyName,
            counterpartyType: null,
            description: c.description,
            amountExVat: c.amountExVat,
            invoiceNumber: c.invoiceNumber,
            invoiceDate: c.invoiceDate,
            approvedDate: c.approvedDate,
            paidDate: c.paidDate,
            poNumber: c.poNumber,
            status: c.status,
            sourceSheet: c.sourceSheet,
            sourceRow: c.sourceRow,
            importRunId: runId,
            turnaroundDays: c.turnaroundDays,
          };
        });
        await tx.insert(normalizedCostLines).values(costValues);
        counts.costLines = costValues.length;
      }

      if (norm.executionPhases && norm.executionPhases.length > 0) {
        const phaseValues = norm.executionPhases.map((p: any) => ({
          projectId,
          projectName,
          phaseName: p.phaseName,
          phaseDate: p.phaseDate,
          source: "EXCEL_IMPORT" as const,
          importRunId: runId,
        }));
        await tx.insert(normalizedExecutionPhases).values(phaseValues);
        counts.executionPhases = phaseValues.length;
      }

      await tx
        .update(smartImportRuns)
        .set({
          status: "COMMITTED",
          committedAt: new Date(),
          committedBy: userId,
        })
        .where(eq(smartImportRuns.id, runId));
    });

    res.json({ success: true, runId, counts });
  } catch (err: any) {
    console.error("[smart-import] POST commit error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/rollback
router.post("/api/smart-import/:runId/rollback", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status !== "COMMITTED") {
      return res.status(400).json({ error: "Only committed imports can be rolled back" });
    }

    await db.transaction(async (tx: any) => {
      await tx.delete(normalizedPlanTasks).where(eq(normalizedPlanTasks.importRunId, runId));
      await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.importRunId, runId));
      await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.importRunId, runId));
      await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.importRunId, runId));

      await tx
        .update(smartImportRuns)
        .set({ status: "ROLLED_BACK" })
        .where(eq(smartImportRuns.id, runId));
    });

    res.json({ success: true, runId, status: "ROLLED_BACK" });
  } catch (err: any) {
    console.error("[smart-import] POST rollback error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/counterparties
router.get("/api/counterparties", requireAuth, async (_req: Request, res: Response) => {
  try {
    const all = await db.select().from(counterparties).orderBy(counterparties.nameCanonical);
    res.json(all);
  } catch (err: any) {
    console.error("[counterparties] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/counterparties
router.post("/api/counterparties", requireAuth, async (req: Request, res: Response) => {
  try {
    const { nameCanonical, typeDefault, isCore, nameAliases } = req.body;
    if (!nameCanonical) return res.status(400).json({ error: "nameCanonical is required" });

    const userId = (req as any).user?.id || null;

    const [created] = await db
      .insert(counterparties)
      .values({
        nameCanonical: nameCanonical.trim(),
        nameAliases: nameAliases || [],
        typeDefault: typeDefault || "OTHER",
        isCore: isCore || false,
        createdBy: userId,
        lastSeenAt: new Date(),
      })
      .returning();

    res.status(201).json(created);
  } catch (err: any) {
    console.error("[counterparties] POST error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/counterparties/:id
router.patch("/api/counterparties/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid counterparty id" });

    const [existing] = await db.select().from(counterparties).where(eq(counterparties.id, id));
    if (!existing) return res.status(404).json({ error: "Counterparty not found" });

    const updates: Record<string, any> = {};
    if (req.body.nameCanonical !== undefined) updates.nameCanonical = req.body.nameCanonical.trim();
    if (req.body.nameAliases !== undefined) updates.nameAliases = req.body.nameAliases;
    if (req.body.typeDefault !== undefined) updates.typeDefault = req.body.typeDefault;
    if (req.body.isCore !== undefined) updates.isCore = req.body.isCore;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const [updated] = await db
      .update(counterparties)
      .set(updates)
      .where(eq(counterparties.id, id))
      .returning();

    res.json(updated);
  } catch (err: any) {
    console.error("[counterparties] PATCH error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/counterparties/match
router.post("/api/counterparties/match", requireAuth, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const normalizedName = name.trim().toLowerCase();

    const all = await db.select().from(counterparties);

    let bestMatch: any = null;
    let bestConfidence = 0;

    for (const cp of all) {
      const canonical = cp.nameCanonical.toLowerCase();
      if (canonical === normalizedName) {
        bestMatch = cp;
        bestConfidence = 1.0;
        break;
      }

      const aliases = (cp.nameAliases as string[]) || [];
      for (const alias of aliases) {
        if (alias.toLowerCase() === normalizedName) {
          bestMatch = cp;
          bestConfidence = 0.95;
          break;
        }
      }
      if (bestConfidence >= 0.95) break;

      if (canonical.includes(normalizedName) || normalizedName.includes(canonical)) {
        const similarity = Math.min(canonical.length, normalizedName.length) / Math.max(canonical.length, normalizedName.length);
        if (similarity > bestConfidence) {
          bestMatch = cp;
          bestConfidence = similarity * 0.8;
        }
      }
    }

    res.json({ match: bestMatch, confidence: Math.round(bestConfidence * 100) / 100 });
  } catch (err: any) {
    console.error("[counterparties] POST match error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/normalized/:projectName/plan
router.get("/api/smart-import/normalized/:projectName/plan", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "COMMITTED")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedPlanTasks)
      .where(eq(normalizedPlanTasks.importRunId, latestRun.id));

    res.json(records);
  } catch (err: any) {
    console.error("[smart-import] GET normalized plan error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/normalized/:projectName/revenue
router.get("/api/smart-import/normalized/:projectName/revenue", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "COMMITTED")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedRevenueLines)
      .where(eq(normalizedRevenueLines.importRunId, latestRun.id));

    res.json(records);
  } catch (err: any) {
    console.error("[smart-import] GET normalized revenue error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/normalized/:projectName/expenditure
router.get("/api/smart-import/normalized/:projectName/expenditure", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "COMMITTED")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedCostLines)
      .where(eq(normalizedCostLines.importRunId, latestRun.id));

    res.json(records);
  } catch (err: any) {
    console.error("[smart-import] GET normalized expenditure error:", err);
    res.status(500).json({ error: err.message });
  }
});

export function registerSmartImportRoutes(app: Express) {
  app.use(router);
}

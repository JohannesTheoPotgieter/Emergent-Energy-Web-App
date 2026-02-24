import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import {
  invoicePatternRules,
  invoicePatternMatches,
  counterparties,
  smartImportRuns,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { classifyCostLines, generateRuleFromInvoice, normalizeInvoiceNumber } from "./lib/import/invoice-classifier";

const router = Router();

function jwtAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || "emergent-fallback-secret");
      if (decoded && typeof decoded === "object") {
        (req as any).user = { id: decoded.userId || decoded.id, role: decoded.role };
      }
    } catch {}
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required" });
}

router.use(jwtAuth);

router.get("/api/invoice-patterns", requireAuth, async (_req: Request, res: Response) => {
  try {
    const rules = await db
      .select()
      .from(invoicePatternRules)
      .orderBy(desc(invoicePatternRules.timesMatched));
    res.json(rules);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/invoice-patterns", requireAuth, async (req: Request, res: Response) => {
  try {
    const { patternType, patternValue, inferredType, counterpartyId, counterpartyName, confidenceWeight, normalizedExample } = req.body;
    if (!patternType || !patternValue || !inferredType) {
      return res.status(400).json({ error: "patternType, patternValue, and inferredType are required" });
    }
    const userId = (req as any).user?.id || null;
    const [rule] = await db
      .insert(invoicePatternRules)
      .values({
        patternType,
        patternValue,
        normalizedExample: normalizedExample || null,
        counterpartyId: counterpartyId || null,
        counterpartyName: counterpartyName || null,
        inferredType,
        confidenceWeight: confidenceWeight || 50,
        createdBy: userId,
        isActive: true,
      })
      .returning();
    res.json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/invoice-patterns/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const updates: any = {};
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    if (req.body.inferredType) updates.inferredType = req.body.inferredType;
    if (req.body.confidenceWeight !== undefined) updates.confidenceWeight = req.body.confidenceWeight;
    if (req.body.counterpartyId !== undefined) updates.counterpartyId = req.body.counterpartyId;
    if (req.body.counterpartyName !== undefined) updates.counterpartyName = req.body.counterpartyName;
    const [updated] = await db
      .update(invoicePatternRules)
      .set(updates)
      .where(eq(invoicePatternRules.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Rule not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/invoice-patterns/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    await db.delete(invoicePatternRules).where(eq(invoicePatternRules.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/smart-import/:runId/classify", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    if (!summary?.normalization?.costLines) {
      return res.json({ classifications: [], message: "No cost lines to classify" });
    }

    const costLines = summary.normalization.costLines.map((c: any, idx: number) => ({
      sourceRow: c.sourceRow || idx + 1,
      invoiceNumber: c.invoiceNumber,
      counterpartyName: c.counterpartyName,
    }));

    const classifications = await classifyCostLines(costLines);

    summary.invoiceClassifications = classifications;
    await db
      .update(smartImportRuns)
      .set({ summaryJson: summary })
      .where(eq(smartImportRuns.id, runId));

    res.json({ classifications });
  } catch (err: any) {
    console.error("[invoice-classify] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/smart-import/:runId/classify-review", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const { sourceRow, action, selectedType, selectedCounterpartyId, overrideReason, applyToSimilar } = req.body;
    if (!action || sourceRow === undefined) {
      return res.status(400).json({ error: "sourceRow and action are required" });
    }

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    const classifications: any[] = summary.invoiceClassifications || [];
    const idx = classifications.findIndex((c: any) => c.sourceRow === sourceRow);
    if (idx === -1) return res.status(404).json({ error: "Classification not found for this row" });

    const classification = classifications[idx];

    if (action === "confirm") {
      classification.outcome = "USER_CONFIRMED";

      if (classification.matchedRuleId) {
        await db
          .update(invoicePatternRules)
          .set({
            timesConfirmed: sql`${invoicePatternRules.timesConfirmed} + 1`,
            lastConfirmedAt: new Date(),
          })
          .where(eq(invoicePatternRules.id, classification.matchedRuleId));
      } else if (classification.invoiceNumberNorm) {
        const gen = generateRuleFromInvoice(
          classification.invoiceNumberNorm,
          classification.inferredType,
          selectedCounterpartyId,
          null
        );
        const userId = (req as any).user?.id || null;
        const [newRule] = await db
          .insert(invoicePatternRules)
          .values({
            patternType: gen.patternType,
            patternValue: gen.patternValue,
            normalizedExample: classification.invoiceNumberNorm,
            inferredType: classification.inferredType,
            confidenceWeight: 70,
            counterpartyId: selectedCounterpartyId || null,
            createdBy: userId,
            isActive: true,
            timesConfirmed: 1,
            lastConfirmedAt: new Date(),
          })
          .returning();
        classification.matchedRuleId = newRule.id;
      }
    } else if (action === "override") {
      classification.outcome = "USER_OVERRIDDEN";
      classification.inferredType = selectedType || "OTHER";
      classification.inferredCounterpartyId = selectedCounterpartyId || null;
      classification.overrideReason = overrideReason || null;

      if (classification.matchedRuleId) {
        await db
          .update(invoicePatternRules)
          .set({
            timesOverridden: sql`${invoicePatternRules.timesOverridden} + 1`,
          })
          .where(eq(invoicePatternRules.id, classification.matchedRuleId));
      }

      if (classification.invoiceNumberNorm) {
        const gen = generateRuleFromInvoice(
          classification.invoiceNumberNorm,
          selectedType || "OTHER",
          selectedCounterpartyId,
          null
        );
        const userId = (req as any).user?.id || null;
        const [newRule] = await db
          .insert(invoicePatternRules)
          .values({
            patternType: gen.patternType,
            patternValue: gen.patternValue,
            normalizedExample: classification.invoiceNumberNorm,
            inferredType: selectedType || "OTHER",
            confidenceWeight: 60,
            counterpartyId: selectedCounterpartyId || null,
            createdBy: userId,
            isActive: true,
            timesConfirmed: 1,
            lastConfirmedAt: new Date(),
          })
          .returning();
        classification.matchedRuleId = newRule.id;
      }
    }

    classifications[idx] = classification;

    if (applyToSimilar && classification.invoiceNumberNorm) {
      const prefix = classification.invoiceNumberNorm.match(/^([A-Z]{2,}[-\/_])/)?.[1];
      if (prefix) {
        for (let i = 0; i < classifications.length; i++) {
          if (i === idx) continue;
          const other = classifications[i];
          if (other.outcome === "UNRESOLVED" && other.invoiceNumberNorm?.startsWith(prefix)) {
            other.inferredType = classification.inferredType;
            other.inferredCounterpartyId = classification.inferredCounterpartyId;
            other.confidenceScore = 90;
            other.outcome = "AUTO_APPLIED";
            other.patternInfo = `Applied from similar: ${prefix}`;
            classifications[i] = other;
          }
        }
      }
    }

    summary.invoiceClassifications = classifications;
    await db
      .update(smartImportRuns)
      .set({ summaryJson: summary })
      .where(eq(smartImportRuns.id, runId));

    res.json({ classification, classifications });
  } catch (err: any) {
    console.error("[invoice-classify-review] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/invoice-pattern-matches", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
    let query = db.select().from(invoicePatternMatches).orderBy(desc(invoicePatternMatches.createdAt));
    if (runId) {
      query = query.where(eq(invoicePatternMatches.importRunId, runId)) as any;
    }
    const matches = await query;
    res.json(matches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerInvoicePatternRoutes(app: any) {
  app.use(router);
}

export default router;

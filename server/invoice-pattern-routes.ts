import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import {
  invoicePatternRules,
  invoicePatternMatches,
  counterparties,
  smartImportRuns,
  normalizedCostLines,
} from "@shared/schema";
import { eq, and, desc, sql, isNull, isNotNull } from "drizzle-orm";
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

router.post("/api/procurement-analysis/classify", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || null;

    const allLines = await db.select().from(normalizedCostLines);

    const eligibleLines = allLines.filter(line => {
      const amt = parseFloat(line.amountExVat || "0") || 0;
      const hasInvoice = !!(line.invoiceNumber && String(line.invoiceNumber).trim());
      return amt !== 0 && hasInvoice;
    });

    const untaggedLines = eligibleLines.filter(line => !line.patternRuleId);

    if (untaggedLines.length === 0) {
      return res.json({
        success: true,
        totalEligible: eligibleLines.length,
        alreadyTagged: eligibleLines.length - untaggedLines.length,
        newlyClassified: 0,
        autoApplied: 0,
        unresolved: 0,
        rulesUpdated: 0,
        message: "All eligible lines have already been classified",
      });
    }

    const activeRules = await db
      .select()
      .from(invoicePatternRules)
      .where(eq(invoicePatternRules.isActive, true));

    const ruleMatchCounts = new Map<number, number>();
    let autoApplied = 0;
    let unresolved = 0;
    const matchRecords: any[] = [];
    const lineUpdates: { id: number; ruleId: number; inferredType: string }[] = [];

    for (const line of untaggedLines) {
      const raw = line.invoiceNumber;
      const norm = normalizeInvoiceNumber(raw);
      if (!norm) {
        unresolved++;
        continue;
      }

      const costLineInput = [{
        sourceRow: line.sourceRow || line.id,
        invoiceNumber: raw,
        counterpartyName: line.counterpartyName,
        counterpartyType: line.counterpartyType,
      }];

      const classifications = await classifyCostLines(costLineInput);
      const result = classifications[0];

      if (result && result.matchedRuleId && result.confidenceScore >= 85) {
        ruleMatchCounts.set(
          result.matchedRuleId,
          (ruleMatchCounts.get(result.matchedRuleId) || 0) + 1
        );

        lineUpdates.push({
          id: line.id,
          ruleId: result.matchedRuleId,
          inferredType: result.inferredType,
        });

        matchRecords.push({
          projectId: line.projectId,
          invoiceNumberRaw: raw,
          invoiceNumberNorm: norm,
          matchedRuleId: result.matchedRuleId,
          inferredType: result.inferredType,
          inferredCounterpartyId: result.inferredCounterpartyId,
          confidenceScore: result.confidenceScore,
          outcome: 'AUTO_APPLIED',
          sourceRow: line.sourceRow || line.id,
        });

        autoApplied++;
      } else {
        unresolved++;
      }
    }

    await db.transaction(async (tx: any) => {
      const ruleEntries = Array.from(ruleMatchCounts.entries());
      for (const [ruleId, count] of ruleEntries) {
        await tx
          .update(invoicePatternRules)
          .set({
            timesMatched: sql`${invoicePatternRules.timesMatched} + ${count}`,
          })
          .where(eq(invoicePatternRules.id, ruleId));
      }

      for (const upd of lineUpdates) {
        await tx
          .update(normalizedCostLines)
          .set({
            patternRuleId: upd.ruleId,
            patternClassifiedAt: new Date(),
            patternInferredType: upd.inferredType,
          })
          .where(eq(normalizedCostLines.id, upd.id));
      }

      if (matchRecords.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < matchRecords.length; i += batchSize) {
          const batch = matchRecords.slice(i, i + batchSize);
          await tx.insert(invoicePatternMatches).values(batch);
        }
      }
    });

    console.log(`[procurement-classify] Classified ${lineUpdates.length} lines, ${autoApplied} auto-applied, ${unresolved} unresolved, ${ruleMatchCounts.size} rules updated`);

    res.json({
      success: true,
      totalEligible: eligibleLines.length,
      alreadyTagged: eligibleLines.length - untaggedLines.length,
      newlyClassified: lineUpdates.length,
      autoApplied,
      unresolved,
      rulesUpdated: ruleMatchCounts.size,
      message: `Classified ${lineUpdates.length} lines: ${autoApplied} auto-applied, ${unresolved} need review. ${ruleMatchCounts.size} pattern rules updated.`,
    });
  } catch (err: any) {
    console.error("[procurement-classify] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/procurement-analysis/pattern-stats", requireAuth, async (_req: Request, res: Response) => {
  try {
    const allLines = await db.select().from(normalizedCostLines);

    const eligible = allLines.filter(line => {
      const amt = parseFloat(line.amountExVat || "0") || 0;
      const hasInvoice = !!(line.invoiceNumber && String(line.invoiceNumber).trim());
      return amt !== 0 && hasInvoice;
    });

    const tagged = eligible.filter(l => l.patternRuleId);
    const untagged = eligible.filter(l => !l.patternRuleId);

    const typeCounts: Record<string, number> = {};
    for (const l of tagged) {
      const t = l.patternInferredType || 'OTHER';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    const rules = await db
      .select()
      .from(invoicePatternRules)
      .orderBy(desc(invoicePatternRules.timesMatched));

    res.json({
      totalCostLines: allLines.length,
      eligibleLines: eligible.length,
      taggedLines: tagged.length,
      untaggedLines: untagged.length,
      classificationRate: eligible.length > 0 ? Math.round((tagged.length / eligible.length) * 100) : 0,
      typeCounts,
      topRules: rules.slice(0, 10).map(r => ({
        id: r.id,
        patternValue: r.patternValue,
        patternType: r.patternType,
        inferredType: r.inferredType,
        timesMatched: r.timesMatched,
        timesConfirmed: r.timesConfirmed,
        timesOverridden: r.timesOverridden,
        counterpartyName: r.counterpartyName,
      })),
    });
  } catch (err: any) {
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

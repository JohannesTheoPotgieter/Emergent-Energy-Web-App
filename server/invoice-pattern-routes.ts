import { Router, Request, Response } from "express";
import { db } from "./db";
import {
  invoicePatternRules,
  invoicePatternMatches,
  counterparties,
  counterpartyContacts,
  entityAssignments,
  smartImportRuns,
  normalizedCostLines,
} from "@shared/schema";
import { eq, and, desc, sql, isNotNull, asc } from "drizzle-orm";
import { classifyCostLines, generateRuleFromInvoice, normalizeInvoiceNumber } from "./lib/import/invoice-classifier";
import { requirePermission } from "./permission-middleware";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import { badRequest, notFound, sendError } from "./lib/api-error";
import { logAuditFromReq } from "./audit-logger";

const router = Router();

router.use(jwtAuth);

function getUserId(req: Request): number | null {
  return getEffectiveUser(req)?.id ?? null;
}

function normalizeRoleTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function parseCurrencyAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const sanitized = String(value ?? "")
    .replace(/[^0-9.\-]/g, "")
    .trim();
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function buildCounterpartyUsageIndex() {
  const rows = await db.select({
    counterpartyId: normalizedCostLines.counterpartyId,
    projectId: normalizedCostLines.projectId,
    amountExVat: normalizedCostLines.amountExVat,
    status: normalizedCostLines.status,
  })
    .from(normalizedCostLines)
    .where(isNotNull(normalizedCostLines.counterpartyId));

  const usage = new Map<number, {
    usageCount: number;
    projectIds: Set<number>;
    totalSpendExVat: number;
    openAmountExVat: number;
  }>();

  for (const row of rows) {
    const counterpartyId = Number(row.counterpartyId ?? 0);
    if (!Number.isFinite(counterpartyId) || counterpartyId <= 0) continue;

    const bucket = usage.get(counterpartyId) || {
      usageCount: 0,
      projectIds: new Set<number>(),
      totalSpendExVat: 0,
      openAmountExVat: 0,
    };

    bucket.usageCount += 1;
    if (typeof row.projectId === "number") {
      bucket.projectIds.add(row.projectId);
    }

    const amount = parseCurrencyAmount(row.amountExVat);
    bucket.totalSpendExVat += amount;
    if (row.status !== "PAID") {
      bucket.openAmountExVat += amount;
    }

    usage.set(counterpartyId, bucket);
  }

  return usage;
}

async function buildCounterpartyAssignmentIndex() {
  const [directAssignments, contactAssignments] = await Promise.all([
    db.select({
      assigneeId: entityAssignments.assigneeId,
      entityType: entityAssignments.entityType,
    })
      .from(entityAssignments)
      .where(and(
        eq(entityAssignments.assigneeType, "external_counterparty"),
        eq(entityAssignments.active, true),
      )),
    db.select({
      assigneeId: entityAssignments.assigneeId,
      counterpartyId: counterpartyContacts.counterpartyId,
      entityType: entityAssignments.entityType,
    })
      .from(entityAssignments)
      .innerJoin(counterpartyContacts, eq(counterpartyContacts.id, entityAssignments.assigneeId))
      .where(and(
        eq(entityAssignments.assigneeType, "external_contact"),
        eq(entityAssignments.active, true),
      )),
  ]);

  const usage = new Map<number, {
    directAssignments: number;
    contactAssignments: number;
    entityTypes: Set<string>;
  }>();

  for (const row of directAssignments) {
    const bucket = usage.get(row.assigneeId) || {
      directAssignments: 0,
      contactAssignments: 0,
      entityTypes: new Set<string>(),
    };
    bucket.directAssignments += 1;
    bucket.entityTypes.add(String(row.entityType || ""));
    usage.set(row.assigneeId, bucket);
  }

  for (const row of contactAssignments) {
    const counterpartyId = Number(row.counterpartyId ?? 0);
    if (!Number.isFinite(counterpartyId) || counterpartyId <= 0) continue;

    const bucket = usage.get(counterpartyId) || {
      directAssignments: 0,
      contactAssignments: 0,
      entityTypes: new Set<string>(),
    };
    bucket.contactAssignments += 1;
    bucket.entityTypes.add(String(row.entityType || ""));
    usage.set(counterpartyId, bucket);
  }

  return usage;
}

async function autoCreatePatternsForAliases(
  counterpartyId: number,
  nameCanonical: string,
  aliases: string[],
  cpType: string,
  userId: number | null
): Promise<any[]> {
  const allTokens = [nameCanonical, ...aliases].filter(a => a && a.trim().length >= 2);
  const created: any[] = [];

  for (const alias of allTokens) {
    const normalized = alias.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!normalized || normalized.length < 2) continue;

    const existing = await db
      .select()
      .from(invoicePatternRules)
      .where(
        and(
          eq(invoicePatternRules.counterpartyId, counterpartyId),
          eq(invoicePatternRules.patternValue, normalized)
        )
      );
    if (existing.length > 0) continue;

    const [rule] = await db
      .insert(invoicePatternRules)
      .values({
        patternType: "REGEX",
        patternValue: normalized,
        normalizedExample: `${normalized}-001`,
        counterpartyId,
        counterpartyName: nameCanonical,
        inferredType: cpType as any,
        confidenceWeight: 70,
        createdBy: userId,
        isActive: true,
      })
      .returning();
    created.push(rule);
  }

  console.log(`[invoice-patterns] Auto-created ${created.length} pattern rules for counterparty "${nameCanonical}" (aliases: ${aliases.join(", ")})`);
  return created;
}

async function syncPatternsForCounterparty(
  counterpartyId: number,
  nameCanonical: string,
  aliases: string[],
  cpType: string,
  userId: number | null
): Promise<void> {
  const existingRules = await db
    .select()
    .from(invoicePatternRules)
    .where(eq(invoicePatternRules.counterpartyId, counterpartyId));

  const autoRules = existingRules.filter(
    r => r.patternType === "REGEX" && r.timesConfirmed === 0 && r.timesOverridden === 0 && r.timesMatched === 0
  );

  const allTokens = [nameCanonical, ...aliases]
    .filter(a => a && a.trim().length >= 2)
    .map(a => a.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter(n => n.length >= 2);

  const desiredSet = new Set(allTokens);

  for (const rule of autoRules) {
    if (!desiredSet.has(rule.patternValue)) {
      await db.delete(invoicePatternRules).where(eq(invoicePatternRules.id, rule.id));
    }
  }

  const existingPatterns = new Set(existingRules.map(r => r.patternValue));
  for (const token of allTokens) {
    if (existingPatterns.has(token)) continue;
    await db.insert(invoicePatternRules).values({
      patternType: "REGEX",
      patternValue: token,
      normalizedExample: `${token}-001`,
      counterpartyId,
      counterpartyName: nameCanonical,
      inferredType: cpType as any,
      confidenceWeight: 70,
      createdBy: userId,
      isActive: true,
    });
  }

  await db
    .update(invoicePatternRules)
    .set({ counterpartyName: nameCanonical, inferredType: cpType as any })
    .where(eq(invoicePatternRules.counterpartyId, counterpartyId));

  console.log(`[invoice-patterns] Synced patterns for counterparty "${nameCanonical}" (${allTokens.length} aliases)`);
}

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

router.post("/api/invoice-patterns", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const { patternType, patternValue, inferredType, counterpartyId, counterpartyName, confidenceWeight, normalizedExample } = req.body;
    if (!patternType || !patternValue || !inferredType) {
      return res.status(400).json({ error: "patternType, patternValue, and inferredType are required" });
    }
    const userId = getUserId(req);

    let resolvedCounterpartyId = counterpartyId || null;
    if (counterpartyName && !resolvedCounterpartyId) {
      const existing = await db.select().from(counterparties)
        .where(eq(counterparties.nameCanonical, counterpartyName))
        .limit(1);
      if (existing.length > 0) {
        resolvedCounterpartyId = existing[0].id;
      } else {
        const [newCp] = await db.insert(counterparties).values({
          nameCanonical: counterpartyName,
          typeDefault: inferredType || "OTHER",
          isCore: false,
          createdBy: userId,
        }).returning();
        resolvedCounterpartyId = newCp.id;
      }
    }

    const [rule] = await db
      .insert(invoicePatternRules)
      .values({
        patternType,
        patternValue,
        normalizedExample: normalizedExample || null,
        counterpartyId: resolvedCounterpartyId,
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

router.patch("/api/invoice-patterns/:id", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
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

router.delete("/api/invoice-patterns/:id", requireAuth, requirePermission('procurement', 'delete'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    await db.transaction(async (tx) => {
      await tx.update(normalizedCostLines)
        .set({ patternRuleId: null, patternClassifiedAt: null, patternInferredType: null })
        .where(eq(normalizedCostLines.patternRuleId, id));
      await tx.delete(invoicePatternMatches).where(eq(invoicePatternMatches.matchedRuleId, id));
      await tx.delete(invoicePatternRules).where(eq(invoicePatternRules.id, id));
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/smart-import/:runId/classify", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
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

router.post("/api/smart-import/:runId/classify-review", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
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
        const userId = getUserId(req);
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
        const userId = getUserId(req);
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

router.post("/api/procurement-analysis/classify", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);

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
    const lineUpdates: { id: number; ruleId: number; inferredType: string; counterpartyId: number | null; counterpartyName: string | null }[] = [];

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
          counterpartyId: result.inferredCounterpartyId,
          counterpartyName: result.inferredCounterpartyName,
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
            timesConfirmed: sql`${invoicePatternRules.timesConfirmed} + ${count}`,
            lastConfirmedAt: new Date(),
          })
          .where(eq(invoicePatternRules.id, ruleId));
      }

      for (const upd of lineUpdates) {
        let cpName = upd.counterpartyName;
        let cpId = upd.counterpartyId;
        if (cpId && !cpName) {
          const [cp] = await tx.select().from(counterparties).where(eq(counterparties.id, cpId));
          if (cp) cpName = cp.nameCanonical;
        }
        await tx
          .update(normalizedCostLines)
          .set({
            patternRuleId: upd.ruleId,
            patternClassifiedAt: new Date(),
            patternInferredType: upd.inferredType,
            counterpartyId: cpId ?? null,
            counterpartyName: cpName ?? null,
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

router.post("/api/procurement-analysis/reset-tags", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const userRole = user?.role;
    if (!["COO_ADMIN", "CEO_ADMIN"].includes(userRole)) {
      return res.status(403).json({ error: "Only COO/CEO Admin can reset tags" });
    }

    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: "Must send confirm: true to execute this destructive action" });
    }

    const taggedBefore = await db.select({ count: sql<number>`count(*)` }).from(normalizedCostLines).where(sql`pattern_rule_id IS NOT NULL`);
    const matchesBefore = await db.select({ count: sql<number>`count(*)` }).from(invoicePatternMatches);

    await db.transaction(async (tx: any) => {
      await tx.update(normalizedCostLines).set({
        patternRuleId: null,
        patternClassifiedAt: null,
        patternInferredType: null,
      }).where(sql`pattern_rule_id IS NOT NULL`);

      await tx.delete(invoicePatternMatches);

      await tx.update(invoicePatternRules).set({
        timesMatched: 0,
        timesConfirmed: 0,
        timesOverridden: 0,
      });
    });

    console.log(`[AUDIT] reset-tags executed by ${user?.email} (${userRole}): cleared ${taggedBefore[0]?.count || 0} tags, ${matchesBefore[0]?.count || 0} matches`);

    res.json({
      success: true,
      tagsCleared: taggedBefore[0]?.count || 0,
      matchesDeleted: matchesBefore[0]?.count || 0,
      message: `Cleared ${taggedBefore[0]?.count || 0} tags and ${matchesBefore[0]?.count || 0} match records. Pattern rules preserved with counters reset.`,
    });
  } catch (err: any) {
    console.error("[reset-tags] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/wipe-all-data", requireAuth, requirePermission('admin', 'delete'), async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const userRole = user?.role;
    if (!["admin", "COO_ADMIN", "CEO_ADMIN"].includes(userRole)) {
      return res.status(403).json({ error: "Only COO/CEO Admin can wipe data" });
    }
    if (req.body?.confirm !== "WIPE_ALL_DATA") {
      return res.status(400).json({ error: 'Must send confirm: "WIPE_ALL_DATA" to execute this destructive action' });
    }

    const tables = [
      'invoice_pattern_matches', 'invoice_pattern_rules',
      'normalized_cost_lines', 'normalized_revenue_lines', 'normalized_execution_phases', 'normalized_plan_tasks',
      'smart_import_runs', 'template_profiles', 'counterparties',
      'field_changes', 'change_sets', 'change_ledger',
      'import_diff_events', 'import_issues', 'import_runs',
      'upload_metadata', 'sync_audit_log', 'merge_audit_log', 'writeback_audit_log',
      'cashflow_planning_overrides', 'cashflow_points', 'cashflow_weekly_manual', 'cashflow_balance_history',
      'expenditure_overrides', 'line_item_overrides', 'planning_overrides', 'date_overrides',
      'finance_cos_monthly', 'finance_cos_overrides', 'finance_revenue_monthly', 'finance_revenue_overrides',
      'revenue_tracking_overrides', 'revenue_milestone_manual',
      'opex_budget_monthly', 'opex_weekly_manual', 'tracker_monthly_manual',
      'expense_task_links', 'milestone_task_links',
      'program_expense', 'program_inflows', 'project_plan',
      'project_plan_dependency', 'project_plan_overrides',
      'working_plan_task_override', 'working_plan_dependency_override', 'working_plan_scenario',
      'scenarios', 'budgets',
      'operational_tasks',
      'qc_item_evidence', 'qc_item_instance', 'qc_plan_link', 'qc_access_challenge',
      'qc_postmortem_metric_value', 'qc_postmortem_summary', 'qc_postmortem',
      'qc_risk_answer', 'qc_warning_event', 'qc_warning', 'qc_checklist',
      'qc_template_postmortem_metric', 'qc_template_risk_question',
      'qc_template_item', 'qc_template_phase', 'qc_template_group', 'qc_template',
      'phase_template_item_history', 'phase_template_item', 'phase_template_application', 'phase_template',
      'engineering_task_attachments', 'engineering_tasks', 'engineering_template_items', 'engineering_templates',
      'deliverable_events', 'deliverable_files', 'deliverable_versions', 'deliverables',
      'task_activity_log', 'task_attachments', 'task_checklist_items', 'task_checklists',
      'task_comments', 'task_watchers', 'tasks',
      'tr_item_suggestion_decisions', 'tr_item_project_links', 'tr_items',
      'intake_tasks', 'intake_task_templates', 'intake_requests',
      'meeting_action_items', 'meeting_summaries',
      'mytool_tasks', 'mytool_company_priorities', 'mytool_daily_reviews',
      'mytool_dod_templates', 'mytool_email_links', 'mytool_timeblocks',
      'mytool_settings', 'mytool_user_preferences',
      'weekly_reviews', 'snapshot_metrics', 'snapshots',
      'notifications', 'notification_throttle',
      'sp_file_pointers', 'sp_files', 'sp_list_config', 'sp_settings', 'mock_sp_items',
      'approvals', 'audit_events', 'error_logs', 'refresh_logs',
      'project_editable_fields', 'project_notes', 'project_phase_history',
      'project_revenue_summary', 'project_team_members', 'home_notes',
      'schedule_change_notice', 'execution_gate_log',
      'support_tickets', 'triage_rules', 'issue_resolution_rules',
      'mapping_rules', 'writeback_mappings', 'key_date_mappings',
      'payment_terms', 'priority_links', 'resource_capacity',
      'calendar_holiday', 'app_settings',
      'company_projects', 'projects', 'project_info', 'expenses', 'revenues',
      'outlook_accounts',
      'role_permissions', 'role_credentials',
      'session', 'users',
    ];

    let truncated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const table of tables) {
      try {
        await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
        truncated++;
      } catch (err: any) {
        if (err.message?.includes('does not exist')) {
          skipped++;
        } else {
          errors.push(`${table}: ${err.message}`);
        }
      }
    }

    console.log(`[AUDIT] FULL DATABASE WIPE by ${user?.email} (${userRole}): ${truncated} tables truncated, ${skipped} skipped, ${errors.length} errors`);

    res.json({
      success: true,
      tablesTruncated: truncated,
      tablesSkipped: skipped,
      errors: errors.length > 0 ? errors : undefined,
      message: `Wiped ${truncated} tables. ${skipped} tables not found (OK). Server will re-seed users on next restart. Please restart the deployment to restore login accounts.`,
    });
  } catch (err: any) {
    console.error("[wipe-all] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/counterparties/summary", requireAuth, requirePermission('procurement', 'view'), async (_req: Request, res: Response) => {
  try {
    const [allCounterparties, usageIndex, assignmentIndex, contactCounts] = await Promise.all([
      db.select().from(counterparties).orderBy(asc(counterparties.nameCanonical)),
      buildCounterpartyUsageIndex(),
      buildCounterpartyAssignmentIndex(),
      db.select({
        counterpartyId: counterpartyContacts.counterpartyId,
        isActive: counterpartyContacts.isActive,
      }).from(counterpartyContacts),
    ]);

    const activeContactCountByCounterparty = new Map<number, number>();
    for (const contact of contactCounts) {
      if (!contact.isActive) continue;
      activeContactCountByCounterparty.set(
        contact.counterpartyId,
        (activeContactCountByCounterparty.get(contact.counterpartyId) || 0) + 1,
      );
    }

    res.json(allCounterparties.map((counterparty) => {
      const usage = usageIndex.get(counterparty.id);
      const assignments = assignmentIndex.get(counterparty.id);
      return {
        ...counterparty,
        usageCount: usage?.usageCount || 0,
        linkedProjectCount: usage?.projectIds.size || 0,
        totalSpendExVat: usage?.totalSpendExVat || 0,
        openAmountExVat: usage?.openAmountExVat || 0,
        activeContactCount: activeContactCountByCounterparty.get(counterparty.id) || 0,
        directAssignmentCount: assignments?.directAssignments || 0,
        contactAssignmentCount: assignments?.contactAssignments || 0,
        assignmentEntityTypes: assignments ? [...assignments.entityTypes].filter(Boolean).sort() : [],
      };
    }));
  } catch (err: any) {
    sendError(res, err);
  }
});

router.get("/api/counterparties", requireAuth, requirePermission('procurement', 'view'), async (_req: Request, res: Response) => {
  try {
    const all = await db
      .select()
      .from(counterparties)
      .orderBy(asc(counterparties.nameCanonical));
    res.json(all);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.get("/api/counterparties/:id", requireAuth, requirePermission('procurement', 'view'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw badRequest("Invalid counterparty ID");
    }

    const [[counterparty], contacts, usageIndex, assignmentIndex, activeAssignments] = await Promise.all([
      db.select().from(counterparties).where(eq(counterparties.id, id)).limit(1),
      db.select().from(counterpartyContacts).where(eq(counterpartyContacts.counterpartyId, id)).orderBy(asc(counterpartyContacts.name)),
      buildCounterpartyUsageIndex(),
      buildCounterpartyAssignmentIndex(),
      db.select({
        id: entityAssignments.id,
        entityType: entityAssignments.entityType,
        entityId: entityAssignments.entityId,
        assignmentRole: entityAssignments.assignmentRole,
        assigneeType: entityAssignments.assigneeType,
        assigneeId: entityAssignments.assigneeId,
        displayLabelSnapshot: entityAssignments.displayLabelSnapshot,
        assignedAt: entityAssignments.assignedAt,
      })
        .from(entityAssignments)
        .where(and(
          eq(entityAssignments.active, true),
          sql`(
            (${entityAssignments.assigneeType} = 'external_counterparty' AND ${entityAssignments.assigneeId} = ${id})
            OR (${entityAssignments.assigneeType} = 'external_contact' AND ${entityAssignments.assigneeId} IN (
              SELECT id FROM counterparty_contacts WHERE counterparty_id = ${id}
            ))
          )`,
        ))
        .orderBy(desc(entityAssignments.assignedAt)),
    ]);

    if (!counterparty) {
      throw notFound("Counterparty");
    }

    const usage = usageIndex.get(id);
    const assignments = assignmentIndex.get(id);
    res.json({
      ...counterparty,
      contacts,
      summary: {
        usageCount: usage?.usageCount || 0,
        linkedProjectCount: usage?.projectIds.size || 0,
        totalSpendExVat: usage?.totalSpendExVat || 0,
        openAmountExVat: usage?.openAmountExVat || 0,
        directAssignmentCount: assignments?.directAssignments || 0,
        contactAssignmentCount: assignments?.contactAssignments || 0,
        assignmentEntityTypes: assignments ? [...assignments.entityTypes].filter(Boolean).sort() : [],
      },
      activeAssignments,
    });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post("/api/counterparties", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const { nameCanonical, typeDefault, nameAliases, isCore, isActive, roleTags } = req.body;
    if (!nameCanonical || !nameCanonical.trim()) {
      throw badRequest("nameCanonical is required");
    }
    const userId = getUserId(req);
    const aliases: string[] = Array.isArray(nameAliases) ? nameAliases : [];
    const cpType = typeDefault || "OTHER";

    const [cp] = await db
      .insert(counterparties)
      .values({
        nameCanonical: nameCanonical.trim(),
        typeDefault: cpType,
        nameAliases: aliases,
        isCore: Boolean(isCore),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        roleTags: normalizeRoleTags(roleTags),
        createdBy: userId,
        updatedAt: new Date(),
      })
      .returning();

    const createdRules = await autoCreatePatternsForAliases(cp.id, nameCanonical.trim(), aliases, cpType, userId);
    logAuditFromReq(req, {
      entityType: "counterparty",
      entityId: String(cp.id),
      action: "create",
      changesJson: {
        nameCanonical: cp.nameCanonical,
        typeDefault: cp.typeDefault,
        isActive: cp.isActive,
        roleTags: cp.roleTags,
        autoCreatedRules: createdRules.length,
      },
    });

    res.status(201).json({ ...cp, autoCreatedRules: createdRules.length });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.patch("/api/counterparties/:id", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw badRequest("Invalid counterparty ID");
    }
    const userId = getUserId(req);
    const updates: any = { updatedAt: new Date() };
    if (req.body.nameCanonical !== undefined) updates.nameCanonical = String(req.body.nameCanonical).trim();
    if (req.body.typeDefault !== undefined) updates.typeDefault = req.body.typeDefault;
    if (req.body.nameAliases !== undefined) updates.nameAliases = req.body.nameAliases;
    if (req.body.isCore !== undefined) updates.isCore = Boolean(req.body.isCore);
    if (req.body.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);
    if (req.body.roleTags !== undefined) updates.roleTags = normalizeRoleTags(req.body.roleTags);
    if (req.body.contactPerson !== undefined) updates.contactPerson = req.body.contactPerson;
    if (req.body.contactPhone !== undefined) updates.contactPhone = req.body.contactPhone;
    if (req.body.contactEmail !== undefined) updates.contactEmail = req.body.contactEmail;
    if (req.body.address !== undefined) updates.address = req.body.address;
    if (req.body.vatNumber !== undefined) updates.vatNumber = req.body.vatNumber;
    if (req.body.registrationNumber !== undefined) updates.registrationNumber = req.body.registrationNumber;
    if (req.body.paymentTerms !== undefined) updates.paymentTerms = req.body.paymentTerms;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;

    const [updated] = await db
      .update(counterparties)
      .set(updates)
      .where(eq(counterparties.id, id))
      .returning();
    if (!updated) {
      throw notFound("Counterparty");
    }

    await syncPatternsForCounterparty(
      id,
      updated.nameCanonical,
      (updated.nameAliases as string[]) || [],
      updated.typeDefault,
      userId,
    );

    logAuditFromReq(req, {
      entityType: "counterparty",
      entityId: String(id),
      action: "update",
      changesJson: {
        nameCanonical: updated.nameCanonical,
        typeDefault: updated.typeDefault,
        isActive: updated.isActive,
        roleTags: updated.roleTags,
      },
    });

    res.json(updated);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post("/api/counterparties/:id/contacts", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const counterpartyId = parseInt(req.params.id, 10);
    if (isNaN(counterpartyId)) {
      throw badRequest("Invalid counterparty ID");
    }
    if (!req.body?.name || !String(req.body.name).trim()) {
      throw badRequest("Contact name is required");
    }

    const [contact] = await db.insert(counterpartyContacts).values({
      counterpartyId,
      name: String(req.body.name).trim(),
      email: req.body.email || null,
      phone: req.body.phone || null,
      title: req.body.title || null,
      roleTags: normalizeRoleTags(req.body.roleTags),
      isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
      notes: req.body.notes || null,
      createdByUserId: getUserId(req),
      updatedAt: new Date(),
    }).returning();

    logAuditFromReq(req, {
      entityType: "counterparty_contact",
      entityId: String(contact.id),
      action: "create",
      changesJson: {
        counterpartyId,
        name: contact.name,
        isActive: contact.isActive,
        roleTags: contact.roleTags,
      },
    });

    res.status(201).json(contact);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.patch("/api/counterparties/:id/contacts/:contactId", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const counterpartyId = parseInt(req.params.id, 10);
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(counterpartyId) || isNaN(contactId)) {
      throw badRequest("Invalid counterparty or contact ID");
    }

    const updates: any = { updatedAt: new Date() };
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body.email !== undefined) updates.email = req.body.email;
    if (req.body.phone !== undefined) updates.phone = req.body.phone;
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.roleTags !== undefined) updates.roleTags = normalizeRoleTags(req.body.roleTags);
    if (req.body.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);
    if (req.body.notes !== undefined) updates.notes = req.body.notes;

    const [updated] = await db.update(counterpartyContacts)
      .set(updates)
      .where(and(
        eq(counterpartyContacts.id, contactId),
        eq(counterpartyContacts.counterpartyId, counterpartyId),
      ))
      .returning();

    if (!updated) {
      throw notFound("Counterparty contact");
    }

    logAuditFromReq(req, {
      entityType: "counterparty_contact",
      entityId: String(contactId),
      action: "update",
      changesJson: {
        counterpartyId,
        name: updated.name,
        isActive: updated.isActive,
        roleTags: updated.roleTags,
      },
    });

    res.json(updated);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.delete("/api/counterparties/:id", requireAuth, requirePermission('procurement', 'delete'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw badRequest("Invalid counterparty ID");
    }
    await db.transaction(async (tx) => {
      await tx.update(normalizedCostLines)
        .set({ counterpartyId: null })
        .where(eq(normalizedCostLines.counterpartyId, id));
      await tx.update(invoicePatternRules)
        .set({ counterpartyId: null })
        .where(eq(invoicePatternRules.counterpartyId, id));
      await tx.update(invoicePatternMatches)
        .set({ inferredCounterpartyId: null })
        .where(eq(invoicePatternMatches.inferredCounterpartyId, id));
      await tx.delete(counterpartyContacts).where(eq(counterpartyContacts.counterpartyId, id));
      await tx.delete(counterparties).where(eq(counterparties.id, id));
    });

    logAuditFromReq(req, {
      entityType: "counterparty",
      entityId: String(id),
      action: "delete",
      changesJson: { counterpartyId: id },
    });

    res.json({ ok: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

export function registerInvoicePatternRoutes(app: any) {
  app.use(router);
}

export default router;

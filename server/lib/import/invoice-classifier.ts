import { db } from "../../db";
import { invoicePatternRules, invoicePatternMatches, counterparties } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface ClassificationResult {
  sourceRow: number;
  invoiceNumberRaw: string | null;
  invoiceNumberNorm: string | null;
  inferredType: "INSTALLER" | "SUPPLIER" | "OTHER";
  inferredCounterpartyId: number | null;
  inferredCounterpartyName: string | null;
  matchedRuleId: number | null;
  confidenceScore: number;
  outcome: "AUTO_APPLIED" | "USER_CONFIRMED" | "USER_OVERRIDDEN" | "UNRESOLVED";
  patternInfo: string | null;
}

export function normalizeInvoiceNumber(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let n = raw.trim().toUpperCase();
  n = n.replace(/\s+/g, " ");
  n = n.replace(/--+/g, "-");
  n = n.replace(/\/\/+/g, "/");
  n = n.replace(/__+/g, "_");
  n = n.replace(/[^A-Z0-9\-\/_ ]/g, "");
  return n || null;
}

export interface TokenShape {
  prefixLetters: string;
  hasYearToken: boolean;
  separatorStyle: string;
  lengthBucket: string;
  signature: string;
}

export function computeTokenShape(norm: string): TokenShape {
  const prefixMatch = norm.match(/^([A-Z]+)/);
  const prefixLetters = prefixMatch ? prefixMatch[1] : "";

  const hasYearToken = /(?:20\d{2}|\b\d{2}\b)/.test(norm);

  let separatorStyle = "none";
  if (norm.includes("-")) separatorStyle = "dash";
  else if (norm.includes("/")) separatorStyle = "slash";
  else if (norm.includes("_")) separatorStyle = "underscore";

  const len = norm.length;
  let lengthBucket = "short";
  if (len > 12) lengthBucket = "long";
  else if (len > 6) lengthBucket = "medium";

  const signature = norm
    .replace(/[A-Z]+/g, (m) => "A".repeat(Math.min(m.length, 4)))
    .replace(/\d+/g, (m) => "N".repeat(Math.min(m.length, 4)))
    .replace(/[-\/_]/g, "-");

  return { prefixLetters, hasYearToken, separatorStyle, lengthBucket, signature };
}

export function extractPrefix(norm: string): string | null {
  const match = norm.match(/^([A-Z]{2,}[-\/_])/);
  return match ? match[1] : null;
}

interface ActiveRule {
  id: number;
  patternType: "PREFIX" | "REGEX" | "TOKEN_SHAPE";
  patternValue: string;
  inferredType: "INSTALLER" | "SUPPLIER" | "OTHER";
  confidenceWeight: number;
  counterpartyId: number | null;
  counterpartyName: string | null;
  timesConfirmed: number;
  timesOverridden: number;
}

function matchRules(norm: string, shape: TokenShape, rules: ActiveRule[]): { rule: ActiveRule; baseScore: number } | null {
  const normUpper = norm.toUpperCase();

  for (const rule of rules) {
    if (rule.patternType === "PREFIX") {
      const ruleNorm = normalizeInvoiceNumber(rule.patternValue);
      if (ruleNorm && normUpper.startsWith(ruleNorm)) {
        return { rule, baseScore: rule.confidenceWeight };
      }
    }
  }

  for (const rule of rules) {
    if (rule.patternType === "REGEX") {
      try {
        const re = new RegExp(rule.patternValue, "i");
        if (re.test(norm)) {
          return { rule, baseScore: rule.confidenceWeight };
        }
      } catch {}
    }
  }

  for (const rule of rules) {
    if (rule.patternType === "TOKEN_SHAPE") {
      if (shape.signature === rule.patternValue || shape.prefixLetters === rule.patternValue.toUpperCase()) {
        return { rule, baseScore: Math.min(rule.confidenceWeight, 60) };
      }
    }
  }

  return null;
}

function computeConfidence(baseScore: number, rule: ActiveRule): number {
  let score = baseScore;

  if (rule.timesConfirmed > 0) {
    score += Math.min(rule.timesConfirmed * 3, 20);
  }

  if (rule.timesOverridden > 0) {
    const overrideRatio = rule.timesOverridden / (rule.timesConfirmed + rule.timesOverridden + 1);
    score -= Math.round(overrideRatio * 30);
  }

  return Math.max(0, Math.min(100, score));
}

export async function classifyCostLines(
  costLines: Array<{
    sourceRow: number;
    invoiceNumber: string | null;
    counterpartyName?: string | null;
    counterpartyType?: string | null;
  }>
): Promise<ClassificationResult[]> {
  const activeRules = await db
    .select()
    .from(invoicePatternRules)
    .where(eq(invoicePatternRules.isActive, true));

  const rules: ActiveRule[] = activeRules.map((r) => ({
    id: r.id,
    patternType: r.patternType,
    patternValue: r.patternValue,
    inferredType: r.inferredType,
    confidenceWeight: r.confidenceWeight,
    counterpartyId: r.counterpartyId,
    counterpartyName: r.counterpartyName,
    timesConfirmed: r.timesConfirmed,
    timesOverridden: r.timesOverridden,
  }));

  const results: ClassificationResult[] = [];

  for (const line of costLines) {
    const raw = line.invoiceNumber;
    const norm = normalizeInvoiceNumber(raw);

    if (!norm) {
      results.push({
        sourceRow: line.sourceRow,
        invoiceNumberRaw: raw,
        invoiceNumberNorm: null,
        inferredType: "OTHER",
        inferredCounterpartyId: null,
        inferredCounterpartyName: null,
        matchedRuleId: null,
        confidenceScore: 0,
        outcome: "UNRESOLVED",
        patternInfo: "No invoice number",
      });
      continue;
    }

    const shape = computeTokenShape(norm);
    const match = matchRules(norm, shape, rules);

    if (match) {
      const confidence = computeConfidence(match.baseScore, match.rule);
      const outcome = confidence >= 85 ? "AUTO_APPLIED" : "UNRESOLVED";

      results.push({
        sourceRow: line.sourceRow,
        invoiceNumberRaw: raw,
        invoiceNumberNorm: norm,
        inferredType: match.rule.inferredType,
        inferredCounterpartyId: match.rule.counterpartyId,
        inferredCounterpartyName: match.rule.counterpartyName,
        matchedRuleId: match.rule.id,
        confidenceScore: confidence,
        outcome,
        patternInfo: `${match.rule.patternType}: ${match.rule.patternValue}`,
      });
    } else {
      results.push({
        sourceRow: line.sourceRow,
        invoiceNumberRaw: raw,
        invoiceNumberNorm: norm,
        inferredType: "OTHER",
        inferredCounterpartyId: null,
        inferredCounterpartyName: null,
        matchedRuleId: null,
        confidenceScore: 0,
        outcome: "UNRESOLVED",
        patternInfo: `Shape: ${shape.signature}`,
      });
    }
  }

  return results;
}

export function generateRuleFromInvoice(
  norm: string,
  inferredType: "INSTALLER" | "SUPPLIER" | "OTHER",
  counterpartyId?: number | null,
  counterpartyName?: string | null
): {
  patternType: "PREFIX" | "TOKEN_SHAPE";
  patternValue: string;
} {
  const prefix = extractPrefix(norm);
  if (prefix) {
    return { patternType: "PREFIX", patternValue: prefix };
  }
  const shape = computeTokenShape(norm);
  return { patternType: "TOKEN_SHAPE", patternValue: shape.signature };
}

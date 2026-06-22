import type { DetectedSection, LayoutVariant } from "./detector";
import { SECTION_ANCHORS, getSynonymsForSection } from "./synonyms";
import { normalizeHeader, stringSimilarity, diceCoefficient } from "./utils";
import type ExcelJS from "exceljs";
import { db } from "../../db";
import { mappingRules } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface ColumnMapping {
  colIndex: number;
  rawHeader: string;
  canonicalField: string;
  confidence: number;
  matchType: "exact" | "synonym" | "fuzzy" | "learned" | "unmatched";
}

export interface MappingResult {
  section: "PLAN" | "REVENUE" | "EXPENDITURE";
  mappings: ColumnMapping[];
  budgetMappings?: ColumnMapping[];
  unmappedHeaders: { colIndex: number; rawHeader: string }[];
  missingRequired: string[];
  overallConfidence: number;
  /** Detected template layout variant, if available */
  layoutVariant?: LayoutVariant;
}

function findBestMatch(
  normalizedHeader: string,
  synonymMap: Record<string, string[]>
): { canonicalField: string; confidence: number; matchType: "exact" | "synonym" | "fuzzy" } | null {
  for (const [field, synonyms] of Object.entries(synonymMap)) {
    for (const syn of synonyms) {
      const normSyn = syn.toLowerCase().trim();
      if (normalizedHeader === normSyn) {
        return { canonicalField: field, confidence: 1.0, matchType: "exact" };
      }
    }
  }

  for (const [field, synonyms] of Object.entries(synonymMap)) {
    for (const syn of synonyms) {
      const normSyn = syn.toLowerCase().trim();
      if (normalizedHeader.includes(normSyn) || normSyn.includes(normalizedHeader)) {
        return { canonicalField: field, confidence: 0.9, matchType: "synonym" };
      }
    }
  }

  let bestField: string | null = null;
  let bestScore = 0;

  for (const [field, synonyms] of Object.entries(synonymMap)) {
    for (const syn of synonyms) {
      const normSyn = syn.toLowerCase().trim();
      const levSim = stringSimilarity(normalizedHeader, normSyn);
      const diceSim = diceCoefficient(normalizedHeader, normSyn);
      const score = Math.max(levSim, diceSim);

      if (score > bestScore) {
        bestScore = score;
        bestField = field;
      }
    }
  }

  // Owner rule 2026-06 (L3): only auto-map a fuzzy header at >= 90% similarity.
  // Below that it stays UNMATCHED so the import wizard asks the user to choose,
  // rather than silently mapping a shifted/renamed column to the wrong field.
  if (bestField && bestScore >= 0.9) {
    return { canonicalField: bestField, confidence: bestScore, matchType: "fuzzy" };
  }

  return null;
}

export async function loadLearnedMappings(templateProfileId: number) {
  const rules = await db
    .select()
    .from(mappingRules)
    .where(eq(mappingRules.templateProfileId, templateProfileId));
  return rules;
}

export function mapColumns(
  detectedSection: DetectedSection,
  _workbook: ExcelJS.Workbook,
  learnedMappings?: { section: string; sourceHeader: string; canonicalField: string; confidenceWeight: number }[]
): MappingResult {
  const synonymMap = getSynonymsForSection(detectedSection.section);
  const anchor = SECTION_ANCHORS[detectedSection.section];

  const mappings: ColumnMapping[] = [];
  const unmappedHeaders: { colIndex: number; rawHeader: string }[] = [];
  const claimedFields = new Set<string>();

  const headerMatches: {
    colIndex: number;
    rawHeader: string;
    normalizedHeader: string;
    canonicalField: string;
    confidence: number;
    matchType: "exact" | "synonym" | "fuzzy" | "learned";
  }[] = [];

  const sectionLearnedMappings = (learnedMappings || []).filter(
    lm => lm.section === detectedSection.section
  );

  for (const header of detectedSection.detectedHeaders) {
    const synonymMatch = findBestMatch(header.normalizedHeader, synonymMap);

    // An EXACT synonym match is canonical and unambiguous — e.g. "Planned End",
    // "Actual End", "Status". A remembered (possibly stale) learned mapping must
    // NOT override it: stale learned mappings overriding exact headers were the
    // cause of planned dates binding to the actual columns and "Status" not
    // reading actual %. Learned mappings still win for non-exact (renamed /
    // fuzzy / unmatched) headers, where they add value.
    if (synonymMatch && synonymMatch.matchType === "exact") {
      headerMatches.push({
        colIndex: header.colIndex,
        rawHeader: header.rawHeader,
        normalizedHeader: header.normalizedHeader,
        ...synonymMatch,
      });
      continue;
    }

    const learnedMatch = sectionLearnedMappings.find(
      lm => lm.sourceHeader.toLowerCase().trim() === header.normalizedHeader ||
            lm.sourceHeader.toLowerCase().trim() === header.rawHeader.toLowerCase().trim()
    );

    if (learnedMatch) {
      headerMatches.push({
        colIndex: header.colIndex,
        rawHeader: header.rawHeader,
        normalizedHeader: header.normalizedHeader,
        canonicalField: learnedMatch.canonicalField,
        confidence: Math.min(learnedMatch.confidenceWeight, 1.0),
        matchType: "learned",
      });
      continue;
    }

    if (synonymMatch) {
      headerMatches.push({
        colIndex: header.colIndex,
        rawHeader: header.rawHeader,
        normalizedHeader: header.normalizedHeader,
        ...synonymMatch,
      });
    }
  }

  headerMatches.sort((a, b) => b.confidence - a.confidence);

  const contextualFallbacks: Record<string, string> = {
    "duration": "actual_duration",
    "start_date": "actual_start",
    "end_date": "actual_end",
  };

  for (const match of headerMatches) {
    if (claimedFields.has(match.canonicalField)) {
      const fallbackField = contextualFallbacks[match.canonicalField];
      if (fallbackField && !claimedFields.has(fallbackField) && synonymMap[fallbackField]) {
        claimedFields.add(fallbackField);
        mappings.push({
          colIndex: match.colIndex,
          rawHeader: match.rawHeader,
          canonicalField: fallbackField,
          confidence: match.confidence * 0.9,
          matchType: match.matchType,
        });
        continue;
      }
      unmappedHeaders.push({ colIndex: match.colIndex, rawHeader: match.rawHeader });
      continue;
    }

    claimedFields.add(match.canonicalField);
    mappings.push({
      colIndex: match.colIndex,
      rawHeader: match.rawHeader,
      canonicalField: match.canonicalField,
      confidence: match.confidence,
      matchType: match.matchType,
    });
  }

  for (const header of detectedSection.detectedHeaders) {
    const alreadyMapped = mappings.some(m => m.colIndex === header.colIndex);
    const alreadyUnmapped = unmappedHeaders.some(u => u.colIndex === header.colIndex);
    if (!alreadyMapped && !alreadyUnmapped) {
      unmappedHeaders.push({ colIndex: header.colIndex, rawHeader: header.rawHeader });
    }
  }

  let budgetMappings: ColumnMapping[] | undefined;
  if (detectedSection.section === "EXPENDITURE" && detectedSection.budgetHeaders && detectedSection.budgetHeaders.length > 0) {
    budgetMappings = [];
    const budgetClaimed = new Set<string>();
    const budgetMatches: typeof headerMatches = [];

    for (const header of detectedSection.budgetHeaders) {
      const match = findBestMatch(header.normalizedHeader, synonymMap);
      if (match) {
        budgetMatches.push({
          colIndex: header.colIndex,
          rawHeader: header.rawHeader,
          normalizedHeader: header.normalizedHeader,
          ...match,
        });
      }
    }

    budgetMatches.sort((a, b) => b.confidence - a.confidence);

    for (const match of budgetMatches) {
      if (budgetClaimed.has(match.canonicalField)) continue;
      budgetClaimed.add(match.canonicalField);
      budgetMappings.push({
        colIndex: match.colIndex,
        rawHeader: match.rawHeader,
        canonicalField: match.canonicalField,
        confidence: match.confidence,
        matchType: match.matchType,
      });
    }
  }

  // PLAN actual-% recovery. "Status" / "% complete" / "progress" have no other
  // valid meaning in a plan section, yet a stale learned mapping (these override
  // synonyms and are keyed per file) or claim order can leave `pct_complete`
  // unclaimed — silently importing every task at 0% actual. If it went
  // unclaimed but a header EXACTLY matches a pct_complete synonym, reclaim that
  // column for actual % (detaching it from any field it was mis-assigned to).
  // Exact-match only, so "expected status" is never grabbed for actual %.
  if (detectedSection.section === "PLAN" && !claimedFields.has("pct_complete")) {
    const pctSynonyms = (synonymMap["pct_complete"] ?? []).map((s) => s.toLowerCase().trim());
    const recover = detectedSection.detectedHeaders.find((h) => pctSynonyms.includes(h.normalizedHeader));
    if (recover) {
      const mappedIdx = mappings.findIndex((m) => m.colIndex === recover.colIndex);
      if (mappedIdx >= 0) {
        claimedFields.delete(mappings[mappedIdx].canonicalField);
        mappings.splice(mappedIdx, 1);
      }
      const unmappedIdx = unmappedHeaders.findIndex((u) => u.colIndex === recover.colIndex);
      if (unmappedIdx >= 0) unmappedHeaders.splice(unmappedIdx, 1);
      claimedFields.add("pct_complete");
      mappings.push({
        colIndex: recover.colIndex,
        rawHeader: recover.rawHeader,
        canonicalField: "pct_complete",
        confidence: 1.0,
        matchType: "exact",
      });
    }
  }

  const missingRequired: string[] = [];
  if (anchor) {
    for (const reqField of anchor.requiredFields) {
      if (!claimedFields.has(reqField)) {
        missingRequired.push(reqField);
      }
    }
  }

  const overallConfidence = mappings.length > 0
    ? mappings.reduce((sum, m) => sum + m.confidence, 0) / mappings.length
    : 0;

  return {
    section: detectedSection.section,
    mappings,
    budgetMappings,
    unmappedHeaders,
    missingRequired,
    overallConfidence,
    layoutVariant: detectedSection.layoutVariant,
  };
}

/**
 * True when a PLAN section captured the expected-% column but NOT the actual-%
 * ("Status" / `pct_complete`) column. That asymmetry silently imports every
 * task at 0% actual (pct_complete defaults to 0) while expected % looks fine —
 * the exact footgun behind a real schedule rendering as "no progress". Used to
 * raise a FLAG-NEVER-SKIP warning so the operator maps the Status column.
 */
export function planActualPctGap(planMapping: MappingResult | undefined): boolean {
  if (!planMapping || planMapping.section !== "PLAN") return false;
  const has = (field: string) => planMapping.mappings.some((m) => m.canonicalField === field);
  return has("expected_pct") && !has("pct_complete");
}

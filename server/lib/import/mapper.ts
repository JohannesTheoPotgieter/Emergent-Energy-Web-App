import type { DetectedSection } from "./detector";
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
  unmappedHeaders: { colIndex: number; rawHeader: string }[];
  missingRequired: string[];
  overallConfidence: number;
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

      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestField = field;
      }
    }
  }

  if (bestField && bestScore >= 0.5) {
    const confidence = 0.4 + bestScore * 0.4;
    return { canonicalField: bestField, confidence: Math.min(confidence, 0.85), matchType: "fuzzy" };
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

    const match = findBestMatch(header.normalizedHeader, synonymMap);
    if (match) {
      headerMatches.push({
        colIndex: header.colIndex,
        rawHeader: header.rawHeader,
        normalizedHeader: header.normalizedHeader,
        ...match,
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
    unmappedHeaders,
    missingRequired,
    overallConfidence,
  };
}

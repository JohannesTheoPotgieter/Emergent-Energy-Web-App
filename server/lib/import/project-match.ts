/**
 * Project-name matching helpers shared between the Smart Import upload route
 * and the scheduled-import-v2 service.
 *
 * Extracted from server/smart-import-routes.ts so the scheduler can call the
 * same matcher the upload handler uses (avoids divergence in match scoring).
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { projectInfo, smartImportRuns } from "@shared/schema";

// ---------------------------------------------------------------------------
// Filename → project-name extraction
// ---------------------------------------------------------------------------

export function extractProjectNameFromFilename(fileName: string): string {
  let name = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  name = name.replace(/^\d+_/, "");
  const trackerIdx = name.toLowerCase().indexOf("tracker");
  if (trackerIdx > 0) {
    name = name.substring(0, trackerIdx);
  }
  name = name.replace(/\b(rev|revision|version|ver)\s*\d+\b/gi, "");
  name = name.replace(/\bv\d+(\.\d+)*\b/gi, "");
  name = name.replace(/[_\-]+/g, " ").replace(/[^a-zA-Z0-9\s]/g, "").trim();
  name = name.replace(/\s+/g, " ");
  return name || "Untitled Project";
}

// ---------------------------------------------------------------------------
// Normalisation + similarity
// ---------------------------------------------------------------------------

export function normalizeForComparison(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/\.(xlsx|xlsm|xls)$/i, "");
  n = n.replace(/[_\-]+/g, " ");
  n = n.replace(/\b(rev|revision|version|ver|v)\s*\d+\b/gi, "");
  n = n.replace(/\bv\d+(\.\d+)*\b/gi, "");
  n = n.replace(/\b(tracker|template|copy|final|draft|updated|new|old)\b/gi, "");
  // Phase suffixes (ph1, phase 2, etc.) are PRESERVED to distinguish multi-phase projects
  n = n.replace(/\(\d+\)/g, "");
  n = n.replace(/\d{4}[-\/]\d{2}[-\/]\d{2}/g, "");
  n = n.replace(/\d{8,}/g, "");
  n = n.replace(/[^a-z0-9\s]/g, "");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

function stripPhase(normalized: string): string {
  return normalized.replace(/\b(ph\s*\d+|phase\s*\d+)\b/gi, "").replace(/\s+/g, " ").trim();
}

function extractPhase(normalized: string): string | null {
  const match = normalized.match(/\b(ph\s*\d+|phase\s*\d+)\b/i);
  return match ? match[1].replace(/\s+/g, "").toLowerCase() : null;
}

export function computeSimilarity(a: string, b: string): { score: number; matchReason?: string } {
  if (a === b) return { score: 1.0 };
  if (!a || !b) return { score: 0 };

  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (normA === normB) return { score: 1.0 };
  if (!normA || !normB) return { score: 0 };

  const baseA = stripPhase(normA);
  const baseB = stripPhase(normB);
  const phaseA = extractPhase(normA);
  const phaseB = extractPhase(normB);

  if (baseA === baseB && baseA.length > 0 && phaseA !== phaseB && (phaseA || phaseB)) {
    return { score: 0.7, matchReason: "same_project_different_phase" };
  }

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return { score: 0 };

  // Distinct trailing token ⇒ different project (generalises the phase rule
  // above). When two names share their LEADING tokens but each carries a
  // DIFFERENT non-empty distinguishing suffix — "Coega Steels BESS" vs
  // "Coega Steels Ph2", or "… Citrusdal" vs "… Mossel Bay" — they are separate
  // projects and must never auto-merge onto one another. Cap below the
  // auto-match threshold (same 0.7 as same_project_different_phase) so they are
  // still SURFACED as a candidate but a human must confirm. A pure prefix
  // extension (one side has NO extra tokens) is deliberately left to the logic
  // below, so a shorter tracker filename can still match its fuller project
  // name.
  let commonLead = 0;
  const leadLimit = Math.min(tokensA.length, tokensB.length);
  while (commonLead < leadLimit && tokensA[commonLead] === tokensB[commonLead]) commonLead++;
  const remainderA = tokensA.slice(commonLead).join(" ");
  const remainderB = tokensB.slice(commonLead).join(" ");
  if (commonLead > 0 && remainderA && remainderB && remainderA !== remainderB) {
    return { score: 0.7, matchReason: "same_base_different_variant" };
  }

  let matchCount = 0;
  for (const t of tokensA) {
    if (tokensB.includes(t)) matchCount++;
  }
  const tokenSimilarity = (2 * matchCount) / (tokensA.length + tokensB.length);

  const maxLen = Math.max(normA.length, normB.length);
  const minLen = Math.min(normA.length, normB.length);
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i++) {
    if (normA[i] === normB[i]) commonPrefix++;
    else break;
  }
  const prefixSimilarity = commonPrefix / maxLen;

  if (normA.includes(normB) || normB.includes(normA)) {
    return { score: Math.max(0.85, tokenSimilarity, minLen / maxLen) };
  }

  return { score: Math.max(tokenSimilarity, prefixSimilarity) };
}

// ---------------------------------------------------------------------------
// Project matching (DB)
// ---------------------------------------------------------------------------

export interface ProjectMatch {
  projectId: number;
  projectName: string;
  confidence: number;
  matchReason: string;
}

export async function findProjectMatches(projectName: string): Promise<ProjectMatch[]> {
  const allProjects = await db
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo);

  const matches: ProjectMatch[] = [];
  const normInput = normalizeForComparison(projectName);

  for (const p of allProjects) {
    const normDB = normalizeForComparison(p.projectName);

    if (normInput === normDB) {
      matches.push({ projectId: p.id, projectName: p.projectName, confidence: 1.0, matchReason: "exact_normalized_match" });
      continue;
    }

    if (p.projectName.toLowerCase().trim() === projectName.toLowerCase().trim()) {
      matches.push({ projectId: p.id, projectName: p.projectName, confidence: 1.0, matchReason: "exact_case_insensitive_match" });
      continue;
    }

    const { score: sim, matchReason: phaseReason } = computeSimilarity(projectName, p.projectName);
    if (sim >= 0.5) {
      let reason = phaseReason || "fuzzy_match";
      if (!phaseReason) {
        if (sim >= 0.85) reason = "high_confidence_match";
        else if (sim >= 0.7) reason = "medium_confidence_match";
      }
      matches.push({
        projectId: p.id,
        projectName: p.projectName,
        confidence: Math.round(sim * 100) / 100,
        matchReason: reason,
      });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Rerun protection
// ---------------------------------------------------------------------------

export interface RerunCheck {
  isDuplicate: boolean;
  existingRun?: {
    id: number;
    projectName: string;
    status: string;
    uploadedAt: Date | null;
  };
}

/**
 * Check whether a file with this content hash has already been imported.
 * Used by both the upload route and the scheduler to skip exact re-runs.
 */
export async function checkRerunProtection(fileHash: string): Promise<RerunCheck> {
  const existing = await db
    .select({
      id: smartImportRuns.id,
      projectName: smartImportRuns.projectName,
      status: smartImportRuns.status,
      uploadedAt: smartImportRuns.uploadedAt,
    })
    .from(smartImportRuns)
    .where(eq(smartImportRuns.sourceFileHash, fileHash))
    .orderBy(desc(smartImportRuns.uploadedAt))
    .limit(1);

  if (existing.length > 0) {
    return { isDuplicate: true, existingRun: existing[0] };
  }
  return { isDuplicate: false };
}

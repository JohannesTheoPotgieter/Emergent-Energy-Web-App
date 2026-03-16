import { sql } from "drizzle-orm";
import { db } from "../db";

export type EvidenceRequirement = {
  requirementKey: string;
  label: string;
  evidenceType: string;
  isRequired: boolean;
  weight: number;
  minCount: number;
};

export type EvidenceInput = {
  requirementKey?: string | null;
  evidenceType: string;
};

export type EvidenceEvaluationResult = {
  totalRequired: number;
  totalPresent: number;
  missingItems: Array<{ requirementKey: string; label: string; missingBy: number }>;
  score: number;
  threshold: number;
  pass: boolean;
};

const DEFAULT_THRESHOLD_BY_COMPLETION: Record<string, number> = {
  pd_pm_handover_submit: 90,
  commissioning_item_close: 80,
  milestone_completion: 85,
  handover_gate_complete: 90,
};

const EVIDENCE_OVERRIDE_ROLES = ["PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"];

export function isEvidenceOverrideAuthorized(role?: string): boolean {
  return !!role && EVIDENCE_OVERRIDE_ROLES.includes(role);
}

export function getDefaultThreshold(completionType: string): number {
  return DEFAULT_THRESHOLD_BY_COMPLETION[completionType] ?? 80;
}

export function computeEvidenceEvaluation(
  requirements: EvidenceRequirement[],
  collected: EvidenceInput[],
  threshold: number,
): EvidenceEvaluationResult {
  const required = requirements.filter((r) => r.isRequired);
  const totalRequired = required.length;

  if (totalRequired === 0) {
    return {
      totalRequired: 0,
      totalPresent: 0,
      missingItems: [],
      score: 100,
      threshold,
      pass: true,
    };
  }

  const countsByRequirement = new Map<string, number>();
  const countsByType = new Map<string, number>();
  for (const item of collected) {
    if (item.requirementKey) {
      countsByRequirement.set(item.requirementKey, (countsByRequirement.get(item.requirementKey) || 0) + 1);
    }
    countsByType.set(item.evidenceType, (countsByType.get(item.evidenceType) || 0) + 1);
  }

  let matchedRequired = 0;
  let totalWeight = 0;
  let matchedWeight = 0;
  const missingItems: Array<{ requirementKey: string; label: string; missingBy: number }> = [];

  for (const req of required) {
    const weight = Number.isFinite(req.weight) ? req.weight : 1;
    totalWeight += weight;
    const byKey = countsByRequirement.get(req.requirementKey) || 0;
    const fallbackByType = countsByType.get(req.evidenceType) || 0;
    const actualCount = Math.max(byKey, fallbackByType);
    const minCount = Math.max(1, req.minCount || 1);

    if (actualCount >= minCount) {
      matchedRequired += 1;
      matchedWeight += weight;
    } else {
      missingItems.push({ requirementKey: req.requirementKey, label: req.label, missingBy: minCount - actualCount });
    }
  }

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 10000) / 100 : 0;

  return {
    totalRequired,
    totalPresent: matchedRequired,
    missingItems,
    score,
    threshold,
    pass: score >= threshold,
  };
}

export async function evaluateEvidence(params: {
  projectId: number;
  completionType: string;
  sourceType: string;
  sourceRef: string;
  additionalEvidence?: EvidenceInput[];
  evaluatorUserId?: number;
  evaluatorName?: string;
}) {
  const { projectId, completionType, sourceType, sourceRef, additionalEvidence = [], evaluatorUserId, evaluatorName } = params;

  const reqRows: any[] = await db.execute(sql.raw(`
    SELECT requirement_key, label, evidence_type, is_required, weight, min_count, threshold_percent
    FROM evidence_requirement_definitions
    WHERE active = true
      AND completion_type = '${completionType.replace(/'/g, "''")}'
      AND source_type = '${sourceType.replace(/'/g, "''")}'
      AND (source_ref IS NULL OR source_ref = '${sourceRef.replace(/'/g, "''")}')
      AND (project_id IS NULL OR project_id = ${projectId})
    ORDER BY id
  `)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

  const requirements: EvidenceRequirement[] = reqRows.map((r) => ({
    requirementKey: r.requirement_key,
    label: r.label,
    evidenceType: r.evidence_type,
    isRequired: !!r.is_required,
    weight: Number(r.weight || 1),
    minCount: Number(r.min_count || 1),
  }));

  const thresholdFromDb = reqRows.map((r) => Number(r.threshold_percent)).find((n) => Number.isFinite(n) && n > 0);
  const threshold = thresholdFromDb || getDefaultThreshold(completionType);

  const collectedRows: any[] = await db.execute(sql.raw(`
    SELECT requirement_key, evidence_type
    FROM evidence_collected_items
    WHERE project_id = ${projectId}
      AND completion_type = '${completionType.replace(/'/g, "''")}'
      AND source_type = '${sourceType.replace(/'/g, "''")}'
      AND source_ref = '${sourceRef.replace(/'/g, "''")}'
      AND deleted_at IS NULL
  `)).then((r: any) => (Array.isArray(r) ? r : r.rows || []));

  const collected: EvidenceInput[] = [
    ...collectedRows.map((r) => ({ requirementKey: r.requirement_key, evidenceType: r.evidence_type })),
    ...additionalEvidence,
  ];

  const result = computeEvidenceEvaluation(requirements, collected, threshold);

  await db.execute(sql.raw(`
    INSERT INTO evidence_evaluations
      (project_id, completion_type, source_type, source_ref, threshold_percent, score_percent, total_required, total_present, missing_items_json, pass, evaluated_by_user_id, evaluated_by_name)
    VALUES
      (${projectId}, '${completionType.replace(/'/g, "''")}', '${sourceType.replace(/'/g, "''")}', '${sourceRef.replace(/'/g, "''")}', ${result.threshold}, ${result.score}, ${result.totalRequired}, ${result.totalPresent}, '${JSON.stringify(result.missingItems).replace(/'/g, "''")}'::jsonb, ${result.pass}, ${evaluatorUserId || "NULL"}, ${evaluatorName ? `'${evaluatorName.replace(/'/g, "''")}'` : "NULL"})
  `));

  return result;
}

export async function upsertEvidenceItem(params: {
  projectId: number;
  completionType: string;
  sourceType: string;
  sourceRef: string;
  requirementKey?: string | null;
  evidenceType: string;
  title?: string | null;
  valueRef?: string | null;
  valueJson?: unknown;
  uploadedByUserId?: number;
  uploadedByName?: string | null;
}) {
  const { projectId, completionType, sourceType, sourceRef, requirementKey, evidenceType, title, valueRef, valueJson, uploadedByUserId, uploadedByName } = params;

  return db.execute(sql.raw(`
    INSERT INTO evidence_collected_items
      (project_id, completion_type, source_type, source_ref, requirement_key, evidence_type, title, value_ref, value_json, uploaded_by_user_id, uploaded_by_name)
    VALUES
      (${projectId}, '${completionType.replace(/'/g, "''")}', '${sourceType.replace(/'/g, "''")}', '${sourceRef.replace(/'/g, "''")}', ${requirementKey ? `'${requirementKey.replace(/'/g, "''")}'` : "NULL"}, '${evidenceType.replace(/'/g, "''")}', ${title ? `'${title.replace(/'/g, "''")}'` : "NULL"}, ${valueRef ? `'${valueRef.replace(/'/g, "''")}'` : "NULL"}, ${valueJson ? `'${JSON.stringify(valueJson).replace(/'/g, "''")}'::jsonb` : "NULL"}, ${uploadedByUserId || "NULL"}, ${uploadedByName ? `'${uploadedByName.replace(/'/g, "''")}'` : "NULL"})
    RETURNING *
  `));
}

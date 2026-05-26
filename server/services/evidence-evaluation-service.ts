// ============================================================
// EVIDENCE EVALUATION SERVICE
//
// Wave-5 audit (2026-05-26) — rewritten to use parameterised
// `sql\`\`` templates instead of string-interpolated `sql.raw()`. The
// previous implementation built every query via manual `.replace(/'/g,
// "''")` escaping, which is a § 5 violation ("Raw SQL: avoid unless
// unavoidable. When unavoidable, use `sql` tagged template + parameters
// — never string interpolation"). Even with single-quote escaping the
// pattern is fragile: any future addition of a field that allows other
// SQL syntax characters reopens the injection surface. The Drizzle
// tagged template engine binds every value as a parameter.
//
// EVIDENCE_OVERRIDE_ROLES is now typed via `satisfies readonly
// CompanyRole[]` so typos against the canonical role list fail at
// type-check time.
// ============================================================

import { sql } from "drizzle-orm";
import { db } from "../db";
import type { CompanyRole } from "@shared/schema";

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
  // EPC workflow thresholds — all evidence required before proceeding
  po_submission: 100,
  invoice_validation: 100,
  payment_request: 100,
  payment_confirmed: 100,
};

// Roles allowed to override an evidence-missing block. Typed against
// the canonical CompanyRole union so any drift from shared/schema/users
// fails type-check immediately.
const EVIDENCE_OVERRIDE_ROLES: readonly string[] = (
  ["PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN"] satisfies readonly CompanyRole[]
);

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

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
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
  const {
    projectId, completionType, sourceType, sourceRef,
    additionalEvidence = [], evaluatorUserId, evaluatorName,
  } = params;

  // Parameterised — every value bound via the tagged template.
  const reqResult = await db.execute(sql`
    SELECT requirement_key, label, evidence_type, is_required, weight, min_count, threshold_percent
    FROM evidence_requirement_definitions
    WHERE active = true
      AND completion_type = ${completionType}
      AND source_type = ${sourceType}
      AND (source_ref IS NULL OR source_ref = ${sourceRef})
      AND (project_id IS NULL OR project_id = ${projectId})
    ORDER BY id
  `);
  const reqRows = rowsFromResult(reqResult);

  const requirements: EvidenceRequirement[] = reqRows.map((r) => ({
    requirementKey: String(r.requirement_key),
    label: String(r.label),
    evidenceType: String(r.evidence_type),
    isRequired: !!r.is_required,
    weight: Number(r.weight ?? 1),
    minCount: Number(r.min_count ?? 1),
  }));

  const thresholdFromDb = reqRows
    .map((r) => Number(r.threshold_percent))
    .find((n) => Number.isFinite(n) && n > 0);
  const threshold = thresholdFromDb || getDefaultThreshold(completionType);

  const collectedResult = await db.execute(sql`
    SELECT requirement_key, evidence_type
    FROM evidence_collected_items
    WHERE project_id = ${projectId}
      AND completion_type = ${completionType}
      AND source_type = ${sourceType}
      AND source_ref = ${sourceRef}
      AND deleted_at IS NULL
  `);
  const collectedRows = rowsFromResult(collectedResult);

  const collected: EvidenceInput[] = [
    ...collectedRows.map((r) => ({
      requirementKey: r.requirement_key != null ? String(r.requirement_key) : null,
      evidenceType: String(r.evidence_type),
    })),
    ...additionalEvidence,
  ];

  const result = computeEvidenceEvaluation(requirements, collected, threshold);

  // Persist the evaluation. Every value bound; the JSONB missing-items
  // list is bound as a string and cast in-query.
  await db.execute(sql`
    INSERT INTO evidence_evaluations (
      project_id, completion_type, source_type, source_ref,
      threshold_percent, score_percent, total_required, total_present,
      missing_items_json, pass, evaluated_by_user_id, evaluated_by_name,
      created_at
    ) VALUES (
      ${projectId}, ${completionType}, ${sourceType}, ${sourceRef},
      ${result.threshold}, ${result.score}, ${result.totalRequired}, ${result.totalPresent},
      ${JSON.stringify(result.missingItems)}::jsonb, ${result.pass},
      ${evaluatorUserId ?? null}, ${evaluatorName ?? null},
      NOW()
    )
  `);

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
  const {
    projectId, completionType, sourceType, sourceRef,
    requirementKey, evidenceType, title, valueRef, valueJson,
    uploadedByUserId, uploadedByName,
  } = params;

  // Wave-6 audit (2026-05-26) — true upsert via ON CONFLICT. The
  // natural key (project_id, completion_type, source_type, source_ref,
  // COALESCE(requirement_key, ''), evidence_type) has a partial
  // unique index (migration 0075) so duplicate calls now refresh the
  // row instead of inserting a second copy. `created_at` is preserved;
  // `updated_at` records the latest refresh.
  return db.execute(sql`
    INSERT INTO evidence_collected_items (
      project_id, completion_type, source_type, source_ref,
      requirement_key, evidence_type, title, value_ref, value_json,
      uploaded_by_user_id, uploaded_by_name, created_at, updated_at
    ) VALUES (
      ${projectId}, ${completionType}, ${sourceType}, ${sourceRef},
      ${requirementKey ?? null}, ${evidenceType}, ${title ?? null}, ${valueRef ?? null},
      ${valueJson ? sql`${JSON.stringify(valueJson)}::jsonb` : sql`NULL`},
      ${uploadedByUserId ?? null}, ${uploadedByName ?? null},
      NOW(), NOW()
    )
    ON CONFLICT (
      project_id, completion_type, source_type, source_ref,
      COALESCE(requirement_key, ''), evidence_type
    ) WHERE deleted_at IS NULL
    DO UPDATE SET
      title = EXCLUDED.title,
      value_ref = EXCLUDED.value_ref,
      value_json = EXCLUDED.value_json,
      uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
      uploaded_by_name = EXCLUDED.uploaded_by_name,
      updated_at = NOW()
    RETURNING *
  `);
}

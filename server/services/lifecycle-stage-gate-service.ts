import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  approvals,
  projectGateEvaluations,
  projectInfo,
  stageGateDefinitions,
  stageGateOverrides,
  workItems,
} from "@shared/schema";
import { db } from "../db";
import { createProjectEvent } from "./project-event-service";

export type GateRequirementType =
  | "required_field"
  | "required_linked_record"
  | "required_approval"
  | "required_document"
  | "required_milestone_state"
  | "required_commercial_control"
  | "required_role_signoff";

export interface MissingGateItem {
  requirementType: GateRequirementType | string;
  requirementKey: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface StageGateEvaluationResult {
  allowed: boolean;
  gateName: string;
  projectId: number;
  fromStage: string | null;
  targetStage: string;
  missingItems: MissingGateItem[];
  usedOverride: boolean;
  overrideId: number | null;
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, any>;
}

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

async function evaluateSingleRequirement(projectId: number, project: any, definition: any): Promise<MissingGateItem | null> {
  const requirementType = definition.requirementType as GateRequirementType;
  const requirementKey = String(definition.requirementKey || "unspecified");
  const cfg = asRecord(definition.requirementConfig);

  if (!definition.isRequired) return null;

  if (requirementType === "required_field") {
    const field = String(cfg.field || requirementKey);
    const label = String(cfg.label || field);
    if (!isNonEmpty(project[field])) {
      return {
        requirementType,
        requirementKey,
        message: `${label} is required`,
        detail: { field, expected: "non_empty" },
      };
    }
    return null;
  }

  if (requirementType === "required_linked_record") {
    const table = String(cfg.table || "");
    const minCount = Math.max(1, Number(cfg.minCount || 1));
    let count = 0;

    if (table === "work_items") {
      const status = cfg.status ? String(cfg.status) : null;
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workItems)
        .where(
          status
            ? and(eq(workItems.projectId, projectId), eq(workItems.status, status))
            : eq(workItems.projectId, projectId),
        );
      count = Number(rows[0]?.count || 0);
    } else if (table === "approvals") {
      const status = cfg.status ? String(cfg.status) : "approved";
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(approvals)
        .where(and(eq(approvals.projectId, projectId), eq(approvals.status, status as any)));
      count = Number(rows[0]?.count || 0);
    } else if (table === "project_eng_deliverables") {
      const r: any = await db.execute(sql`
        SELECT count(*)::int AS count
        FROM project_eng_deliverables d
        JOIN project_eng_stages s ON s.id = d.project_eng_stage_id
        WHERE s.project_id = ${projectId}
      `);
      count = Number((r?.rows?.[0]?.count ?? 0));
    }

    if (count < minCount) {
      return {
        requirementType,
        requirementKey,
        message: `${table || "Linked records"} requires at least ${minCount} record(s)`,
        detail: { table, minCount, actualCount: count },
      };
    }
    return null;
  }

  if (requirementType === "required_approval") {
    const approvalCategory = cfg.approvalCategory ? String(cfg.approvalCategory) : null;
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvals)
      .where(
        approvalCategory
          ? and(eq(approvals.projectId, projectId), eq(approvals.status, "approved"), eq(approvals.approvalCategory, approvalCategory))
          : and(eq(approvals.projectId, projectId), eq(approvals.status, "approved")),
      );
    const count = Number(rows[0]?.count || 0);
    if (count < 1) {
      return {
        requirementType,
        requirementKey,
        message: approvalCategory ? `Approval required for ${approvalCategory}` : "At least one approved approval is required",
        detail: { approvalCategory },
      };
    }
    return null;
  }

  if (requirementType === "required_document") {
    const r: any = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM project_eng_deliverables d
      JOIN project_eng_stages s ON s.id = d.project_eng_stage_id
      WHERE s.project_id = ${projectId}
    `);
    const count = Number((r?.rows?.[0]?.count ?? 0));
    if (count < 1) {
      return {
        requirementType,
        requirementKey,
        message: "Supporting document/evidence is required",
      };
    }
    return null;
  }

  if (requirementType === "required_milestone_state") {
    const requiredStatus = String(cfg.status || "Complete");
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workItems)
      .where(and(eq(workItems.projectId, projectId), eq(workItems.isMilestone, true), eq(workItems.status, requiredStatus)));
    const count = Number(rows[0]?.count || 0);
    if (count < 1) {
      return {
        requirementType,
        requirementKey,
        message: `At least one milestone must be in ${requiredStatus}`,
      };
    }
    return null;
  }

  if (requirementType === "required_commercial_control") {
    if (requirementKey === "signed_controls") {
      const ok = project.signedStatus && project.signedStatus !== "NONE" && project.signedDate && project.signedDocumentLink;
      if (!ok) {
        return {
          requirementType,
          requirementKey,
          message: "Commercial controls require signed status, signed date, and signed document link",
        };
      }
    }
    if (requirementKey === "contract_value") {
      if (!isNonEmpty(project.contractValue)) {
        return {
          requirementType,
          requirementKey,
          message: "Contract value is required for this stage move",
        };
      }
    }
    return null;
  }

  if (requirementType === "required_role_signoff") {
    const role = String(cfg.role || "");
    const category = cfg.approvalCategory ? String(cfg.approvalCategory) : role || null;
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvals)
      .where(
        category
          ? and(eq(approvals.projectId, projectId), eq(approvals.status, "approved"), eq(approvals.approvalCategory, category))
          : and(eq(approvals.projectId, projectId), eq(approvals.status, "approved")),
      );
    const count = Number(rows[0]?.count || 0);
    if (count < 1) {
      return {
        requirementType,
        requirementKey,
        message: role ? `${role} sign-off is required` : "Required role sign-off is missing",
      };
    }
    return null;
  }

  return null;
}

export async function evaluateStageGate(params: {
  projectId: number;
  targetStage: string;
  actorUserId?: number | null;
  actorRole?: string | null;
}) : Promise<StageGateEvaluationResult> {
  const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, params.projectId));
  if (!project) {
    throw new Error("Project not found");
  }

  const fromStage = project.phase || null;
  const definitions = await db
    .select()
    .from(stageGateDefinitions)
    .where(
      and(
        eq(stageGateDefinitions.targetStage, params.targetStage),
        eq(stageGateDefinitions.isActive, true),
        fromStage ? eq(stageGateDefinitions.fromStage, fromStage) : sql`1=1`,
      ),
    )
    .orderBy(stageGateDefinitions.sortOrder);

  const gateName = definitions[0]?.gateName || `stage:${fromStage || "unknown"}->${params.targetStage}`;
  const missingItems: MissingGateItem[] = [];

  for (const definition of definitions) {
    const missing = await evaluateSingleRequirement(params.projectId, project, definition);
    if (missing) missingItems.push(missing);
  }

  let activeOverride: any = null;
  if (missingItems.length > 0) {
    const rows = await db
      .select()
      .from(stageGateOverrides)
      .where(
        and(
          eq(stageGateOverrides.projectId, params.projectId),
          eq(stageGateOverrides.gateName, gateName),
          eq(stageGateOverrides.targetStage, params.targetStage),
          eq(stageGateOverrides.isActive, true),
          or(isNull(stageGateOverrides.expiresAt), lte(sql`now()`, stageGateOverrides.expiresAt)),
        ),
      )
      .limit(1);
    activeOverride = rows[0] || null;
  }

  const allowed = missingItems.length === 0 || Boolean(activeOverride);

  const [evaluation] = await db
    .insert(projectGateEvaluations)
    .values({
      projectId: params.projectId,
      gateName,
      fromStage,
      targetStage: params.targetStage,
      status: allowed ? "PASS" : "FAIL",
      missingItems,
      hasOverride: Boolean(activeOverride),
      overrideId: activeOverride?.id ?? null,
      evaluatedByUserId: params.actorUserId ?? null,
      evaluatedByRole: params.actorRole ?? null,
    })
    .returning();

  await createProjectEvent({
    projectId: params.projectId,
    eventType: allowed ? "project.gate_passed" : "project.gate_failed",
    actorUserId: params.actorUserId ?? null,
    actorRole: params.actorRole ?? null,
    sourceEntityType: "project_gate_evaluations",
    sourceEntityId: String(evaluation.id),
    summary: allowed
      ? `Gate passed for move to ${params.targetStage}${activeOverride ? " (override)" : ""}`
      : `Gate failed for move to ${params.targetStage}`,
    details: { gateName, fromStage, targetStage: params.targetStage, missingItems, overrideId: activeOverride?.id ?? null },
    idempotencyKey: `stage-gate-eval:${evaluation.id}`,
  });

  return {
    allowed,
    gateName,
    projectId: params.projectId,
    fromStage,
    targetStage: params.targetStage,
    missingItems,
    usedOverride: Boolean(activeOverride),
    overrideId: activeOverride?.id ?? null,
  };
}

export async function createStageGateOverride(params: {
  projectId: number;
  gateName: string;
  targetStage: string;
  overrideReason: string;
  overriddenBy: number | null;
  overriddenByRole: string;
  expiresAt?: Date | null;
  note?: string | null;
}) {
  const [override] = await db
    .insert(stageGateOverrides)
    .values({
      projectId: params.projectId,
      gateName: params.gateName,
      targetStage: params.targetStage,
      overrideReason: params.overrideReason,
      overriddenBy: params.overriddenBy,
      overriddenByRole: params.overriddenByRole,
      expiresAt: params.expiresAt ?? null,
      note: params.note ?? null,
      isActive: true,
    })
    .returning();

  await createProjectEvent({
    projectId: params.projectId,
    eventType: "project.override_granted",
    actorUserId: params.overriddenBy,
    actorRole: params.overriddenByRole,
    sourceEntityType: "stage_gate_overrides",
    sourceEntityId: String(override.id),
    summary: `Stage gate override granted for ${params.targetStage}`,
    details: {
      gateName: params.gateName,
      targetStage: params.targetStage,
      overrideReason: params.overrideReason,
      expiresAt: params.expiresAt ?? null,
      note: params.note ?? null,
    },
    idempotencyKey: `stage-gate-override:${override.id}`,
  });

  return override;
}

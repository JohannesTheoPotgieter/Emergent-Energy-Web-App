/**
 * TF-22 (audit V3) — `S_HOLD` finance freeze.
 *
 * Before this gate existed a project on Hold could still receive new
 * invoices and have its revenue lines adjusted. Operationally that's
 * surprising — when EE puts a project on hold, the books should freeze
 * until the hold is resolved or an authoriser explicitly overrides.
 *
 * The gate runs whenever the finance-line-write service is about to
 * touch a project's normalized_cost_lines or normalized_revenue_lines.
 * It looks up the current stage code from projectInfo. If
 * `currentStageCode === 'S_HOLD'` and no override is supplied, it
 * throws a structured error.
 *
 * Per § 0A Override Principle: the gate refuses by default; owner
 * roles (COO_ADMIN / CEO_ADMIN / CFO) can override with a written
 * reason. The override flows through the same per-call mechanism as
 * TF-10's handover finance close-out gate.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { projectExecutionState } from "@shared/schema";
import { ApiError } from "../lib/api-error";

const HOLD_STAGE_CODE = "S_HOLD";

export class ProjectOnHoldError extends ApiError {
  constructor(message: string, projectId: number) {
    super(403, "project_on_hold", message, { projectId: String(projectId), currentStageCode: HOLD_STAGE_CODE });
  }
}

/**
 * Returns true when the project is currently in the S_HOLD terminal
 * branch. False for any other stage (active or S_DONE). False also
 * when the project doesn't exist (caller will hit a 404 later — this
 * gate doesn't pretend to be the existence check).
 */
export async function isProjectOnHold(projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ currentStageCode: projectExecutionState.currentStageCode })
    .from(projectExecutionState)
    .where(
      and(
        eq(projectExecutionState.projectId, projectId),
        // The execution-state table can in principle hold archived rows;
        // only the active row carries the live stage code.
        eq(projectExecutionState.isActive, true),
      ),
    )
    .limit(1);
  return row?.currentStageCode === HOLD_STAGE_CODE;
}

export interface AssertProjectNotOnHoldOptions {
  /** Caller-supplied override flag — typically gated on a permission check upstream. */
  override?: boolean;
  /** Required free-text reason when override=true. */
  overrideReason?: string;
}

/**
 * Assert that a project is not on hold, or that the caller has provided
 * a valid override. Throws ProjectOnHoldError otherwise.
 *
 * Call this from any code path that mutates finance lines on a project:
 * - Cost-line create / update / soft-close
 * - Revenue-line create / update / soft-close
 * - Smart Import re-imports targeting a held project
 */
export async function assertProjectNotOnHold(
  projectId: number,
  options: AssertProjectNotOnHoldOptions = {},
): Promise<void> {
  const onHold = await isProjectOnHold(projectId);
  if (!onHold) return;
  if (options.override) {
    if (!options.overrideReason || options.overrideReason.trim().length < 10) {
      throw new ApiError(
        400,
        "override_reason_required",
        "Override of S_HOLD finance freeze requires a reason of at least 10 characters.",
        { projectId: String(projectId) },
      );
    }
    return;
  }
  throw new ProjectOnHoldError(
    `Project ${projectId} is on hold (S_HOLD). Finance writes are frozen until the hold is resolved or an authoriser overrides with a reason.`,
    projectId,
  );
}

/**
 * fix/period-lock-all-write-paths — route-level COS period-lock guard.
 *
 * One reusable guard for every HTTP path that writes a periodised financial
 * figure. Wraps the pure `enforceCosPeriodLock` decision with the HTTP 423
 * response and the `cos.locked_period_override` audit write, so each handler is
 * a single line:
 *
 *   if (await guardCosPeriodLock(req, res, { effectiveDates: [date], ... })) return;
 *
 * Mirrors the existing COS-tracker pattern (toggle-realised / override-status /
 * date-override): 423 unless the actor is COO / CFO / CEO AND supplies a reason
 * (overrideReason | lockOverrideReason in the body); the override is audited.
 */

import type { Request, Response } from "express";

import { logAuditFromReq } from "../../audit-logger";
import { enforceCosPeriodLock, periodLockedBody } from "./period-lock";

export interface GuardCosPeriodLockOptions {
  /** Every periodised effective date the write touches (batch-aware). */
  effectiveDates: Array<string | Date | null | undefined>;
  /** Human label for the 423 message + audit, e.g. "Tracker monthly". */
  surface: string;
  entityType: string;
  entityId: string;
  projectName?: string | null;
}

/**
 * Returns `true` when the request was BLOCKED (a 423 has been written and the
 * caller must `return`). Returns `false` to proceed; on a reasoned override it
 * has already written one `cos.locked_period_override` audit row per locked
 * period.
 */
export async function guardCosPeriodLock(
  req: Request,
  res: Response,
  opts: GuardCosPeriodLockOptions,
): Promise<boolean> {
  const user = req.user as { id?: number; role?: string } | undefined;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const overrideReason =
    (typeof body.overrideReason === "string" && body.overrideReason) ||
    (typeof body.lockOverrideReason === "string" && body.lockOverrideReason) ||
    null;

  const enforcement = await enforceCosPeriodLock({
    effectiveDates: opts.effectiveDates,
    role: user?.role,
    overrideReason,
  });

  if (enforcement.blocked) {
    res.status(423).json(periodLockedBody(enforcement, opts.surface));
    return true;
  }

  if (enforcement.overriddenPeriods.length > 0) {
    logAuditFromReq(req, {
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: "cos.locked_period_override",
      projectName: opts.projectName ?? undefined,
      changesJson: {
        surface: opts.surface,
        periods: enforcement.overriddenPeriods,
        reason: overrideReason,
        overriddenByUserId: user?.id ?? null,
        overriddenByRole: user?.role ?? null,
      },
    });
  }

  return false;
}

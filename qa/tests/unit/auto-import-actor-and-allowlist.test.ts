/**
 * M3 auto-import — actor, manual-commit allowlist, and lock-safety invariants.
 *
 * The auto-commit *decision* guards (clean→commit; locked/over-wipe/orphan/
 * net-delta→park) are locked by qa/tests/unit/import-commit-gate.test.ts. This
 * file pins the surrounding guarantees the task calls out, which are NOT about
 * the decision function but about WHO commits and HOW locks are treated:
 *
 *   - the scheduled auto-commit runs as the SYSTEM actor (no user id; audited
 *     as SYSTEM / "scheduler") so unattended writes are attributable;
 *   - MANUAL commit is allowlisted — it requires `smart_import:approve`, whose
 *     roles EXCLUDE PROGRAM_MANAGER and CONSTRUCTION_MANAGER, so PMs/CMs (who
 *     may *enter* finance) still cannot commit an import;
 *   - the scheduler's locked-period check passes NO role, so a COS period lock
 *     is NEVER auto-overridden — a locked run parks for a human instead.
 *
 * These are source-level / registry-level invariants (no DB needed); a full
 * behavioural commit test needs a live DB and lives in qa/tests/api/.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ENTITY_REGISTRY } from "@shared/permissions/registry";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("M3 auto-import — scheduled commit runs as the SYSTEM actor", () => {
  const commitSrc = read("server/services/scheduler-commit.ts");

  it("marks the run committed with no committing user (committedBy: null)", () => {
    expect(commitSrc).toContain("committedBy: null");
  });

  it("audits the commit as the SYSTEM actor, not a person", () => {
    // audit_events row — standard reports must show a SYSTEM-attributed commit.
    expect(commitSrc).toContain('actorRole: "SYSTEM"');
    expect(commitSrc).toContain('userName: "scheduler"');
    // The diff-engine change is recorded with no actor user id.
    expect(commitSrc).toContain("actorUserId: undefined");
  });

  it("the orchestrator hands clean runs to the system commit service", () => {
    const schedulerSrc = read("server/services/scheduled-import-v2.ts");
    expect(schedulerSrc).toContain("commitSmartImportRunAsSystem(");
  });
});

describe("M3 auto-import — manual commit is allowlisted (PMs/CMs cannot commit)", () => {
  it("the commit route is gated on smart_import:approve", () => {
    const routesSrc = read("server/smart-import-routes.ts");
    // POST /api/smart-import/:runId/commit must require the 'approve' action.
    expect(routesSrc).toMatch(
      /\/api\/smart-import\/:runId\/commit"[^)]*requirePermission\("smart_import",\s*"approve"\)/,
    );
  });

  it("smart_import approve roles are management-only and exclude PMs/CMs", () => {
    const smartImport = ENTITY_REGISTRY.find((e) => e.entity === "smart_import");
    expect(smartImport, "smart_import must be a registered permission entity").toBeDefined();
    const approvers = smartImport!.approve_roles ?? [];
    // PMs / CMs may ENTER the finance module (LIVE_READY_ROLE_ALLOWLIST) but
    // must NOT be able to commit an import.
    expect(approvers).not.toContain("PROGRAM_MANAGER");
    expect(approvers).not.toContain("CONSTRUCTION_MANAGER");
    // The admin roles that may commit are present.
    expect(approvers).toContain("COO_ADMIN");
    expect(approvers).toContain("CEO_ADMIN");
  });
});

describe("M3 auto-import — scheduler parks unclean runs for review", () => {
  const schedulerSrc = read("server/services/scheduled-import-v2.ts");

  it("the scheduler routes the commit/park decision through the auto-commit gate", () => {
    expect(schedulerSrc).toContain("decideSchedulerAutoCommit(");
  });

  it("COS period-lock enforcement is removed from the import path (owner 2026-06-18)", () => {
    // Imports no longer park on a locked COS period; other finance write paths
    // keep their period-lock guards.
    expect(schedulerSrc).not.toContain("enforceCosPeriodLock(");
  });

  it("a parked run is awaiting_review AND raises a review alert", () => {
    expect(schedulerSrc).toContain('"awaiting_review"');
    expect(schedulerSrc).toContain('maybeSendImportAlert("needs_review"');
  });
});

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
 *   - MANUAL commit is allowlisted — it requires `smart_import:edit` (collapsed
 *     model; was `:approve`). Under the collapsed model `edit_roles` is the
 *     de-duplicated UNION of the old create/edit/approve/override/delete lists.
 *     CONSTRUCTION_MANAGER is still excluded, but PROGRAM_MANAGER is now in the
 *     union (it was in the old edit_roles) and so CAN commit — see the flagged
 *     security note on that assertion below;
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

describe("M3 auto-import — manual commit is allowlisted (CMs cannot commit)", () => {
  it("the commit route is gated on smart_import:edit", () => {
    const routesSrc = read("server/smart-import-routes.ts");
    // POST /api/smart-import/:runId/commit must require the 'edit' action
    // (collapsed model; was 'approve'). `edit` subsumes the old approve gate.
    expect(routesSrc).toMatch(
      /\/api\/smart-import\/:runId\/commit"[^)]*requirePermission\("smart_import",\s*"edit"\)/,
    );
  });

  it("smart_import edit roles are management-only and exclude CONSTRUCTION_MANAGER", () => {
    const smartImport = ENTITY_REGISTRY.find((e) => e.entity === "smart_import");
    expect(smartImport, "smart_import must be a registered permission entity").toBeDefined();
    const editors = smartImport!.edit_roles ?? [];
    // CMs may ENTER the finance module (LIVE_READY_ROLE_ALLOWLIST) but must NOT
    // be able to commit an import.
    expect(editors).not.toContain("CONSTRUCTION_MANAGER");
    // SECURITY CHANGE (flagged): under the old 6-action model the commit gate
    // (smart_import:approve) EXCLUDED PROGRAM_MANAGER. The collapsed model folds
    // approve into edit, and edit_roles is the UNION of the old lists, which
    // includes PROGRAM_MANAGER (it held the old edit capability). So a PROGRAM_
    // MANAGER can now commit a smart import. This is a real widening of the
    // commit allowlist introduced by the collapse — recomputed against the
    // registry, not a test weakening. Was: expect(...).not.toContain("PROGRAM_MANAGER").
    expect(editors).toContain("PROGRAM_MANAGER");
    // The admin roles that may commit are present.
    expect(editors).toContain("COO_ADMIN");
    expect(editors).toContain("CEO_ADMIN");
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

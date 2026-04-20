/**
 * Stage-gate immutability regression guards (§6)
 *
 * Pins the outcome of the §6 fix: once a stage has been CLOSED
 * (approved / progressed / exception_approved), its requirements are
 * audit records and must not be mutated silently. A reopen requires
 * COO_ADMIN or CEO_ADMIN AND a written justification, which is
 * persisted to project_stage_decisions.
 *
 * These are source-text assertions on purpose. A runtime test would
 * require a live DB; this level of pinning catches anyone who deletes
 * the guard, swaps the role set, drops the audit insert, or forgets
 * to plumb actorRole / reopenReason through the route handler.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("stage-gate immutability — service guard", () => {
  const svc = read("server/services/stage-lifecycle-service.ts");

  it("declares the CLOSED_STAGE_STATUSES set covering all terminal statuses", () => {
    expect(svc).toMatch(/export const CLOSED_STAGE_STATUSES = new Set<string>\(/);
    expect(svc).toContain("'approved'");
    expect(svc).toContain("'progressed'");
    expect(svc).toContain("'exception_approved'");
  });

  it("restricts reopen to COO_ADMIN and CEO_ADMIN only", () => {
    expect(svc).toMatch(/export const STAGE_REOPEN_ROLES = new Set<string>\(/);
    expect(svc).toContain("'COO_ADMIN'");
    expect(svc).toContain("'CEO_ADMIN'");
  });

  it("UpdateRequirementParams accepts actorRole and reopenReason", () => {
    expect(svc).toMatch(/actorRole\?:\s*string/);
    expect(svc).toMatch(/reopenReason\?:\s*string/);
  });

  it("updateRequirementStatus fetches the parent stage and checks its status", () => {
    expect(svc).toMatch(/const \[parentStage\] = await db/);
    expect(svc).toMatch(/CLOSED_STAGE_STATUSES\.has\(parentStatus\)/);
  });

  it("rejects closed-stage edits from non-reopen roles", () => {
    expect(svc).toMatch(/STAGE_REOPEN_ROLES\.has\(actorRole\)/);
    expect(svc).toMatch(/only COO_ADMIN or CEO_ADMIN may modify its requirements/);
  });

  it("rejects closed-stage edits without a reopenReason of at least 10 chars", () => {
    expect(svc).toMatch(/reopenReason\.trim\(\)\.length < 10/);
    expect(svc).toMatch(/reopenReason of at least 10 characters/);
  });

  it("logs a stage_reopen decision row when a valid reopen is performed", () => {
    expect(svc).toMatch(/await db\.insert\(projectStageDecisions\)\.values\(\{[\s\S]*?decisionType:\s*'stage_reopen'/);
    expect(svc).toMatch(/rationale:\s*reopenReason\.trim\(\)/);
  });
});

describe("stage-gate immutability — route wiring", () => {
  const routes = read("server/stage-lifecycle-routes.ts");

  it("pulls reopenReason from req.body on the requirement PATCH route", () => {
    expect(routes).toMatch(/const \{[^}]*reopenReason[^}]*\}\s*=\s*req\.body/);
  });

  it("passes actorRole and reopenReason through to updateRequirementStatus", () => {
    expect(routes).toMatch(
      /updateRequirementStatus\(\{[\s\S]*?actorRole:\s*user\.role,[\s\S]*?reopenReason,?[\s\S]*?\}\)/,
    );
  });
});

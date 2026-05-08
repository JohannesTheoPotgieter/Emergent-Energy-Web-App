/**
 * Plan v3 § 2.3 / B.1 — coverage assertion: every service-layer function
 * that writes a domain-specific transition history row also writes a
 * canonical `audit_events` row via `recordAudit`.
 *
 * This is a static-shape regression test — it reads each service source
 * file and asserts the presence of a `recordAudit({` call alongside the
 * domain audit write. We don't run the services here because each one
 * needs different fixture data; full happy-path integration is covered by
 * the per-domain integration suites. The point of this test is to catch
 * "someone removed / renamed the audit call" regressions cheaply.
 *
 * If you legitimately need to remove an audit call, update the assertion
 * here AND log a decision under `docs/active/wave-0/decisions-log.md`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");

interface Coverage {
  file: string;
  functionName: string;
  expectedAction: string;
  expectedEntityType: string;
}

const COVERAGE: Coverage[] = [
  {
    file: "server/services/stage-lifecycle-service.ts",
    functionName: "transitionStageStatus",
    expectedAction: "TRANSITION_STAGE_STATUS",
    expectedEntityType: "stage",
  },
  {
    file: "server/services/stage-lifecycle-service.ts",
    functionName: "advanceToStage",
    expectedAction: "ADVANCE_TO_STAGE",
    expectedEntityType: "project",
  },
  {
    file: "server/services/stage-lifecycle-service.ts",
    functionName: "markProjectDone",
    expectedAction: "MARK_PROJECT_DONE",
    expectedEntityType: "project",
  },
  {
    file: "server/services/om-handover-service.ts",
    functionName: "markOmHandoverComplete",
    expectedAction: "MARK_COMPLETE",
    expectedEntityType: "om_handover",
  },
  {
    file: "server/api/v2/repositories/project-v2-repository.ts",
    functionName: "transitionProjectToConstruction",
    expectedAction: "TRANSITION_TO_CONSTRUCTION",
    expectedEntityType: "project",
  },
  {
    file: "server/services/stage-exception-service.ts",
    functionName: "approveException",
    expectedAction: "APPROVE_EXCEPTION",
    expectedEntityType: "stage_exception",
  },
  {
    file: "server/services/stage-exception-service.ts",
    functionName: "rejectException",
    expectedAction: "REJECT_EXCEPTION",
    expectedEntityType: "stage_exception",
  },
  {
    file: "server/services/pending-approvals-service.ts",
    functionName: "approvePending",
    expectedAction: "APPROVE_PENDING",
    expectedEntityType: "pending_approval",
  },
  {
    file: "server/services/pending-approvals-service.ts",
    functionName: "rejectPending",
    expectedAction: "REJECT_PENDING",
    expectedEntityType: "pending_approval",
  },
  {
    file: "server/services/quickbooks-cascade-proposals-service.ts",
    functionName: "acceptProposal",
    expectedAction: "ACCEPT_QB_CASCADE",
    expectedEntityType: "qb_cascade_proposal",
  },
];

describe("audit-events coverage — Plan v3 § 2.3 / B.1", () => {
  it("every service file imports recordAudit", () => {
    const files = Array.from(new Set(COVERAGE.map((c) => c.file)));
    for (const file of files) {
      const src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(
        src,
        `${file} must import recordAudit from audit-service`,
      ).toMatch(/from\s+["'][^"']*audit-service["']/);
      expect(
        src,
        `${file} must import recordAudit (named import)`,
      ).toMatch(/recordAudit/);
    }
  });

  for (const cov of COVERAGE) {
    it(`${cov.functionName} (${cov.file}) writes recordAudit with action=${cov.expectedAction}`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, cov.file), "utf8");
      // Find the function definition.
      const fnIndex = src.indexOf(`function ${cov.functionName}`);
      expect(
        fnIndex,
        `function ${cov.functionName} not found in ${cov.file}`,
      ).toBeGreaterThan(-1);
      // Find the next top-level export/function declaration to bound the body.
      const nextFnRe = /\n(?:export\s+)?(?:async\s+)?function\s+\w+|^export\s+function\s+\w+/m;
      const after = src.slice(fnIndex + `function ${cov.functionName}`.length);
      const nextFn = after.search(nextFnRe);
      const body = nextFn === -1 ? after : after.slice(0, nextFn);
      expect(
        body,
        `${cov.functionName} body missing recordAudit({...}) call`,
      ).toMatch(/recordAudit\s*\(/);
      // Some services build the action conditionally (e.g.
      // `action: isAdmin ? "STAGE_OVERRIDE_STATUS" : "TRANSITION_STAGE_STATUS"`),
      // so the literal `action: "X"` substring may not appear. Match the
      // bare quoted action string anywhere in the body instead.
      expect(
        body,
        `${cov.functionName} body missing action string "${cov.expectedAction}"`,
      ).toContain(`"${cov.expectedAction}"`);
      expect(
        body,
        `${cov.functionName} body missing entityType: "${cov.expectedEntityType}"`,
      ).toContain(`entityType: "${cov.expectedEntityType}"`);
    });
  }

  it("recordAudit helper writes actorRole='UNKNOWN' when role lookup fails", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "server/api/v2/services/audit-service.ts"),
      "utf8",
    );
    expect(src, "audit-service must support userId-only invocation").toMatch(
      /actorRole\?:\s*string/,
    );
    expect(src, "audit-service must look up role from users table when missing").toContain(
      "from(users)",
    );
    expect(src, "audit-service must fall back to UNKNOWN").toMatch(
      /actorRole\s*\?\?\s*"UNKNOWN"/,
    );
  });
});

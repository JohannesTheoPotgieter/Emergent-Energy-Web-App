/**
 * Smart Import UX-3 regression guards
 *
 * Pins the three new components:
 *   - SmartImportDecisionIntro (plain-English intro on the Decision step)
 *   - SmartImportDownstreamImpact ("who will see this" on Confirm)
 *   - SmartImportPostCommitNext ("what happens next" on result screen)
 * plus their wiring into the existing step components.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("UX-3 — decision intro component", () => {
  const src = read("client/src/components/smart-import/SmartImportDecisionIntro.tsx");

  it("is exported with the data-testid anchor", () => {
    expect(src).toMatch(/export function SmartImportDecisionIntro/);
    expect(src).toMatch(/data-testid="decision-intro"/);
  });

  it("opens with 'We found N items' sentence pattern", () => {
    expect(src).toMatch(/We found/);
    expect(src).toMatch(/your spreadsheet and the app disagree/);
  });

  it("shows a resolved/remaining tally when at least one is resolved", () => {
    expect(src).toMatch(/resolvedCount > 0/);
    expect(src).toMatch(/already decided/);
  });

  it("surfaces QuickBooks-linked and predecessor-impact side notes", () => {
    expect(src).toMatch(/data-testid="decision-intro-qb"/);
    expect(src).toMatch(/data-testid="decision-intro-predecessor"/);
    expect(src).toMatch(/linked to QuickBooks/);
    expect(src).toMatch(/predecessors/);
  });
});

describe("UX-3 — downstream-impact card", () => {
  const src = read("client/src/components/smart-import/SmartImportDownstreamImpact.tsx");

  it("is exported with the data-testid anchor", () => {
    expect(src).toMatch(/export function SmartImportDownstreamImpact/);
    expect(src).toMatch(/data-testid="downstream-impact"/);
  });

  it("derives impact lines from PLAN / REVENUE / EXPENDITURE totals", () => {
    expect(src).toMatch(/planTotal/);
    expect(src).toMatch(/revTotal/);
    expect(src).toMatch(/costTotal/);
  });

  it("always surfaces the 'no automatic Teams ping' passive line", () => {
    // testIds are passed via config object → rendered as data-testid at runtime.
    expect(src).toMatch(/"downstream-construction"/);
    expect(src).toMatch(/No automatic ping/);
  });
});

describe("UX-3 — post-commit next card", () => {
  const src = read("client/src/components/smart-import/SmartImportPostCommitNext.tsx");

  it("is exported with the data-testid anchor", () => {
    expect(src).toMatch(/export function SmartImportPostCommitNext/);
    expect(src).toMatch(/data-testid="post-commit-next"/);
  });

  it("gates the stage-readiness line on plan-section touches", () => {
    expect(src).toMatch(/planTouched/);
    expect(src).toMatch(/"next-stage-readiness"/);
  });

  it("gates QuickBooks-sync line on revenue or cost touches", () => {
    expect(src).toMatch(/revTouched \|\| costTouched/);
    expect(src).toMatch(/"next-quickbooks-sync"/);
  });

  it("always includes the reversibility / undo-window line", () => {
    expect(src).toMatch(/"next-undo-window"/);
    expect(src).toMatch(/7 days/);
  });
});

describe("UX-3 — step integration", () => {
  const decision = read("client/src/components/smart-import/SmartImportDecisionStep.tsx");
  const confirm = read("client/src/components/smart-import/SmartImportConfirmStep.tsx");
  const barrel = read("client/src/components/smart-import/index.ts");

  it("DecisionStep mounts SmartImportDecisionIntro at the top", () => {
    expect(decision).toMatch(/SmartImportDecisionIntro/);
    expect(decision).toMatch(
      /<SmartImportDecisionIntro\s+pendingCount=\{totalDecisions - resolvedCount\}\s+totalCount=\{totalDecisions\}\s*\/>/,
    );
  });

  it("ConfirmStep mounts DownstreamImpact before the commit button", () => {
    expect(confirm).toMatch(/SmartImportDownstreamImpact/);
    expect(confirm).toMatch(
      /<SmartImportDownstreamImpact[\s\S]*?projectName=\{preview\?\.detection\?\.projectInfo\?\.name/,
    );
  });

  it("ConfirmStep mounts PostCommitNext on the result screen", () => {
    expect(confirm).toMatch(/SmartImportPostCommitNext/);
    expect(confirm).toMatch(/<SmartImportPostCommitNext\s+planning=\{planning\}\s+commitResult=\{commitResult\}\s*\/>/);
  });

  it("the smart-import barrel re-exports all three UX-3 components", () => {
    expect(barrel).toMatch(/SmartImportDecisionIntro/);
    expect(barrel).toMatch(/SmartImportDownstreamImpact/);
    expect(barrel).toMatch(/SmartImportPostCommitNext/);
  });
});

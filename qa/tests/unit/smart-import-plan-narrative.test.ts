/**
 * Smart Import UX-2 regression guards — plan narrative + schedule impact
 *
 * Pins the two new components and their mounting inside the Found /
 * Changes steps.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("UX-2 — plan narrative component", () => {
  const src = read("client/src/components/smart-import/SmartImportPlanNarrative.tsx");

  it("is exported with the expected shape", () => {
    expect(src).toMatch(/export function SmartImportPlanNarrative/);
    expect(src).toMatch(/data-testid="plan-narrative"/);
  });

  it("leads with 'We found' prose that includes phase/row/date counts", () => {
    expect(src).toMatch(/We found/);
    expect(src).toMatch(/<strong>\{phases\}/);
    expect(src).toMatch(/<strong>\{totalRows\}/);
    // Span rendering is gated by earliest && latest — guard the formatter.
    expect(src).toMatch(/earliest && latest/);
  });

  it("surfaces 'tasks missing owner' and '100% complete' side-notes", () => {
    expect(src).toMatch(/plan-narrative-no-owner/);
    expect(src).toMatch(/plan-narrative-completed/);
  });

  it("has a graceful fallback when there is no PLAN section", () => {
    expect(src).toMatch(/here's what we read from your file/i);
  });
});

describe("UX-2 — schedule impact card", () => {
  const src = read("client/src/components/smart-import/SmartImportScheduleImpact.tsx");

  it("renders nothing when there are no plan rows", () => {
    expect(src).toMatch(/if \(!Array\.isArray\(planRows\) \|\| planRows\.length === 0\) return null/);
  });

  it("surfaces earliest start, latest end, and milestone counts", () => {
    expect(src).toMatch(/data-testid="schedule-start"/);
    expect(src).toMatch(/data-testid="schedule-end"/);
    expect(src).toMatch(/data-testid="schedule-milestones"/);
  });

  it("flags schedule slip when latest end is past the planned cutoff", () => {
    expect(src).toMatch(/data-testid="schedule-slip-warning"/);
    expect(src).toMatch(/slipsOut/);
  });
});

describe("UX-2 — step integration", () => {
  const found = read("client/src/components/smart-import/SmartImportFoundStep.tsx");
  const changes = read("client/src/components/smart-import/SmartImportChangesStep.tsx");
  const barrel = read("client/src/components/smart-import/index.ts");

  it("FoundStep imports + mounts the plan narrative", () => {
    expect(found).toMatch(/SmartImportPlanNarrative/);
    expect(found).toMatch(/<SmartImportPlanNarrative\s+planning=\{planning\}\s+preview=\{preview\}\s*\/>/);
  });

  it("ChangesStep imports + mounts the schedule-impact card above QB and sections", () => {
    expect(changes).toMatch(/SmartImportScheduleImpact/);
    expect(changes).toMatch(
      /<SmartImportScheduleImpact\s+planning=\{planning\}\s*\/>[\s\S]*?SmartImportQbProtectionsCallout[\s\S]*?SectionSummaryCard/,
    );
  });

  it("the smart-import barrel re-exports both UX-2 components", () => {
    expect(barrel).toMatch(/SmartImportPlanNarrative/);
    expect(barrel).toMatch(/SmartImportScheduleImpact/);
  });
});

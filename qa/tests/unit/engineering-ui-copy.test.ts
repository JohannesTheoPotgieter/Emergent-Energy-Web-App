import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Static copy-regression tests. These exist so that no future refactor
 * can silently reintroduce the misleading phrases that conflate QC
 * review approval with "issued for construction".
 *
 * They are deliberately text-grep tests. If you find yourself adding a
 * legitimate use of one of the banned phrases, add a comment like
 * `// lint:allow-approved-copy` on the line and extend the exclusion
 * below — do NOT just delete the test.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("EngineeringTasksPage copy", () => {
  const source = read("client/src/pages/EngineeringTasksPage.tsx");

  it("does not contain bare 'Send for Approval' button label", () => {
    // Renamed to "Submit for QC Review" to disambiguate from deliverable send
    expect(source).not.toMatch(/>.*Send for Approval.*</);
  });

  it("does not contain bare 'Send Deliverable' button label", () => {
    // Renamed to "Send Document" to clarify it's a document transfer, not a QC action
    expect(source).not.toMatch(/>.*Send Deliverable.*</);
  });

  it("workload filter uses 'QC Review Pending' not 'Approval Pending'", () => {
    expect(source).toContain("QC Review Pending");
    expect(source).not.toMatch(/label:\s*"Approval Pending"/);
  });

  it("imports DocumentControlBadge for the drawer", () => {
    expect(source).toContain("DocumentControlBadge");
  });

  it("renders DocumentControlBadge in the drawer deliverable listing", () => {
    expect(source).toContain("drawer-doc-control-");
  });

  it("uses 'awaiting QC review' instead of 'pending approval' for deliverable count", () => {
    expect(source).not.toContain("pending approval");
    expect(source).toContain("awaiting QC review");
  });
});

describe("EngineeringStagesTab copy", () => {
  const source = read("client/src/components/tabs/EngineeringStagesTab.tsx");
  const lines = source.split("\n");

  it("does not contain the dangerous phrase 'Approved — task can now be completed'", () => {
    expect(source).not.toContain("Approved — task can now be completed");
    expect(source).not.toContain("Approved - task can now be completed");
  });

  it("does not render a bare 'Approved' badge label (must qualify with QC / review)", () => {
    // Find every occurrence of the word "Approved" in a string that looks
    // like a JSX label/badge and ensure it is qualified. Skip lines that
    // are line comments — a test that catches its own doc-comments is a
    // false positive factory.
    for (const [idx, rawLine] of lines.entries()) {
      if (rawLine.includes("lint:allow-approved-copy")) continue;
      const trimmed = rawLine.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      // Match a JSX-ish `>Approved<` only — that is the render form.
      // Skip plain string literals because they may be discriminator
      // values ("approved") rather than user-facing copy.
      const bare = />Approved</.test(rawLine);
      if (!bare) continue;
      const lineNo = idx + 1;
      const lowered = rawLine.toLowerCase();
      const qualified =
        lowered.includes("qc") || lowered.includes("review") || lowered.includes("for construction");
      expect.soft(qualified, `EngineeringStagesTab.tsx:${lineNo} renders a bare "Approved" label: ${rawLine.trim()}`).toBe(true);
    }
  });

  it("imports DocumentControlBadge (so the control state is actually rendered)", () => {
    expect(source).toContain("DocumentControlBadge");
    expect(source).toMatch(/from ["']@\/components\/engineering\/DocumentControlBadge["']/);
  });

  it("imports DeliverableControlActions", () => {
    expect(source).toContain("DeliverableControlActions");
  });

  it("uses the word 'QC' somewhere — the new terminology is present", () => {
    expect(source).toMatch(/QC /);
  });

  it("renders a document-control rollup testid", () => {
    expect(source).toContain('data-testid="document-control-rollup"');
  });

  it("has the missing-IFC warning gate", () => {
    expect(source).toContain('data-testid="missing-ifc-warning"');
  });
});

describe("DocumentControlBadge component", () => {
  const source = read("client/src/components/engineering/DocumentControlBadge.tsx");

  it("derives state via the helper (no inline approvalStatus→badge logic)", () => {
    expect(source).toContain("deriveControlState");
  });

  it("emits a data-construction-safe attribute so e2e tests can assert it", () => {
    expect(source).toContain("data-construction-safe");
  });
});

describe("DeliverableControlActions component", () => {
  const source = read("client/src/components/engineering/DeliverableControlActions.tsx");

  it("calls the existing backend endpoints (no new routes introduced)", () => {
    expect(source).toContain("/api/eng-stages/deliverables/");
    expect(source).toContain("/issue-for-construction");
    expect(source).toContain("/mark-as-built");
  });

  it("blocks self-issue (segregation of duties) on the client before POSTing", () => {
    expect(source).toMatch(/uploadedBy/);
    expect(source).toMatch(/segregation of duties/i);
  });
});

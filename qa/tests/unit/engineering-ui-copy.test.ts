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
  // TaskDetailDrawer + PostUpdateForm (which carry the drawer copy these
  // assertions guard) were extracted to ./engineering/EngineeringTaskDrawer
  // (UI/UX audit module split). Read both the orchestrator and the extracted
  // drawer module so the SAME assertions still validate the moved code
  // wherever it now lives.
  const source =
    read("client/src/pages/EngineeringTasksPage.tsx") +
    "\n" +
    read("client/src/pages/engineering/EngineeringTaskDrawer.tsx");

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

describe("DocumentControlBadge component", () => {
  const source = read("client/src/components/engineering/DocumentControlBadge.tsx");

  it("derives state via the helper (no inline approvalStatus→badge logic)", () => {
    expect(source).toContain("deriveControlState");
  });

  it("emits a data-construction-safe attribute so e2e tests can assert it", () => {
    expect(source).toContain("data-construction-safe");
  });
});

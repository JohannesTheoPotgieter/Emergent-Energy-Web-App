import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Static copy-regression tests. These exist so that no future refactor can
 * silently reintroduce the misleading phrases that conflate QC review approval
 * with "issued for construction" / a deliverable send.
 *
 * They are deliberately text-grep tests. If you find yourself adding a
 * legitimate use of one of the banned phrases, add a comment like
 * `// lint:allow-approved-copy` on the line and extend the exclusion below —
 * do NOT just delete the test.
 *
 * NOTE: the legacy project-tab board (`pages/EngineeringTasksPage.tsx`) and its
 * drawer (`pages/engineering/EngineeringTaskDrawer.tsx`) were retired in the
 * board-unification (engineering hardening Batch 4). The engineering task UI now
 * lives in the routed board + its `dialogs/` and `spine/` components, so these
 * guards scan that live surface instead.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readDir(relDir: string): string {
  const dir = path.join(REPO_ROOT, relDir);
  if (!fs.existsSync(dir)) return "";
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

describe("Engineering task UI copy", () => {
  const source =
    read("client/src/pages/engineering/EngineeringTaskManagerPage.tsx") +
    "\n" +
    readDir("client/src/pages/engineering/dialogs") +
    "\n" +
    readDir("client/src/pages/engineering/spine");

  it("does not contain a bare 'Send for Approval' button label", () => {
    // Renamed to "Submit for QC Review" to disambiguate from a deliverable send.
    expect(source).not.toMatch(/>.*Send for Approval.*</);
  });

  it("does not contain a bare 'Send Deliverable' button label", () => {
    // Renamed to "Send Document" to clarify it's a document transfer, not a QC action.
    expect(source).not.toMatch(/>.*Send Deliverable.*</);
  });

  it("does not use 'pending approval' for the deliverable/QC state", () => {
    expect(source).not.toContain("pending approval");
  });
});

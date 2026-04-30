/**
 * D6 Phase 4 — DisciplinePanel + project-documents page shape.
 *
 * Pure unit tests — no DB, no React mounting. Validates that:
 *   1. DisciplinePanel exists, accepts the expected props, joins
 *      taxonomy with project folders, treats empty disciplines as
 *      "shared", and exposes data-testids that E2E can target.
 *   2. The /projects/:id/documents page is wired to the new panel and
 *      no longer imports the legacy DocumentStrip / ApprovalQueueCard.
 *   3. The public taxonomy + project-folders hooks exist and use the
 *      anonymous /api/folder-taxonomy + /api/projects/:id/folders
 *      endpoints (not the admin variants — RBAC matters).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const panelFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "DisciplinePanel.tsx"),
  "utf8",
);
const pageFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "project-documents.tsx"),
  "utf8",
);
const hooksFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "hooks", "use-document-management-admin.ts"),
  "utf8",
);

describe("D6 Phase 4 — DisciplinePanel component", () => {
  it("exports the DisciplinePanel function", () => {
    expect(panelFile).toMatch(/export function DisciplinePanel/);
  });

  it("declares the expected DisciplinePanelProps shape", () => {
    expect(panelFile).toMatch(/projectId:\s*number/);
    expect(panelFile).toMatch(/discipline:\s*string/);
    expect(panelFile).toMatch(/includeShared\?:\s*boolean/);
    expect(panelFile).toMatch(/title\?:\s*string/);
  });

  it("treats empty disciplines arrays as 'shared / all' when includeShared is true", () => {
    expect(panelFile).toMatch(/disciplines\.length === 0/);
    expect(panelFile).toMatch(/includeShared/);
  });

  it("filters by the active flag so deactivated taxonomy rows never render", () => {
    expect(panelFile).toMatch(/!t\.active/);
  });

  it("derives a (provisioned / missing / errors) summary from the joined rows", () => {
    expect(panelFile).toMatch(/const summary = useMemo/);
    expect(panelFile).toMatch(/provisioned/);
    expect(panelFile).toMatch(/missing/);
    expect(panelFile).toMatch(/errors/);
  });

  it("exposes data-testids that the project page + E2E can target", () => {
    const expected = [
      "discipline-panel-",
      "discipline-summary-provisioned-",
      "discipline-summary-missing-",
      "discipline-summary-errors-",
      "discipline-table-",
      "discipline-row-",
    ];
    for (const id of expected) {
      expect(panelFile).toContain(`data-testid={\`${id}`);
    }
  });

  it("uses the public taxonomy + folders hooks (NOT the admin endpoint)", () => {
    expect(panelFile).toMatch(/usePublicFolderTaxonomy/);
    expect(panelFile).toMatch(/useProjectFolders/);
    // Negative: must not use the admin-only useFolderTaxonomy variant.
    expect(panelFile).not.toMatch(/useFolderTaxonomy[^A-Za-z]/);
  });
});

describe("D6 Phase 4 — project-documents page", () => {
  it("retires the legacy DocumentStrip + ApprovalQueueCard imports", () => {
    // Only check `import` lines; explanatory mentions in the docblock are
    // expected and useful for future readers.
    const importLines = pageFile
      .split("\n")
      .filter((l) => /^\s*import /.test(l))
      .join("\n");
    expect(importLines).not.toMatch(/DocumentStrip/);
    expect(importLines).not.toMatch(/ApprovalQueueCard/);
  });

  it("renders the new DisciplinePanel for each discipline that has folders", () => {
    expect(pageFile).toMatch(/import \{ DisciplinePanel \}/);
    expect(pageFile).toMatch(/<DisciplinePanel\b/);
  });

  it("provides an 'All disciplines' tab plus one tab per active discipline", () => {
    expect(pageFile).toMatch(/data-testid="tab-discipline-ALL"/);
    expect(pageFile).toMatch(/data-testid={`tab-discipline-\$\{d\}`}/);
  });

  it("computes disciplinesWithRows from the live taxonomy", () => {
    expect(pageFile).toMatch(/disciplinesWithRows/);
    expect(pageFile).toMatch(/LIFECYCLE_DEPARTMENTS/);
  });

  it("renders an overall readiness summary (provisioned / missing / verify errors)", () => {
    expect(pageFile).toMatch(/data-testid="overall-summary-provisioned"/);
    expect(pageFile).toMatch(/data-testid="overall-summary-missing"/);
    expect(pageFile).toMatch(/data-testid="overall-summary-errors"/);
  });
});

describe("D6 Phase 4 — public hooks", () => {
  it("exports usePublicFolderTaxonomy and usePublicApprovalRequirements", () => {
    expect(hooksFile).toMatch(/export function usePublicFolderTaxonomy/);
    expect(hooksFile).toMatch(/export function usePublicApprovalRequirements/);
  });

  it("queries /api/folder-taxonomy (not the admin endpoint)", () => {
    expect(hooksFile).toMatch(/PUBLIC_TAXONOMY_KEY\s*=\s*\[\s*"\/api\/folder-taxonomy"\s*\]/);
    expect(hooksFile).toMatch(
      /PUBLIC_REQUIREMENTS_KEY\s*=\s*\[\s*"\/api\/document-approval-requirements"\s*\]/,
    );
  });
});

/**
 * D6 readiness sweep — verifies the production-readiness wiring for Phases 3-6,
 * rebased onto the Phase 5 browse-and-bind reality:
 *
 *   Phase 3.1 — admin UI for `companySharepointRoots[kind=active_projects]`
 *               + webUrl persistence + deep-link rendering.
 *   Phase 3.2 — document-management SharePoint setup panel.
 *   Phase 4.1 — deep-linkable discipline tabs + per-tab "bound" badge.
 *   Phase 5.1 — notification fan-out on request/approve/reject.
 *   Phase 6.1 — discipline-basis readiness rollup + tile mount on coo-home.
 *
 * PHASE 5 DECOMMISSION: the legacy folder_taxonomy + project_folders +
 * manual-provisioning surface was removed, so the provisioning-service,
 * project-folders-repository, taxonomy-seed, and stage-filter / file-name
 * matcher assertions are gone. Readiness is now computed on the discipline
 * basis (project_discipline_folders + discipline requirements).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const adminRoutes = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "document-management-admin.routes.ts"),
  "utf8",
);
const companyRootsRepo = fs.readFileSync(
  path.join(repoRoot, "server", "repositories", "company-sharepoint-roots-repository.ts"),
  "utf8",
);
const adminPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "admin-document-management.tsx"),
  "utf8",
);
const documentsSchema = fs.readFileSync(
  path.join(repoRoot, "shared", "schema", "documents.ts"),
  "utf8",
);
const disciplinePanel = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "DisciplinePanel.tsx"),
  "utf8",
);
const projectDocsPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "ProjectDocumentsView.tsx"),
  "utf8",
);
const readinessService = fs.readFileSync(
  path.join(repoRoot, "server", "services", "document-readiness-service.ts"),
  "utf8",
);
const cooHome = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "coo-home.tsx"),
  "utf8",
);
const adminHooks = fs.readFileSync(
  path.join(repoRoot, "client", "src", "hooks", "use-document-management-admin.ts"),
  "utf8",
);
const adminIntegrationsPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "admin-integrations.tsx"),
  "utf8",
);
const documentManagementSharepointPanelPath = path.join(
  repoRoot,
  "client",
  "src",
  "components",
  "admin",
  "document-management-sharepoint-panel.tsx",
);
const documentManagementSharepointPanel = fs.existsSync(documentManagementSharepointPanelPath)
  ? fs.readFileSync(documentManagementSharepointPanelPath, "utf8")
  : "";
const journal = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "migrations", "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ tag?: string }> };

describe("D6 Phase 3.1 — admin UI + webUrl", () => {
  it("admin routes expose GET + PUT for company SharePoint roots", () => {
    expect(adminRoutes).toMatch(/"\/api\/admin\/company-sharepoint-roots"/);
    expect(adminRoutes).toMatch(/"\/api\/admin\/company-sharepoint-roots\/:kind"/);
    expect(adminRoutes).toMatch(/"\/api\/admin\/company-sharepoint-roots\/:kind\/test"/);
  });

  it("admin page renders the Active Projects root configurator", () => {
    expect(adminPage).toContain(`data-testid="active-projects-root-card"`);
    expect(adminPage).toContain(`data-testid="active-projects-root-status"`);
    expect(adminPage).toContain(`data-testid="btn-edit-active-projects-root"`);
    expect(adminPage).toContain(`data-testid="input-active-projects-root-drive-id"`);
    expect(adminPage).toContain(`data-testid="btn-test-active-projects-root"`);
    expect(adminPage).toContain(`data-testid="active-projects-root-test-result"`);
    expect(adminPage).toContain(`data-testid="btn-save-active-projects-root"`);
  });

  it("admin hooks export company-roots query + upsert", () => {
    expect(adminHooks).toMatch(/export function useCompanySharepointRoots/);
    expect(adminHooks).toMatch(/export function useUpsertCompanyRoot/);
    expect(adminHooks).toMatch(/export function useTestCompanyRoot/);
  });

  it("company roots repository normalizes active flags for SQLite dev mode", () => {
    expect(companyRootsRepo).toMatch(/getDbMode/);
    expect(companyRootsRepo).toMatch(/sqliteBoolean/);
    expect(companyRootsRepo).not.toContain("eq(companySharepointRoots.active, true)");
  });

  it("project_discipline_folders schema declares a webUrl column with backing migration", () => {
    expect(documentsSchema).toMatch(/webUrl:\s*text\(["']web_url["']\)/);
    // 0044 (the original D6 surface) is still in the journal; the Phase 5 drop
    // ships as 0114.
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0044_document_management_v2");
    expect(tags.some((t) => t?.includes("phase5_drop_folder_taxonomy"))).toBe(true);
  });

  it("DisciplinePanel renders webUrl as a clickable deep link when present", () => {
    expect(disciplinePanel).toMatch(/folder\.webUrl/);
    expect(disciplinePanel).toMatch(/target="_blank"/);
    expect(disciplinePanel).toMatch(/discipline-link-/);
  });
});

describe("D6 Phase 3.2 — Integration Statuses document setup", () => {
  // Live-Ready scope (2026-06-18, owner): Integration Statuses surfaces only
  // QuickBooks, Microsoft 365 and Smart Import. The document-management
  // SharePoint setup panel was intentionally removed from this page (document
  // management is a disabled module in live-ready mode). The panel component
  // itself still exists and is covered by the tests below.
  it("Integration Statuses does NOT mount the document-management SharePoint setup panel (live-ready)", () => {
    expect(adminIntegrationsPage).not.toMatch(/DocumentManagementSharePointPanel/);
  });

  it("document setup panel exposes Engineering and Quality document status cards", () => {
    expect(documentManagementSharepointPanel).toContain(
      `data-testid="document-management-sharepoint-panel"`,
    );
    expect(documentManagementSharepointPanel).toContain(`integration-engineering-documents-card`);
    expect(documentManagementSharepointPanel).toContain(`integration-quality-documents-card`);
  });

  it("document setup panel lets admins maintain and test the shared Active Projects root", () => {
    expect(documentManagementSharepointPanel).toMatch(/useCompanySharepointRoots/);
    expect(documentManagementSharepointPanel).toMatch(/useUpsertCompanyRoot/);
    expect(documentManagementSharepointPanel).toMatch(/useTestCompanyRoot/);
    expect(documentManagementSharepointPanel).toContain(
      `data-testid="input-integration-active-projects-root-drive-id"`,
    );
    expect(documentManagementSharepointPanel).toContain(
      `data-testid="btn-integration-test-active-projects-root"`,
    );
    expect(documentManagementSharepointPanel).toContain(
      `data-testid="btn-integration-save-active-projects-root"`,
    );
    expect(documentManagementSharepointPanel).toContain(
      `data-testid="integration-active-projects-root-test-result"`,
    );
  });
});

describe("D6 Phase 4.1 — deep-linkable tabs + bound badge", () => {
  it("project-documents reads ?discipline=X from the URL and routes to that tab", () => {
    expect(projectDocsPage).toMatch(/URLSearchParams\(window\.location\.search\)/);
    expect(projectDocsPage).toMatch(/params\.get\("discipline"\)/);
  });

  it("tabs are driven by LIFECYCLE_DEPARTMENTS and surface a per-discipline bound badge", () => {
    expect(projectDocsPage).toMatch(/LIFECYCLE_DEPARTMENTS/);
    expect(projectDocsPage).toMatch(/data-testid={`tab-discipline-bound-\$\{d\}`}/);
  });
});

describe("D6 Phase 6.1 — discipline-basis readiness + tile mount", () => {
  it("readiness service is rebased onto the browse-and-bind discipline surface", () => {
    expect(readinessService).toMatch(/loadActiveDisciplineRequirements/);
    expect(readinessService).toMatch(/projectDisciplineFolders/);
    expect(readinessService).toMatch(/disciplineFolderId/);
  });

  it("readiness service no longer depends on the removed taxonomy surface", () => {
    expect(readinessService).not.toMatch(/folderTaxonomy/);
    expect(readinessService).not.toMatch(/filterRequirementsByStage/);
    expect(readinessService).not.toMatch(/SEQUENTIAL_STAGE_CODES/);
  });

  it("readiness service matches docs by fileNamePattern under the bound folder", () => {
    expect(readinessService).toMatch(/function docMatchesRequirement/);
    expect(readinessService).toMatch(/new RegExp\(req\.fileNamePattern/);
  });

  it("portfolio + project flows both load active discipline requirements", () => {
    const matches = readinessService.match(/loadActiveDisciplineRequirements\(/g);
    expect(matches).toBeTruthy();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("PortfolioReadinessTile is mounted on the COO home", () => {
    expect(cooHome).toMatch(/import \{ PortfolioReadinessTile \}/);
    expect(cooHome).toMatch(/<PortfolioReadinessTile\s*\/>/);
  });

  it("uses the canonical ManagedDocumentApprovalQueue on coo-home (legacy card retired)", () => {
    // Full removal: the legacy controlled-documents ApprovalQueueCard is
    // gone; coo-home now shows only the managed-document queue.
    expect(cooHome).toMatch(/ManagedDocumentApprovalQueue/);
    expect(cooHome).not.toContain("<ApprovalQueueCard");
  });
});

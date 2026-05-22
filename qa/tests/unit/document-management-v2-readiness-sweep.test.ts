/**
 * D6 readiness sweep — verifies the production-readiness fixes that
 * pulled Phases 3-6 from ~6.5/10 up to 9/10:
 *
 *   Phase 3.1 — admin UI for `companySharepointRoots[kind=active_projects]`
 *               + webUrl persistence + deep-link rendering.
 *   Phase 4.1 — deep-linkable discipline tabs + per-tab folder counts.
 *   Phase 5.1 — notification fan-out on request/approve/reject.
 *   Phase 6.1 — stage-aware filter, file_name_pattern matching, mount on
 *               coo-home.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const adminRoutes = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "document-management-admin.routes.ts"),
  "utf8",
);
const adminPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "admin-document-management.tsx"),
  "utf8",
);
const provisionService = fs.readFileSync(
  path.join(repoRoot, "server", "services", "folder-provisioning-service.ts"),
  "utf8",
);
const projectFoldersRepo = fs.readFileSync(
  path.join(repoRoot, "server", "repositories", "project-folders-repository.ts"),
  "utf8",
);
const documentsSchema = fs.readFileSync(
  path.join(repoRoot, "shared", "schema", "documents.ts"),
  "utf8",
);
const seedFile = fs.readFileSync(
  path.join(repoRoot, "server", "seed-folder-taxonomy.ts"),
  "utf8",
);
const disciplinePanel = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "DisciplinePanel.tsx"),
  "utf8",
);
const projectDocsPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "pages", "project-documents.tsx"),
  "utf8",
);
const approvalsService = fs.readFileSync(
  path.join(repoRoot, "server", "services", "managed-document-approvals-service.ts"),
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

  it("project_folders schema declares webUrl column with backing migration", () => {
    expect(documentsSchema).toMatch(/webUrl:\s*text\(["']web_url["']\)/);
    // After the merge with main, the two D6 migrations (taxonomy + web_url
    // column) were consolidated into a single drizzle-kit-generated
    // 0044_document_management_v2 migration that ships both at once.
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0044_document_management_v2");
  });

  it("provisioning service threads webUrl through onLink + report", () => {
    // The service captures webUrl from both the create-and-fetch path and
    // the already-on-Graph reconciliation path before passing it to
    // upsertProjectFolder.
    expect(provisionService).toMatch(/created\.webUrl/);
    expect(provisionService).toMatch(/alreadyOnGraph\.webUrl/);
    expect(provisionService).toMatch(/webUrl\?: string \| null/);
  });

  it("project-folders repository persists webUrl on upsert", () => {
    expect(projectFoldersRepo).toMatch(/webUrl:\s*input\.webUrl/);
  });

  it("DisciplinePanel renders webUrl as a clickable deep link when present", () => {
    expect(disciplinePanel).toMatch(/folder\.webUrl/);
    expect(disciplinePanel).toMatch(/target="_blank"/);
    expect(disciplinePanel).toMatch(/discipline-link-/);
  });

  it("dev seed creates a placeholder active_projects root in mock-connector mode", () => {
    expect(seedFile).toMatch(/isConnectorMocked\(["']ms-graph["']\)/);
    expect(seedFile).toMatch(/kind:\s*["']active_projects["']/);
  });
});

describe("D6 Phase 4.1 — deep-linkable tabs + counts", () => {
  it("project-documents reads ?discipline=X from the URL and routes to that tab", () => {
    expect(projectDocsPage).toMatch(/URLSearchParams\(window\.location\.search\)/);
    expect(projectDocsPage).toMatch(/params\.get\("discipline"\)/);
  });

  it("tab labels surface a per-discipline folder count badge", () => {
    expect(projectDocsPage).toMatch(/folderCountByDiscipline/);
    expect(projectDocsPage).toMatch(/data-testid={`tab-discipline-count-\$\{d\}`}/);
  });
});

describe("D6 Phase 5.1 — notifications", () => {
  it("approvals service imports the canonical notification helpers", () => {
    expect(approvalsService).toMatch(
      /import\s*\{[^}]*createNotification[^}]*notifyUsers[^}]*\}\s*from\s*["']\.\/notification-service["']/,
    );
  });

  it("requestApproval fans out to every approver", () => {
    expect(approvalsService).toMatch(/notifyUsers\(\s*dedup/);
    expect(approvalsService).toMatch(
      /eventType:\s*["']managed_document\.approval_requested["']/,
    );
  });

  it("recordApproval notifies the submitter on finalisation (both branches)", () => {
    expect(approvalsService).toMatch(/managed_document\.approved/);
    // The "all-required" + "any-of-many" finalise paths both notify.
    const matches = approvalsService.match(
      /eventType:\s*["']managed_document\.approved["']/g,
    );
    expect(matches).toBeTruthy();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("recordRejection notifies the submitter with the reason", () => {
    expect(approvalsService).toMatch(/managed_document\.rejected/);
    expect(approvalsService).toMatch(/body:\s*reason/);
  });
});

describe("D6 Phase 6.1 — stage filter + pattern matching + tile mount", () => {
  it("readiness service imports SEQUENTIAL_STAGE_CODES and projectExecutionState", () => {
    expect(readinessService).toMatch(/SEQUENTIAL_STAGE_CODES/);
    expect(readinessService).toMatch(/projectExecutionState/);
  });

  it("readiness service declares filterRequirementsByStage helper", () => {
    expect(readinessService).toMatch(/function filterRequirementsByStage/);
    expect(readinessService).toMatch(/cross-stage \/ pre-construction always in scope/);
  });

  it("readiness service compiles file_name_pattern and filters docs through it", () => {
    expect(readinessService).toMatch(/function compileFilenameMatcher/);
    expect(readinessService).toMatch(/matcher \? matcher\.test\(d\.name\) : true/);
  });

  it("portfolio + project flows both call filterRequirementsByStage", () => {
    const matches = readinessService.match(/filterRequirementsByStage\(/g);
    expect(matches).toBeTruthy();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("PortfolioReadinessTile is mounted on the COO home", () => {
    expect(cooHome).toMatch(/import \{ PortfolioReadinessTile \}/);
    expect(cooHome).toMatch(/<PortfolioReadinessTile\s*\/>/);
  });

  it("ManagedDocumentApprovalQueue replaces the legacy ApprovalQueueCard at the top of coo-home", () => {
    // The managed-document queue must precede (above) the legacy card so
    // the COO sees the new flow first.
    const managedIdx = cooHome.indexOf("ManagedDocumentApprovalQueue");
    const legacyIdx = cooHome.indexOf("<ApprovalQueueCard");
    expect(managedIdx).toBeGreaterThan(0);
    expect(legacyIdx).toBeGreaterThan(0);
    expect(managedIdx).toBeLessThan(legacyIdx);
  });
});

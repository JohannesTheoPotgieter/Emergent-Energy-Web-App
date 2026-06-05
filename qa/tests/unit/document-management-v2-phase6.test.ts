/**
 * D6 Phase 6 — readiness service + routes + UI shape.
 *
 * Validates:
 *   1. The readiness service exports computeProjectReadiness and
 *      computePortfolioReadiness, classifies requirements through the
 *      full status set, and walks all four data sources (taxonomy,
 *      project_folders, requirements, managed_documents).
 *   2. The percent helper weights folder + requirement halves equally.
 *   3. Routes are registered, gated on documents:view, and don't
 *      mutate (no audit logging required).
 *   4. ProjectReadinessCard + PortfolioReadinessTile mount, expose the
 *      right testids, and hit the correct endpoints via the readiness
 *      hooks.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const serviceFile = fs.readFileSync(
  path.join(repoRoot, "server", "services", "document-readiness-service.ts"),
  "utf8",
);
const routesFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "document-readiness.routes.ts"),
  "utf8",
);
const indexFile = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "index.ts"),
  "utf8",
);
const cardFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "ProjectReadinessCard.tsx"),
  "utf8",
);
const tileFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "PortfolioReadinessTile.tsx"),
  "utf8",
);
const hooksFile = fs.readFileSync(
  path.join(repoRoot, "client", "src", "hooks", "use-document-readiness.ts"),
  "utf8",
);
const projectDocsPage = fs.readFileSync(
  path.join(repoRoot, "client", "src", "components", "documents", "ProjectDocumentsView.tsx"),
  "utf8",
);

describe("D6 Phase 6 — readiness service shape", () => {
  it("exports computeProjectReadiness and computePortfolioReadiness", () => {
    expect(serviceFile).toMatch(/export async function computeProjectReadiness/);
    expect(serviceFile).toMatch(/export async function computePortfolioReadiness/);
  });

  it("classifies requirements through the full status set", () => {
    const expected = [
      `"approved"`,
      `"in_review"`,
      `"missing"`,
      `"folder_missing"`,
    ];
    for (const v of expected) {
      expect(serviceFile).toContain(v);
    }
  });

  it("touches all four data sources", () => {
    expect(serviceFile).toMatch(/folderTaxonomy/);
    expect(serviceFile).toMatch(/projectFolders/);
    expect(serviceFile).toMatch(/documentApprovalRequirements/);
    expect(serviceFile).toMatch(/managedDocuments/);
  });

  it("treats empty disciplines arrays as 'shared / all' (excluded from per-discipline rollup)", () => {
    expect(serviceFile).toMatch(/shared\/all|counted at the project level only|ds\.length === 0/);
  });

  it("equally weights folder + requirement halves in the percent helper", () => {
    expect(serviceFile).toMatch(/folderRatio \+ reqRatio\) \/ 2/);
    expect(serviceFile).toMatch(/foldersTotal === 0 \? 1 : s\.foldersProvisioned/);
    expect(serviceFile).toMatch(/requirementsTotal === 0 \? 1 : s\.requirementsApproved/);
  });

  it("portfolio function is batch-friendly (one inArray query per table, not N+1)", () => {
    expect(serviceFile).toMatch(/inArray/);
    expect(serviceFile).toMatch(/loadProjectFoldersForMany/);
    expect(serviceFile).toMatch(/loadProjectDocumentsForMany/);
  });

  it("portfolio rows are pre-sorted ascending by percentReady (worst-first)", () => {
    expect(serviceFile).toMatch(/sort\(\(a, b\) => a\.percentReady - b\.percentReady\)/);
  });
});

describe("D6 Phase 6 — routes wiring", () => {
  it("exports registerDocumentReadinessRoutes and registers it", () => {
    expect(routesFile).toMatch(/export function registerDocumentReadinessRoutes/);
    expect(indexFile).toMatch(/registerDocumentReadinessRoutes\(app\)/);
  });

  it("gates both reads on documents:view", () => {
    const matches = routesFile.match(
      /requirePermission\(["']documents["'],\s*["']view["']\)/g,
    );
    expect(matches).toBeTruthy();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("never mutates (no audit logging needed)", () => {
    expect(routesFile).not.toMatch(/logAuditFromReq/);
    expect(routesFile).not.toMatch(/app\.(post|patch|delete|put)/);
  });
});

describe("D6 Phase 6 — UI components", () => {
  it("ProjectReadinessCard mounts on /projects/:id/documents", () => {
    expect(projectDocsPage).toMatch(/<ProjectReadinessCard /);
  });

  it("ProjectReadinessCard exposes the documented testids", () => {
    const expected = [
      "project-readiness-card",
      "project-readiness-percent",
      "project-readiness-folder-count",
      "project-readiness-requirement-count",
      "btn-readiness-toggle",
      "readiness-checklist-table",
    ];
    for (const id of expected) {
      expect(cardFile).toContain(`data-testid="${id}"`);
    }
  });

  it("ProjectReadinessCard handles all four requirement statuses in the checklist", () => {
    expect(cardFile).toMatch(/Approved/);
    expect(cardFile).toMatch(/In review/);
    expect(cardFile).toMatch(/Folder missing/);
    expect(cardFile).toMatch(/Missing/);
  });

  it("PortfolioReadinessTile exposes its testids and links to project docs", () => {
    expect(tileFile).toContain(`data-testid="portfolio-readiness-tile"`);
    expect(tileFile).toContain(`data-testid="portfolio-readiness-list"`);
    expect(tileFile).toMatch(/href={`\/projects\/\$\{r\.projectId\}\/documents`}/);
  });

  it("PortfolioReadinessTile has a configurable row limit (default 5)", () => {
    expect(tileFile).toMatch(/limit\?: number/);
    expect(tileFile).toMatch(/limit\s*=\s*5/);
  });
});

describe("D6 Phase 6 — readiness hooks", () => {
  it("exports useProjectReadiness and usePortfolioReadiness", () => {
    expect(hooksFile).toMatch(/export function useProjectReadiness/);
    expect(hooksFile).toMatch(/export function usePortfolioReadiness/);
  });

  it("queries the right endpoints", () => {
    expect(hooksFile).toMatch(/`\/api\/projects\/\$\{projectId\}\/readiness`/);
    expect(hooksFile).toMatch(/"\/api\/portfolio\/document-readiness"/);
  });
});

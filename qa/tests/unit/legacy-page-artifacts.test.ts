import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_LEGACY_PAGE_DIR = "pages";

const ROOT_LEGACY_PAGE_FILES = [
  "training.tsx",
  "weekly-reviews.tsx",
  "tr-register.tsx",
  "triage-inbox.tsx",
  "unclassified-tasks.tsx",
];

const CLIENT_LEGACY_PAGES = [
  "client/src/pages/admin-ms-mapping.tsx",
  "client/src/pages/cashflow-forecast.tsx",
  "client/src/pages/collab-sharepoint.tsx",
  "client/src/pages/command-center.tsx",
  "client/src/pages/cos-control.tsx",
  "client/src/pages/engineering-inbox.tsx",
  "client/src/pages/engineering-sync.tsx",
  "client/src/pages/home.tsx",
  "client/src/pages/ms-integration-settings.tsx",
  "client/src/pages/project-normalized-view.tsx",
  "client/src/pages/revenue.tsx",
  "client/src/pages/sp-admin-settings.tsx",
  "client/src/pages/sp-import-runs.tsx",
  "client/src/pages/tr-register.tsx",
  "client/src/pages/triage-inbox.tsx",
  "client/src/pages/unclassified-tasks.tsx",
];

const SERVER_LEGACY_ROUTES = [
  "server/routes/health.ts",
];

describe("legacy page artifacts cleanup", () => {
  it("removes the duplicate top-level page tree", () => {
    expect(fs.existsSync(path.join(process.cwd(), ROOT_LEGACY_PAGE_DIR))).toBe(false);
  });

  it("removes duplicate root page entrypoints and orphaned legacy page modules", () => {
    const deletedPaths = [...ROOT_LEGACY_PAGE_FILES, ...CLIENT_LEGACY_PAGES, ...SERVER_LEGACY_ROUTES];

    for (const relPath of deletedPaths) {
      expect(fs.existsSync(path.join(process.cwd(), relPath)), relPath).toBe(false);
    }
  });
});

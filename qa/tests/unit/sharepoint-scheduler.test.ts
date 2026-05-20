/**
 * SharePoint Auto-Import scheduler — behavioural regression guards.
 *
 * Covers the invariants the audit (2026-05-20) flagged on the
 * /admin/integrations "SharePoint Auto-Import Schedule" panel:
 *
 *   D1 — server/sharepoint.ts gates Graph calls on isConnectorMocked.
 *   D3 — runFullImport refuses to run when settings.enabled === false
 *        unless { force: true } is passed.
 *   D5 — server/importPipeline.ts skip-gate keys off lastSuccessAt, not
 *        lastRunAt, so a misconfigured tenant retries on the next tick
 *        instead of waiting a full interval.
 *   D6 — AUTO_IMPORT_V2_ENABLED defaults ON (only "false" opts out).
 *   D8 — server/sharepoint.ts clears the cached connector token on 401
 *        so the next call fetches a fresh one.
 *
 * Pure source-grep style assertions where the alternative would need
 * heavy db / smart-import-pipeline mocking; runtime tests where the
 * call is local enough to mock cheaply.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

// ── Static source guards ──────────────────────────────────────

describe("SharePoint scheduler — static guards", () => {
  it("D1 — sharepoint.ts gates every Graph entry point on isConnectorMocked", () => {
    const src = read("server/sharepoint.ts");
    expect(src).toMatch(/import .*isConnectorMocked.*connector-mode/);
    for (const fn of [
      "testConnection",
      "listFolderChildren",
      "browseFolders",
      "downloadFileContent",
      "getFileMetadata",
      "detectChanges",
    ]) {
      const match = new RegExp(`export async function ${fn}\\b[\\s\\S]{0,1500}?isConnectorMocked\\("ms-graph"\\)`);
      expect(src, `${fn} must short-circuit on isConnectorMocked("ms-graph")`).toMatch(match);
    }
  });

  it("D6 — V2 is the default pipeline; only AUTO_IMPORT_V2_ENABLED=false opts out", () => {
    const src = read("server/importPipeline.ts");
    expect(
      src,
      "Scheduler tick must use `process.env.AUTO_IMPORT_V2_ENABLED !== \"false\"` so V2 is the default.",
    ).toMatch(/AUTO_IMPORT_V2_ENABLED\s*!==\s*"false"/);
    expect(src, "Old strict-true check should be gone.").not.toMatch(/AUTO_IMPORT_V2_ENABLED\s*===\s*"true"/);
  });

  it("D5 — scheduler skip-gate consults lastSuccessAt, not just lastRunAt", () => {
    const src = read("server/importPipeline.ts");
    expect(src).toMatch(/lastSuccessAt/);
    // The block must contain BOTH a 60 s floor on lastRunAt AND an
    // interval check against lastSuccessAt.
    expect(src).toMatch(/now\s*-\s*lastRun\s*<\s*60_000/);
    expect(src).toMatch(/now\s*-\s*lastSuccess\s*<\s*interval/);
  });

  it("D8 — graphApiError calls clearSharePointTokenCache on 401", () => {
    const src = read("server/sharepoint.ts");
    expect(src).toMatch(/status\s*===\s*401[\s\S]{0,400}clearSharePointTokenCache\(\)/);
  });

  it("scheduled-import-v2 persists tick outcome in a finally block", () => {
    const src = read("server/services/scheduled-import-v2.ts");
    expect(src).toMatch(/finally\s*{[\s\S]*upsertSpSettings/);
    expect(src).toMatch(/lastSuccessAt:\s*now/);
    expect(src).toMatch(/lastErrorAt:\s*now/);
    expect(src).toMatch(/lastErrorCode/);
    expect(src).toMatch(/lastErrorMessage/);
  });

  it("admin Run Now matches the scheduler's V2 selector and respects enabled", () => {
    const src = read("server/departments/admin-routes.ts");
    expect(src).toMatch(/AUTO_IMPORT_V2_ENABLED\s*!==\s*"false"/);
    expect(src).toMatch(/SP_IMPORT_DISABLED/);
  });

  it("sp_settings schema declares the new error columns", () => {
    const src = read("shared/schema/imports.ts");
    for (const col of ["lastSuccessAt", "lastErrorAt", "lastErrorCode", "lastErrorMessage"]) {
      expect(src, `sp_settings.${col} missing`).toMatch(new RegExp(col + ":\\s*"));
    }
  });

  it("migration journal records 0067_sp_settings_error_columns", () => {
    const journal = JSON.parse(read("migrations/meta/_journal.json")) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.some((e) => e.tag === "0067_sp_settings_error_columns")).toBe(true);
  });
});

// ── Runtime behaviour ─────────────────────────────────────────

describe("SharePoint scheduler — mock-mode runtime", () => {
  const originalUseMock = process.env.USE_MOCK_CONNECTORS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env.USE_MOCK_CONNECTORS = "true";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (originalUseMock === undefined) delete process.env.USE_MOCK_CONNECTORS;
    else process.env.USE_MOCK_CONNECTORS = originalUseMock;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("testConnection returns ok without hitting Graph in mock mode", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch should not be called in mock mode");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { testConnection } = await import("../../../server/sharepoint");
    const result = await testConnection("site", "drive", undefined, "Active Trackers/2026");

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.siteName).toMatch(/mock/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("listFolderChildren returns an empty list in mock mode (no Graph hit)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch should not be called in mock mode");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { listFolderChildren } = await import("../../../server/sharepoint");
    const children = await listFolderChildren("drive", undefined, "Active Trackers/2026");

    expect(children).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("detectChanges returns zero counts in mock mode (no Graph hit)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch should not be called in mock mode");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { detectChanges } = await import("../../../server/sharepoint");
    const result = await detectChanges("site", "drive", undefined, "Active Trackers/2026");

    expect(result).toEqual({ created: 0, modified: 0, deleted: 0, ledgerEntries: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("browseFolders returns mock folders in mock mode (no Graph hit)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch should not be called in mock mode");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { browseFolders } = await import("../../../server/sharepoint");
    const folders = await browseFolders("drive");

    expect(folders.length).toBeGreaterThan(0);
    expect(folders[0]).toMatchObject({ isFolder: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * Locks in the operator-facing folder-import error surface added in
 * response to "ensure clearing up any issues and errors on the folder
 * import path works well and is easy to understand".
 *
 * Background. The SharePoint scheduler runs every 30 minutes and walks the
 * configured folder, downloading each Excel file, parsing it through Smart
 * Import v2 preview, and parking the result as a `smart_import_runs` row
 * for the operator to review. Previously, when the download or preview
 * step failed (token expired, file corrupt, sheet missing), the failure
 * lived only in console logs — no `smart_import_runs` row was created, so
 * the Control Tower showed "12 succeeded" with no clue that 4 files
 * silently dropped on the floor.
 *
 * The fix:
 *   - server/services/scheduled-import-v2.ts:buildFailureMessage wraps
 *     every failure with the step name, a human-friendly message
 *     ("Could not download X from SharePoint: 403 Forbidden. Grant the
 *     integration user read access to the folder."), the raw error
 *     string for audit, and a timestamp.
 *   - recordFailedFileRun inserts a `failed` smart_import_runs row with
 *     that envelope stored on summaryJson.error so the Tower can list it.
 *   - The /api/import-control-tower/history endpoint reads summaryJson.error
 *     and surfaces errorMessage / errorStep / errorAt on every row.
 *   - The client Tower renders the error inline in the expanded row and
 *     as a tooltip on the failed status badge.
 *
 * These tests pin the envelope shape and the Tower wiring code-side so a
 * regression to "silent failures" is caught immediately.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Scheduled import — failure envelope persistence", () => {
  const schedulerSrc = read("server/services/scheduled-import-v2.ts");

  it("declares the operator-facing failure envelope shape", () => {
    expect(schedulerSrc).toContain("interface FileFailureEnvelope");
    expect(schedulerSrc).toContain('step: "download" | "preview" | "planner" | "auto_commit"');
    expect(schedulerSrc).toContain("message: string");
    expect(schedulerSrc).toContain("raw: string");
    expect(schedulerSrc).toContain("failedAt: string");
    expect(schedulerSrc).toContain("fileName: string");
  });

  it("buildFailureMessage adds operator-friendly suggestions for known error patterns", () => {
    expect(schedulerSrc).toContain("Re-authorise the SharePoint connection");
    expect(schedulerSrc).toContain("Grant the integration user read access");
    expect(schedulerSrc).toContain("file may have been moved or renamed");
    expect(schedulerSrc).toContain("scheduler will retry on the next tick");
    expect(schedulerSrc).toContain("Re-export the file from Excel");
    expect(schedulerSrc).toContain("Add the project to the app first");
  });

  it("recordFailedFileRun persists failures as a smart_import_runs row so the Tower can show them", () => {
    expect(schedulerSrc).toContain("async function recordFailedFileRun");
    expect(schedulerSrc).toContain('status: "failed"');
    expect(schedulerSrc).toContain("error: envelope,");
  });

  it("download failure path uses the envelope + persists a failed run", () => {
    expect(schedulerSrc).toMatch(
      /buildFailureMessage\("download",\s*fileName,\s*err\)/,
    );
    // After the download try/catch we must call recordFailedFileRun before
    // returning. The proximity check guards against a future refactor that
    // re-introduces the silent-drop behaviour.
    const downloadIdx = schedulerSrc.indexOf('buildFailureMessage("download"');
    const recordIdx = schedulerSrc.indexOf("recordFailedFileRun", downloadIdx);
    expect(downloadIdx).toBeGreaterThan(0);
    expect(recordIdx).toBeGreaterThan(downloadIdx);
    expect(recordIdx - downloadIdx).toBeLessThan(400); // both within the same catch block
  });

  it("preview failure path uses the envelope + persists a failed run", () => {
    expect(schedulerSrc).toContain('buildFailureMessage("preview"');
    const previewIdx = schedulerSrc.indexOf('buildFailureMessage("preview"');
    const recordIdx = schedulerSrc.indexOf("recordFailedFileRun", previewIdx);
    expect(previewIdx).toBeGreaterThan(0);
    expect(recordIdx).toBeGreaterThan(previewIdx);
    expect(recordIdx - previewIdx).toBeLessThan(400);
  });

  it("auto-commit failure folds the envelope into the existing run's summaryJson", () => {
    expect(schedulerSrc).toContain('buildFailureMessage("auto_commit"');
    expect(schedulerSrc).toContain("summaryJson: { ...summaryJson, error: envelope }");
  });
});

describe("Import Control Tower — error surface wiring", () => {
  const routeSrc = read("server/smart-import-routes.ts");
  const towerSrc = read("client/src/pages/import-control-tower.tsx");

  it("history endpoint exposes errorMessage / errorStep / errorAt on every run", () => {
    expect(routeSrc).toContain("errorMessage: errorEnvelope?.message ?? null");
    expect(routeSrc).toContain("errorStep: errorEnvelope?.step ?? null");
    expect(routeSrc).toContain("errorAt: errorEnvelope?.failedAt ?? null");
  });

  it("history endpoint reads the envelope from summaryJson.error", () => {
    expect(routeSrc).toContain("summary.error && typeof summary.error === \"object\"");
    expect(routeSrc).toContain("summary.error.message");
    expect(routeSrc).toContain("summary.error.step");
  });

  it("Tower row type includes the error fields", () => {
    expect(towerSrc).toContain("errorMessage: string | null");
    expect(towerSrc).toContain("errorStep:");
    expect(towerSrc).toContain("errorAt: string | null");
  });

  it("Tower renders the error inline in the expanded row", () => {
    expect(towerSrc).toContain("run.errorMessage &&");
    expect(towerSrc).toContain("Could not download from SharePoint");
    expect(towerSrc).toContain("Could not parse the workbook");
    expect(towerSrc).toContain("Could not plan the import");
    expect(towerSrc).toContain("Auto-commit failed");
  });

  it("Tower attaches the error message as a tooltip on the failed status badge", () => {
    expect(towerSrc).toContain("title={run.errorMessage}");
    expect(towerSrc).toContain('data-testid={`status-with-error-${run.id}`}');
  });
});

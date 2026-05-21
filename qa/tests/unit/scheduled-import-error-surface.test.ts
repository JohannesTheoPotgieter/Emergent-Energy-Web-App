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

describe("Shared failure envelope — applies to both folder + file imports", () => {
  const envelopeSrc = read("server/lib/import/failure-envelope.ts");
  const schedulerSrc = read("server/services/scheduled-import-v2.ts");
  const routeSrc = read("server/smart-import-routes.ts");

  it("declares the operator-facing envelope shape in a shared module", () => {
    expect(envelopeSrc).toContain("interface ImportFailureEnvelope");
    expect(envelopeSrc).toContain('"upload"');
    expect(envelopeSrc).toContain('"download"');
    expect(envelopeSrc).toContain('"preview"');
    expect(envelopeSrc).toContain('"planner"');
    expect(envelopeSrc).toContain('"auto_commit"');
    expect(envelopeSrc).toContain('"commit"');
    expect(envelopeSrc).toContain("message: string");
    expect(envelopeSrc).toContain("raw: string");
    expect(envelopeSrc).toContain("failedAt: string");
    expect(envelopeSrc).toContain("fileName: string");
  });

  it("buildImportFailureEnvelope adds operator-friendly suggestions for known error patterns", () => {
    expect(envelopeSrc).toContain("Re-authorise the SharePoint connection");
    expect(envelopeSrc).toContain("Grant the integration user read access");
    expect(envelopeSrc).toContain("file may have been moved or renamed");
    expect(envelopeSrc).toContain("scheduler will retry on the next tick");
    expect(envelopeSrc).toContain("Re-export the file from Excel");
    expect(envelopeSrc).toContain("Add the project to the app first");
    expect(envelopeSrc).toContain("Split the workbook"); // upload size-limit hint
    expect(envelopeSrc).toContain("rows you previously deleted"); // resurrection hint
  });

  it("persistFailedImportRun inserts a `failed` smart_import_runs row with the envelope", () => {
    expect(envelopeSrc).toContain("export async function persistFailedImportRun");
    expect(envelopeSrc).toContain('status: "failed"');
    expect(envelopeSrc).toContain("error: opts.envelope,");
  });

  it("scheduler uses the shared envelope on every failure path", () => {
    expect(schedulerSrc).toContain('from "../lib/import/failure-envelope"');
    expect(schedulerSrc).toContain('buildImportFailureEnvelope("download"');
    expect(schedulerSrc).toContain('buildImportFailureEnvelope("preview"');
    expect(schedulerSrc).toContain('buildImportFailureEnvelope("auto_commit"');
    expect(schedulerSrc).toContain("persistFailedImportRun({");
  });

  it("manual /upload route uses the same shared envelope", () => {
    expect(routeSrc).toContain('from "./lib/import/failure-envelope"');
    expect(routeSrc).toContain('buildImportFailureEnvelope("upload"');
    expect(routeSrc).toContain("persistFailedImportRun({");
    expect(routeSrc).toContain('manualUpload: { triggerType: "manual" }');
  });

  it("manual upload returns the failed run id so the client can deep-link to the Tower", () => {
    expect(routeSrc).toContain("failedRunId,");
  });
});

describe("Folder-batch grouping — one batchRunId per scheduler tick", () => {
  const schedulerSrc = read("server/services/scheduled-import-v2.ts");
  const routeSrc = read("server/smart-import-routes.ts");

  it("scheduler mints a batchRunId once per tick and threads it through every file", () => {
    expect(schedulerSrc).toContain("makeBatchRunId");
    expect(schedulerSrc).toContain("const batchRunId = makeBatchRunId()");
    expect(schedulerSrc).toContain("result.batchRunId = batchRunId");
  });

  it("processFileV2 takes the batchRunId and stamps it on every summaryJson", () => {
    expect(schedulerSrc).toContain("batchRunId: string,");
    expect(schedulerSrc).toContain("schedulerV2: { triggerType: \"schedule\", batchRunId }");
    expect(schedulerSrc).toContain("batchRunId,"); // also stamped on the success path
  });

  it("ScheduledImportV2Result surfaces the batch id so the caller can route to it", () => {
    expect(schedulerSrc).toContain("batchRunId: string | null;");
  });

  it("history endpoint extracts batchRunId + source from each run's summaryJson", () => {
    expect(routeSrc).toContain("summary.schedulerV2.batchRunId");
    expect(routeSrc).toContain('source: "scheduler" | "manual"');
    expect(routeSrc).toContain("batchRunId,");
  });

  it("history endpoint accepts ?batchRunId= to filter to a single folder pickup", () => {
    expect(routeSrc).toContain('req.query.batchRunId');
    expect(routeSrc).toContain("filtered.filter((r: any) => {");
    expect(routeSrc).toContain("sched.batchRunId === batchRunId");
  });
});

describe("Import Control Tower — error rendering + back-link wiring", () => {
  const towerSrc = read("client/src/pages/import-control-tower.tsx");

  it("row type includes error + batch + source fields", () => {
    expect(towerSrc).toContain("errorMessage: string | null");
    expect(towerSrc).toContain('errorStep: "upload"');
    expect(towerSrc).toContain("batchRunId: string | null");
    expect(towerSrc).toContain('source: "scheduler" | "manual"');
  });

  it("expanded row covers every error step label", () => {
    expect(towerSrc).toContain("Could not accept the upload");
    expect(towerSrc).toContain("Could not download from SharePoint");
    expect(towerSrc).toContain("Could not parse the workbook");
    expect(towerSrc).toContain("Could not plan the import");
    expect(towerSrc).toContain("Auto-commit failed");
    expect(towerSrc).toContain("Commit failed");
  });

  it("Tower reads ?batchRunId= from the URL and renders the batch-context banner", () => {
    expect(towerSrc).toContain('batchRunIdFromUrl');
    expect(towerSrc).toContain('data-testid="batch-context-banner"');
    expect(towerSrc).toContain("Folder Import Batch");
    expect(towerSrc).toContain('data-testid="button-clear-batch-filter"');
  });

  it("Tower exposes Source + Batch in the expanded row", () => {
    expect(towerSrc).toContain('data-testid={`text-source-${run.id}`}');
    expect(towerSrc).toContain("Folder pickup (scheduled)");
    expect(towerSrc).toContain("Manual upload");
    expect(towerSrc).toContain('data-testid={`link-back-to-batch-${run.id}`}');
  });

  it("Open-in-wizard button preserves the batch context via URL", () => {
    expect(towerSrc).toContain('data-testid={`button-open-wizard-${run.id}`}');
    expect(towerSrc).toContain("/admin/smart-import?");
    expect(towerSrc).toContain('qs.set("batchRunId", carryBatch)');
    expect(towerSrc).toContain('qs.set("runId", String(run.id))');
  });
});

describe("Smart Import wizard — back-to-batch link from a folder-sourced file", () => {
  const wizardSrc = read("client/src/pages/smart-import.tsx");

  it("wizard reads ?batchRunId= and renders the back-to-folder banner", () => {
    expect(wizardSrc).toContain('data-testid="batch-context-banner"');
    expect(wizardSrc).toContain("← Back to folder import results");
    expect(wizardSrc).toContain('/admin/import-control-tower?batchRunId=');
  });
});

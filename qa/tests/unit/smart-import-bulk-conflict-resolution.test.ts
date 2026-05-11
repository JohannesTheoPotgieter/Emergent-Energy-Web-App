/**
 * Smart Import — bulk conflict-resolution wiring (Option 1) source-text
 * regression guards.
 *
 * Pins the outcome of wiring the existing v2 conflict drawer into the
 * bulk-commit panel, so a `v2_conflicts_detected` 409 from one file in a
 * bulk run no longer dead-ends at "Try again":
 *
 *   1. BulkConflictDialog component exists and is barrel-exported.
 *   2. BulkCommitResult.status now includes "conflicts_pending" and
 *      carries an optional `conflicts: V2ConflictRow[]` payload.
 *   3. handleBulkCommit translates the 409 envelope into a
 *      conflicts_pending result instead of a generic failure.
 *   4. SmartImportBulkResultNext renders a "Resolve conflicts" button
 *      for conflicts_pending rows and forwards onResolveConflicts.
 *   5. The bulk panel mounts BulkConflictDialog when a row is selected.
 *   6. The retry path re-submits with v2ConflictResolutions.
 *   7. The bulk default no longer hard-codes preserveManualEdits=true
 *      (which previously suppressed the conflict envelope and silently
 *      kept every app value).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

describe("Bulk conflict resolution — components & exports", () => {
  it("ships the BulkConflictDialog component", () => {
    const src = read("client/src/components/smart-import/BulkConflictDialog.tsx");
    expect(src).toMatch(/export function BulkConflictDialog/);
    expect(src).toMatch(/export interface V2ConflictRow/);
    expect(src).toMatch(/export interface V2ConflictField/);
  });

  it("barrel re-exports the dialog and its types", () => {
    const barrel = read("client/src/components/smart-import/index.ts");
    expect(barrel).toMatch(/BulkConflictDialog/);
    expect(barrel).toMatch(/type V2ConflictRow/);
    expect(barrel).toMatch(/type V2ConflictField/);
  });

  it("dialog footer wires Cancel + Resolve & Commit + onResolve callback", () => {
    const src = read("client/src/components/smart-import/BulkConflictDialog.tsx");
    expect(src).toMatch(/data-testid="btn-bulk-v2-cancel"/);
    expect(src).toMatch(/data-testid="btn-bulk-v2-resolve-commit"/);
    expect(src).toMatch(/onResolve\(decisions\)/);
  });

  it("dialog exposes per-row keep / accept buttons and apply-to-all", () => {
    const src = read("client/src/components/smart-import/BulkConflictDialog.tsx");
    expect(src).toMatch(/btn-bulk-v2-keep-/);
    expect(src).toMatch(/btn-bulk-v2-accept-/);
    expect(src).toMatch(/btn-bulk-v2-keep-all/);
    expect(src).toMatch(/btn-bulk-v2-accept-all/);
  });
});

describe("Bulk conflict resolution — BulkCommitResult & handleBulkCommit", () => {
  const page = read("client/src/pages/smart-import.tsx");

  it("BulkCommitResult.status includes conflicts_pending and carries conflicts payload", () => {
    expect(page).toMatch(/status:\s*"committed"\s*\|\s*"skipped"\s*\|\s*"failed"\s*\|\s*"conflicts_pending"/);
    expect(page).toMatch(/conflicts\?:\s*V2ConflictRow\[\]/);
  });

  it("handleBulkCommit catches v2_conflicts_detected and stores conflicts_pending", () => {
    expect(page).toMatch(/err\?\.error === "v2_conflicts_detected"/);
    expect(page).toMatch(/status:\s*"conflicts_pending"\s+as const/);
  });

  it("bulk default no longer passes preserveManualEdits in the commit body", () => {
    // Find every JSON.stringify({...}) inside handleBulkCommit and assert
    // none of them sets preserveManualEdits. Comments that describe why
    // we removed it are intentionally allowed elsewhere.
    const handler = page.match(/const handleBulkCommit[\s\S]+?\n  \};\n/);
    expect(handler).not.toBeNull();
    const bodyLiterals = handler![0].match(/JSON\.stringify\(\{[^}]*\}\)/g) ?? [];
    expect(bodyLiterals.length).toBeGreaterThan(0);
    for (const lit of bodyLiterals) {
      expect(lit).not.toMatch(/preserveManualEdits/);
    }
  });

  it("re-commit handler sends v2ConflictResolutions in the body", () => {
    expect(page).toMatch(/handleResolveAndRecommit/);
    expect(page).toMatch(/v2ConflictResolutions:\s*decisions/);
  });

  it("re-commit handler updates the result row in place on success", () => {
    expect(page).toMatch(/setCommitResults\(\(prev\) =>/);
    expect(page).toMatch(/status:\s*"committed"\s+as const/);
  });
});

describe("Bulk conflict resolution — result panel UI wiring", () => {
  const flow = read("client/src/components/smart-import/SmartImportBulkFlow.tsx");
  const page = read("client/src/pages/smart-import.tsx");

  it("BulkResultProject.status includes conflicts_pending + conflictCount", () => {
    expect(flow).toMatch(/"committed"\s*\|\s*"skipped"\s*\|\s*"failed"\s*\|\s*"conflicts_pending"/);
    expect(flow).toMatch(/conflictCount\?:\s*number/);
  });

  it("SmartImportBulkResultNext renders btn-resolve-conflicts-* per conflicted row", () => {
    expect(flow).toMatch(/btn-resolve-conflicts-/);
    expect(flow).toMatch(/onResolveConflicts/);
  });

  it("bulk panel passes onResolveConflicts and mounts BulkConflictDialog", () => {
    expect(page).toMatch(/onResolveConflicts={handleOpenConflictResolver}/);
    expect(page).toMatch(/<BulkConflictDialog/);
  });

  it("bulk panel exposes a 'Need conflict review' badge in the summary", () => {
    expect(page).toMatch(/badge-conflicts-count/);
    expect(page).toMatch(/Need conflict review/);
  });
});

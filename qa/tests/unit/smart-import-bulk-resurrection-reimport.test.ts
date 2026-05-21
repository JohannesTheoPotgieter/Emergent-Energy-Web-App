/**
 * Smart Import bulk resurrection recovery regression guards.
 *
 * A folder import can return `resurrection_decision_required` for many
 * files when uploaded trackers contain rows the operator previously
 * deleted in the app. The single-file wizard can resolve this, but the
 * bulk result screen must not force operators to open each file one by
 * one. It should capture the resurrection payload and offer one-click
 * restore/reimport actions per file and for all affected files.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

describe("Smart Import bulk resurrection recovery", () => {
  const page = read("client/src/pages/smart-import.tsx");
  const flow = read("client/src/components/smart-import/SmartImportBulkFlow.tsx");

  it("models resurrection_pending rows with their server payload", () => {
    expect(page).toMatch(/"resurrection_pending"/);
    expect(page).toMatch(/interface BulkResurrectionCandidate/);
    expect(page).toMatch(/resurrections\?:\s*BulkResurrectionCandidate\[\]/);
  });

  it("handleBulkCommit captures resurrection_decision_required instead of a generic failure", () => {
    expect(page).toMatch(/err\?\.error === "resurrection_decision_required"/);
    expect(page).toMatch(/status:\s*"resurrection_pending"\s+as const/);
    expect(page).toMatch(/resurrections:\s*err\.resurrections as BulkResurrectionCandidate\[\]/);
  });

  it("recommit handler sends restore_and_apply decisions for each resurrection key", () => {
    expect(page).toMatch(/buildRestoreResurrectionDecisions/);
    expect(page).toMatch(/"restore_and_apply"/);
    expect(page).toMatch(/resurrectionDecisions:\s*decisions/);
    expect(page).toMatch(/handleRestoreAndReimportAllResurrections/);
  });

  it("result component renders per-file and all-files restore/reimport controls", () => {
    expect(flow).toMatch(/resurrection_pending/);
    expect(flow).toMatch(/resurrectionCount\?:\s*number/);
    expect(flow).toMatch(/onRestoreAndReimport/);
    expect(flow).toMatch(/onRestoreAndReimportAll/);
    expect(flow).toMatch(/btn-restore-reimport-/);
    expect(flow).toMatch(/btn-restore-reimport-all/);
  });
});

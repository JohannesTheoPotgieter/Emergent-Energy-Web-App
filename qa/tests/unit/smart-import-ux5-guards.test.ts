/**
 * Smart Import bulk-journey UX regression guards (UX-5).
 *
 * Pins the outcome of the UX-5 rework around the BulkCommitPanel:
 *
 *   1. labels.ts exposes BULK_LABELS with intro narrative slots and a
 *      full result-screen block (title variants, per-file heading,
 *      what-happens-next items, undo hint, action labels).
 *
 *   2. A dedicated SmartImportBulkFlow module exists and exports two
 *      components: SmartImportBulkIntro + SmartImportBulkResultNext.
 *
 *   3. The smart-import barrel re-exports both components and the
 *      BulkResultProject type.
 *
 *   4. smart-import.tsx mounts SmartImportBulkIntro above the
 *      pending-runs list and replaces the old "Results by Project"
 *      card with SmartImportBulkResultNext on the commit-done screen.
 *
 *   5. Title text is label-driven: no "Bulk Import Complete" hard-
 *      coded string left behind.
 *
 * Source-text assertions are deliberate: validating the full runtime
 * render requires wouter + query-client + a pending-runs fetch mock,
 * overkill for this copy-plus-component refactor.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("UX-5 — BULK_LABELS copy slots", () => {
  const labels = read("client/src/components/smart-import/labels.ts");

  it("exports BULK_LABELS with intro + result blocks", () => {
    expect(labels).toMatch(/export const BULK_LABELS\s*=/);
    expect(labels).toMatch(/intro:\s*\{/);
    expect(labels).toMatch(/result:\s*\{/);
  });

  it("intro carries titleSingular, titlePlural, and three status prefixes", () => {
    const block = labels.match(/intro:\s*\{([\s\S]*?)\},/)?.[0] ?? "";
    expect(block).toMatch(/titleSingular:\s*"/);
    expect(block).toMatch(/titlePlural:.*%n/);
    expect(block).toMatch(/readyPrefix:.*%n/);
    expect(block).toMatch(/blockedPrefix:.*%n/);
    expect(block).toMatch(/stuckPrefix:.*%n/);
  });

  it("result carries three title variants and the what-next list", () => {
    expect(labels).toMatch(/titleCommittedOnly:\s*"/);
    expect(labels).toMatch(/titleMixed:\s*"/);
    expect(labels).toMatch(/titleFailedOnly:\s*"/);
    expect(labels).toMatch(/whatNextHeading:\s*"/);
    expect(labels).toMatch(/whatNextItems:\s*\[/);
  });

  it("result carries the undo-hint reversibility string", () => {
    expect(labels).toMatch(/undoHint:\s*"[^"]*reversible[^"]*"/);
  });
});

describe("UX-5 — SmartImportBulkFlow components", () => {
  const src = read("client/src/components/smart-import/SmartImportBulkFlow.tsx");

  it("exports SmartImportBulkIntro and SmartImportBulkResultNext", () => {
    expect(src).toMatch(/export function SmartImportBulkIntro/);
    expect(src).toMatch(/export function SmartImportBulkResultNext/);
  });

  it("intro component short-circuits when totalCount is 0", () => {
    expect(src).toMatch(/if \(totalCount <= 0\) return null/);
  });

  it("intro component renders the three status lines with testids", () => {
    expect(src).toMatch(/"bulk-intro-ready"/);
    expect(src).toMatch(/"bulk-intro-attention"/);
    expect(src).toMatch(/"bulk-intro-blocked"/);
  });

  it("result component renders the what-happens-next block from BULK_LABELS", () => {
    expect(src).toMatch(/BULK_LABELS\.result\.whatNextItems\.map/);
    expect(src).toMatch(/"bulk-whats-next"/);
  });

  it("result component wires onViewProject per committed row and onRetry per failed row", () => {
    expect(src).toMatch(/onViewProject\?\s*:\s*\(projectName:\s*string\)\s*=>\s*void/);
    expect(src).toMatch(/onRetry\?\s*:\s*\(projectName:\s*string\)\s*=>\s*void/);
    expect(src).toMatch(/`btn-view-project-\$\{idx\}`/);
    expect(src).toMatch(/`btn-retry-project-\$\{idx\}`/);
  });

  it("result component surfaces the undo-hint with the reversibility string", () => {
    expect(src).toMatch(/"bulk-undo-hint"/);
    expect(src).toMatch(/BULK_LABELS\.result\.undoHint/);
  });
});

describe("UX-5 — barrel exports + page wiring", () => {
  const barrel = read("client/src/components/smart-import/index.ts");
  const page = read("client/src/pages/smart-import.tsx");

  it("barrel re-exports the bulk components + BulkResultProject type", () => {
    expect(barrel).toMatch(/SmartImportBulkIntro,\s*SmartImportBulkResultNext,\s*type BulkResultProject/);
  });

  it("smart-import.tsx imports SmartImportBulkIntro + SmartImportBulkResultNext + BULK_LABELS", () => {
    expect(page).toMatch(/SmartImportBulkIntro/);
    expect(page).toMatch(/SmartImportBulkResultNext/);
    expect(page).toMatch(/BULK_LABELS/);
  });

  it("BulkCommitPanel mounts SmartImportBulkIntro above the Pending Imports card", () => {
    expect(page).toMatch(
      /<SmartImportBulkIntro[\s\S]*?totalCount=\{pendingRuns\.length\}[\s\S]*?readyCount=\{readyCount\}[\s\S]*?\/>/,
    );
  });

  it("BulkCommitPanel replaces 'Results by Project' with SmartImportBulkResultNext", () => {
    // Old card title should be gone
    expect(page).not.toMatch(/Results by Project/);
    // New component is mounted
    expect(page).toMatch(
      /<SmartImportBulkResultNext[\s\S]*?projects=\{commitResults\.map/,
    );
  });

  it("the old hard-coded 'Bulk Import Complete' title is gone", () => {
    expect(page).not.toMatch(/"Bulk Import Complete"/);
    // and the label-driven variant is used
    expect(page).toMatch(/BULK_LABELS\.result\.titleCommittedOnly/);
    expect(page).toMatch(/BULK_LABELS\.result\.titleMixed/);
  });

  it("the Import More button uses BULK_LABELS.result.uploadMoreAction", () => {
    expect(page).toMatch(/\{BULK_LABELS\.result\.uploadMoreAction\}/);
  });
});

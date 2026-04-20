/**
 * Smart Import upload-step UX regression guards (UX-1)
 *
 * Pins the outcome of the UX-1 rework on the upload step:
 *
 *   1. A dedicated path-chooser component (SmartImportPathChooser)
 *      exists and is exported from the smart-import barrel.
 *
 *   2. The upload step's Card title uses the plain-English page title
 *      (UPLOAD_LABELS.pageTitle) instead of "Upload Excel Trackers".
 *
 *   3. The empty-state dropzone is gated by the picked mode — only the
 *      relevant "Browse files" / "Browse folder" button is shown, not
 *      both at once.
 *
 *   4. The labels file carries the UPLOAD_LABELS constant with every
 *      copy slot the UI needs — single/folder descriptions, dropzone
 *      hints, safety badge wording, and the "how it works" steps.
 *
 * Source-text assertions are deliberate: a runtime test would need
 * the whole SPA + wouter + query-client mounted, which is overkill
 * for a copy-plus-component refactor.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("UX-1 — upload-step copy + path chooser", () => {
  const labels = read("client/src/components/smart-import/labels.ts");
  const chooser = read("client/src/components/smart-import/SmartImportPathChooser.tsx");
  const barrel = read("client/src/components/smart-import/index.ts");
  const page = read("client/src/pages/smart-import.tsx");

  it("labels.ts exposes UPLOAD_LABELS with the pageTitle copy", () => {
    expect(labels).toMatch(/export const UPLOAD_LABELS\s*=/);
    expect(labels).toMatch(/pageTitle:\s*"Import a project plan"/);
  });

  it("labels.ts carries both single and folder mode descriptions", () => {
    expect(labels).toMatch(/singleMode:\s*\{[\s\S]*?title:\s*"Import one file"/);
    expect(labels).toMatch(/folderMode:\s*\{[\s\S]*?title:\s*"Import a folder of files"/);
    // Non-technical phrasing — no "bulk" jargon in default folder copy:
    const folderBlock = labels.match(/folderMode:\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(folderBlock).toMatch(/several spreadsheets|many projects/i);
  });

  it("labels.ts carries a 4-step 'how it works' for each mode", () => {
    const singleBlock = labels.match(/single:\s*\[([\s\S]*?)\]/)?.[0] ?? "";
    const folderBlock = labels.match(/folder:\s*\[([\s\S]*?)\]/)?.[0] ?? "";
    expect(singleBlock.match(/"/g)?.length).toBeGreaterThanOrEqual(8); // 4 strings × 2 quotes
    expect(folderBlock.match(/"/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("labels.ts carries a reversibility / safety string", () => {
    expect(labels).toMatch(/safety:\s*"[^"]*Commit[^"]*"/);
    expect(labels).toMatch(/Nothing is saved until/i);
  });

  it("SmartImportPathChooser is a real React component with the two path cards", () => {
    expect(chooser).toMatch(/export function SmartImportPathChooser/);
    // path-card-single / -folder are passed through the PathCard `testId`
    // prop which renders as data-testid at runtime.
    expect(chooser).toMatch(/"path-card-single"/);
    expect(chooser).toMatch(/"path-card-folder"/);
    expect(chooser).toMatch(/data-testid="safety-badge"/);
    expect(chooser).toMatch(/data-testid="how-it-works"/);
  });

  it("SmartImportPathChooser reads copy from labels — no hard-coded strings for the 4 main slots", () => {
    expect(chooser).toMatch(/UPLOAD_LABELS\.singleMode\.title/);
    expect(chooser).toMatch(/UPLOAD_LABELS\.folderMode\.title/);
    expect(chooser).toMatch(/UPLOAD_LABELS\.safety/);
    expect(chooser).toMatch(/UPLOAD_LABELS\.howItWorks/);
  });

  it("the smart-import barrel re-exports SmartImportPathChooser and UploadMode", () => {
    expect(barrel).toMatch(
      /export \{\s*SmartImportPathChooser,\s*type UploadMode\s*\}\s*from\s*"\.\/SmartImportPathChooser"/,
    );
  });

  it("smart-import.tsx imports the chooser from the barrel", () => {
    expect(page).toMatch(/SmartImportPathChooser,\s*UPLOAD_LABELS/);
  });

  it("UploadStep uses UPLOAD_LABELS.pageTitle instead of the old 'Upload Excel Trackers' text", () => {
    // Old title should be gone
    expect(page).not.toMatch(/Upload Excel Trackers/);
    // New title reference present
    expect(page).toMatch(/UPLOAD_LABELS\.pageTitle/);
  });

  it("UploadStep mounts SmartImportPathChooser only while files.length === 0", () => {
    expect(page).toMatch(
      /files\.length === 0 && \(\s*<SmartImportPathChooser/,
    );
  });

  it("UploadStep's dropzone shows only one browse button based on uploadMode", () => {
    // Single-mode branch renders btn-browse-files
    expect(page).toMatch(
      /uploadMode === "single" \? \([\s\S]*?data-testid="btn-browse-files"[\s\S]*?\) : \([\s\S]*?data-testid="btn-browse-folder"/,
    );
  });

  it("UploadStep surfaces the browser-compatibility note only in folder mode", () => {
    expect(page).toMatch(
      /uploadMode === "folder" && \(\s*<p[^>]*data-testid="folder-browser-note"/,
    );
  });
});

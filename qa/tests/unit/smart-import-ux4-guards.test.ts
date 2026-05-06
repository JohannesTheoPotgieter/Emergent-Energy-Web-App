/**
 * Smart Import UX-4 regression guards
 *
 * Pins the two new components:
 *   - SmartImportCreateProjectDialog (inline POST /api/projects form)
 *   - SmartImportFolderInventory (folder file-list with 4 blocker codes)
 * plus barrel re-export.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("UX-4 — inline project creation dialog", () => {
  const src = read("client/src/components/smart-import/SmartImportCreateProjectDialog.tsx");

  it("exports the component and the CreatedProject type", () => {
    expect(src).toMatch(/export function SmartImportCreateProjectDialog/);
    expect(src).toMatch(/export interface CreatedProject/);
  });

  it("requires name, projectCode and clientName before submit", () => {
    expect(src).toMatch(/name\.trim\(\)\.length > 0 &&[\s\S]*?projectCode\.trim\(\)\.length > 0 &&[\s\S]*?clientName\.trim\(\)\.length > 0/);
  });

  it("POSTs to /api/projects with auth headers and credentials", () => {
    expect(src).toMatch(/"\/api\/projects"/);
    expect(src).toMatch(/method:\s*"POST"/);
    expect(src).toMatch(/getAuthHeaders\(\)/);
    expect(src).toMatch(/credentials:\s*"include"/);
  });

  it("carries the four form data-testid anchors + submit/cancel/error", () => {
    expect(src).toMatch(/"create-project-name"/);
    expect(src).toMatch(/"create-project-code"/);
    expect(src).toMatch(/"create-project-client"/);
    expect(src).toMatch(/"create-project-submit"/);
    expect(src).toMatch(/"create-project-cancel"/);
    expect(src).toMatch(/"create-project-error"/);
  });

  it("calls onCreated with the new project after a successful POST", () => {
    expect(src).toMatch(/onCreated\(created\)/);
  });
});

describe("UX-4 — folder inventory card", () => {
  const src = read("client/src/components/smart-import/SmartImportFolderInventory.tsx");

  it("exports the component + types", () => {
    expect(src).toMatch(/export function SmartImportFolderInventory/);
    expect(src).toMatch(/export interface FolderFileEntry/);
    expect(src).toMatch(/export type FolderFileBlocker/);
  });

  it("declares all four blocker codes from the product spec", () => {
    expect(src).toMatch(/"PARSE_FAILED"/);
    expect(src).toMatch(/"PERMISSION_DENIED"/);
    expect(src).toMatch(/"STAGE_CLOSED"/);
    expect(src).toMatch(/"DUPLICATE_FILENAME"/);
  });

  it("carries plain-English copy for each blocker code", () => {
    expect(src).toMatch(/PARSE_FAILED:[\s\S]*?title:\s*"We couldn't read this file"/);
    expect(src).toMatch(/PERMISSION_DENIED:[\s\S]*?title:\s*"You don't have access to this project"/);
    expect(src).toMatch(/STAGE_CLOSED:[\s\S]*?title:\s*"This project's stage is closed"/);
    expect(src).toMatch(/DUPLICATE_FILENAME:[\s\S]*?title:\s*"Duplicate filename in this folder"/);
  });

  it("shows auto-match + confidence when matched, pick/create when not", () => {
    expect(src).toMatch(/Matched to/);
    expect(src).toMatch(/No match/);
    // testIds are template literals of the form folder-inventory-<slot>-${f.id}
    expect(src).toMatch(/folder-inventory-match-/);
    expect(src).toMatch(/folder-inventory-nomatch-/);
    expect(src).toMatch(/folder-inventory-create-/);
    expect(src).toMatch(/folder-inventory-pick-/);
  });

  it("disables the checkbox for blocked files", () => {
    expect(src).toMatch(/disabled=\{!!blocker\}/);
  });

  it("renders the empty-state when no files provided", () => {
    expect(src).toMatch(/files\.length === 0/);
    expect(src).toMatch(/No files to show yet/);
  });

  it("surfaces summary tally above the list", () => {
    expect(src).toMatch(/selectedCount/);
    expect(src).toMatch(/blockedCount/);
    expect(src).toMatch(/ready to import/);
  });
});

describe("UX-4 — barrel exports", () => {
  const barrel = read("client/src/components/smart-import/index.ts");

  it("re-exports SmartImportCreateProjectDialog + CreatedProject", () => {
    expect(barrel).toMatch(
      /export \{\s*SmartImportCreateProjectDialog,\s*type CreatedProject\s*\}\s*from\s*"\.\/SmartImportCreateProjectDialog"/,
    );
  });

  it("re-exports SmartImportFolderInventory + both types", () => {
    expect(barrel).toMatch(/SmartImportFolderInventory/);
    expect(barrel).toMatch(/type FolderFileEntry/);
    expect(barrel).toMatch(/type FolderFileBlocker/);
  });
});

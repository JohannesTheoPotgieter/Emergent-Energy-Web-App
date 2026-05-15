/**
 * Smart Import v2 — task-import idempotency regression
 *
 * The audit at docs/smart-import-v2-task-dedup-audit.md verifies that
 * re-importing the same workbook produces zero `work_items` duplicates. The
 * guarantee rests on three invariants in
 * server/lib/import/commit-executor.ts:writePlanIncremental and the
 * underlying hash recipe in server/lib/import/row-hasher.ts:
 *
 *   1. `hashPlanRow` is deterministic and includes `projectId`, so the same
 *      logical row produces the same hash on every re-import and cannot
 *      collide across projects.
 *   2. The commit executor (a) computes that hash for each incoming row,
 *      (b) looks the row up by `(projectId, rowHash)` via
 *      `lookupActiveByHash`, (c) skips UNCHANGED rows entirely, and
 *      (d) soft-deletes rows whose hash is no longer in the workbook
 *      via the end-of-pass `seenRowHashes` sweep.
 *   3. The `/api/upload` and `/api/reprocess-all` legacy paths that used
 *      to bypass these guards now return 410 Gone, and the shadowed
 *      `db.insert(workItems)` blocks in
 *      server/routes/imports-admin-extracted-routes.ts were removed.
 *
 * If any of these invariants is regressed, a future re-import could
 * silently produce new + soft-deleted pairs (best case) or duplicates
 * (worst case). This test pins each invariant down at the source level.
 * A future PR can replace it with a full Postgres roundtrip once we have
 * a stable test-DB harness — see
 * docs/smart-import-v2-known-limitations.md §12b.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { hashPlanRow } from "../../../server/lib/import/row-hasher";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

/**
 * Strip JS / TS comments before content-based assertions. Several deletion
 * comments in this PR mention the removed legacy symbols by name; we don't
 * want those comments to trip the "no longer calls X" tests.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// ---------------------------------------------------------------------------
// 1. `hashPlanRow` is deterministic and project-scoped
// ---------------------------------------------------------------------------

describe("PLAN row hash identity", () => {
  it("produces the same hash for the same inputs", () => {
    const a = hashPlanRow({ projectId: 42, wbsCode: "1.2.3", title: "Install panels" });
    const b = hashPlanRow({ projectId: 42, wbsCode: "1.2.3", title: "Install panels" });
    expect(a).toBe(b);
  });

  it("includes projectId in the identity (no cross-project collisions)", () => {
    const a = hashPlanRow({ projectId: 1, wbsCode: "1.2.3", title: "Install panels" });
    const b = hashPlanRow({ projectId: 2, wbsCode: "1.2.3", title: "Install panels" });
    expect(a).not.toBe(b);
  });

  it("ignores title when wbsCode is present (rename-tolerant)", () => {
    // The WBS-stable identity rule: clarifying a task's name in the
    // workbook must NOT flip the hash for a row that has a stable WBS.
    const a = hashPlanRow({ projectId: 7, wbsCode: "2.1", title: "Site prep" });
    const b = hashPlanRow({ projectId: 7, wbsCode: "2.1", title: "Site preparation" });
    expect(a).toBe(b);
  });

  it("flips the hash when wbsCode is absent and title changes", () => {
    // The fallback identity. This is the title-rename edge case Fix 2
    // warns about: a row without a stable taskNo will produce a new+missing
    // pair if renamed in a future import.
    const a = hashPlanRow({ projectId: 7, wbsCode: null, title: "Site prep" });
    const b = hashPlanRow({ projectId: 7, wbsCode: null, title: "Site preparation" });
    expect(a).not.toBe(b);
  });

  it("normalises whitespace and case so trivial workbook edits do not flip the hash", () => {
    const a = hashPlanRow({ projectId: 7, wbsCode: "  2.1 ", title: "Site Prep" });
    const b = hashPlanRow({ projectId: 7, wbsCode: "2.1", title: "site prep" });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 2. `writePlanIncremental` keeps its dedup guards
// ---------------------------------------------------------------------------

describe("writePlanIncremental dedup guards", () => {
  const exec = read("server/lib/import/commit-executor.ts");

  it("computes hashPlanRow per row before deciding what to write", () => {
    expect(exec).toMatch(/hashPlanRow\s*\(\s*\{\s*projectId/);
  });

  it("looks the existing row up by hash via lookupActiveByHash", () => {
    expect(exec).toContain("lookupActiveByHash(rowHash)");
  });

  it("skips UNCHANGED rows without writing", () => {
    expect(exec).toMatch(/mr\.classification\s*===\s*"UNCHANGED"[\s\S]{0,200}counts\.unchanged\+\+/);
  });

  it("emits a warning when the same hash appears twice in a single import", () => {
    expect(exec).toContain('reason: "duplicate_row_hash"');
  });

  it("emits a warning for LOW-confidence NEW PLAN rows (Fix 2)", () => {
    expect(exec).toContain('reason: "plan_row_no_stable_id"');
  });

  it("soft-deletes rows whose hash is missing from the workbook (orphan sweep)", () => {
    // The cleanup loop iterates active SMART_IMPORT rows for the project,
    // collects those whose `rowHash` is not in `seenRowHashes`, and
    // soft-deletes them by setting `deletedAt`.
    expect(exec).toContain("seenRowHashes");
    expect(exec).toMatch(/set\(\s*\{\s*deletedAt:\s*commitNow\s*\}\s*\)/);
    expect(exec).toMatch(/seenRowHashes\.has\(\s*r\.rowHash\s*\)/);
  });

  it("preserves the canonical 0..1 scale on percent writes (Fix 4a)", () => {
    expect(exec).toContain("clampPercent(fileRow.pctComplete)");
    expect(exec).toContain("clampPercent(fileRow.expectedPctComplete)");
  });
});

// ---------------------------------------------------------------------------
// 3. Legacy task-import paths are 410'd (no bypass route remains)
// ---------------------------------------------------------------------------

describe("legacy /api/upload-style endpoints no longer write to work_items", () => {
  it("admin-routes.ts /api/upload returns 410 Gone", () => {
    const admin = read("server/departments/admin-routes.ts");
    expect(admin).toMatch(/router\.post\("\/api\/upload"[\s\S]{0,400}res\.status\(410\)/);
    expect(admin).toContain('"endpoint_deprecated"');
  });

  it("admin-routes.ts /api/reprocess-all returns 410 Gone", () => {
    const admin = read("server/departments/admin-routes.ts");
    expect(admin).toMatch(/router\.post\("\/api\/reprocess-all"[\s\S]{0,400}res\.status\(410\)/);
  });

  it("admin-routes.ts no longer calls createManyProjectPlans / deleteProjectPlansByProject", () => {
    const admin = stripComments(read("server/departments/admin-routes.ts"));
    expect(admin).not.toContain("createManyProjectPlans");
    expect(admin).not.toContain("deleteProjectPlansByProject");
  });

  it("imports-admin-extracted-routes.ts /api/admin/refresh-data returns 410 Gone", () => {
    const extracted = read("server/routes/imports-admin-extracted-routes.ts");
    expect(extracted).toMatch(/app\.post\("\/api\/admin\/refresh-data"[\s\S]{0,400}res\.status\(410\)/);
  });

  it("imports-admin-extracted-routes.ts /api/admin/scan-folder no longer inserts into work_items", () => {
    const extracted = stripComments(read("server/routes/imports-admin-extracted-routes.ts"));
    // The scan-folder handler still exists, but the dedup-bypass blocks
    // (storage.transaction delete-and-reinsert AND the direct
    // db.insert(workItems) block) have been removed.
    const scanFolderStart = extracted.indexOf('app.post("/api/admin/scan-folder"');
    const scanFolderEnd = extracted.indexOf('app.post("/api/admin/mark-active"');
    expect(scanFolderStart).toBeGreaterThan(-1);
    expect(scanFolderEnd).toBeGreaterThan(scanFolderStart);
    const handlerBody = extracted.slice(scanFolderStart, scanFolderEnd);
    expect(handlerBody).not.toMatch(/db\.insert\(workItems\)/);
    expect(handlerBody).not.toContain("createManyProjectPlans");
    expect(handlerBody).not.toContain("deleteProjectPlansByProject");
  });

  it("imports-admin-extracted-routes.ts has no /api/upload or /api/reprocess-all handler", () => {
    const extracted = read("server/routes/imports-admin-extracted-routes.ts");
    expect(extracted).not.toMatch(/app\.post\("\/api\/upload"/);
    expect(extracted).not.toMatch(/app\.post\("\/api\/reprocess-all"/);
  });

  it("client only calls /api/smart-import/upload (never /api/upload)", () => {
    // Scope: the client must not regress to the legacy endpoint.
    const clientFiles = walkFiles("client/src");
    const offender = clientFiles.find((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /["'`]\/api\/upload["'`\s]/.test(text);
    });
    expect(offender, `client file calls legacy /api/upload: ${offender}`).toBeUndefined();
  });
});

function walkFiles(rel: string): string[] {
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const stack = [abs];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Smart Import never writes to documents / folders
// ---------------------------------------------------------------------------

describe("Smart Import has no write path into documents / folders", () => {
  it("smart-import-routes.ts does not reference managed_documents / project_folders / folder_taxonomy", () => {
    const routes = read("server/smart-import-routes.ts");
    expect(routes).not.toMatch(/managed[Dd]ocuments|managed_documents/);
    expect(routes).not.toMatch(/project[Ff]olders|project_folders/);
    expect(routes).not.toMatch(/folder[Tt]axonomy|folder_taxonomy/);
  });

  it("commit-executor.ts does not reference managed_documents / project_folders / folder_taxonomy", () => {
    const exec = read("server/lib/import/commit-executor.ts");
    expect(exec).not.toMatch(/managed[Dd]ocuments|managed_documents/);
    expect(exec).not.toMatch(/project[Ff]olders|project_folders/);
    expect(exec).not.toMatch(/folder[Tt]axonomy|folder_taxonomy/);
  });
});

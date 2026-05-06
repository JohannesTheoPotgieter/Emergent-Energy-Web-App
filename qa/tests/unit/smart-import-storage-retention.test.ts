import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("smart import storage retention", () => {
  it("uses memory storage (no disk writes) and prunes old DB import runs", () => {
    const source = read("server/smart-import-routes.ts");

    // Memory storage, no disk storage
    expect(source).toContain("multer.memoryStorage()");
    expect(source).not.toContain("multer.diskStorage");
    expect(source).not.toContain("uploadDir");

    // DB-level pruning keeps latest + fallback
    expect(source).toContain("async function pruneOldImportRuns");
    expect(source).toContain("await pruneOldImportRuns(run.projectName, run.id)");
  });
});

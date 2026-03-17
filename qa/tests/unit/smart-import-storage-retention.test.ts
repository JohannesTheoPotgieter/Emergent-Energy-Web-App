import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("smart import storage retention", () => {
  it("prunes stored workbook files so only the latest two copies per source file remain on disk", () => {
    const source = read("server/smart-import-routes.ts");

    expect(source).toContain("async function pruneStoredUploadFiles");
    expect(source).toContain("const suffix = `_${sanitizedOriginal}`;");
    expect(source).toContain("const filesToDelete = matchingFiles.slice(keepLatest);");
    expect(source).toContain("await pruneStoredUploadFiles(fileName, 2);");
  });
});

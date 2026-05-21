import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "server/lib/import/commit-executor.ts"),
  "utf8",
);

describe("smart import plan active-row cleanup", () => {
  it("collapses active duplicate PLAN row hashes after a workbook commit", () => {
    expect(source).toContain("PARTITION BY project_id, row_hash");
    expect(source).toContain("source = 'SMART_IMPORT'");
    expect(source).toContain("AND r.rn > 1");
    expect(source).toContain("ORDER BY import_run_id DESC NULLS LAST");
  });
});

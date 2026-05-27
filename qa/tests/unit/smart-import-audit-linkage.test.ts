/**
 * TF-14 (audit V3) — Contract test for the Smart Import audit linkage
 * by import_run_id. Pins the per-line audit envelope in the commit
 * handler so the forensic question "which import wrote this line?" stays
 * answerable by a single audit_events lookup.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-14 — Smart Import audit linkage by import_run_id", () => {
  const src = read("server/smart-import-routes.ts");

  it("commit audit emits importRunId in changesJson", () => {
    expect(src).toContain('action: "commit"');
    expect(src).toContain("importRunId: runId");
  });

  it("commit audit emits a sample of revenue + cost line IDs with truncation flags", () => {
    expect(src).toContain("revenueLineIdsSample");
    expect(src).toContain("revenueLineIdsTruncated");
    expect(src).toContain("costLineIdsSample");
    expect(src).toContain("costLineIdsTruncated");
    expect(src).toContain("INSERTED_ID_LIMIT");
  });

  it("samples are bounded so a 5,000-row import doesn't bloat the audit row", () => {
    const match = src.match(/const INSERTED_ID_LIMIT = (\d+);/);
    expect(match).toBeTruthy();
    if (match) {
      const limit = Number(match[1]);
      expect(limit).toBeGreaterThan(50);
      expect(limit).toBeLessThanOrEqual(500);
    }
  });
});

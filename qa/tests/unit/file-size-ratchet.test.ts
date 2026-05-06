/**
 * EE-QA-015 — ratchet test against file-size growth.
 *
 * The audit flagged 48 source files above 1,500 LOC, with the worst
 * (`server/departments/finance-routes.ts`) at 7,675 LOC. Every defect
 * in those files is hard to locate, hard to test, and easy to regress.
 *
 * Splitting them is a long-term workstream, not a single PR. In the
 * meantime, this test enforces:
 *
 *   1. None of the baseline files may grow above their captured LOC
 *      (with a small buffer for trivial whitespace / import churn).
 *   2. No NEW file may land above the FILE_SIZE_THRESHOLD without an
 *      explicit baseline entry — i.e. the cliff cannot be widened.
 *   3. If a baseline file has shrunk by more than 100 lines below its
 *      recorded LOC, the test asks the contributor to refresh the
 *      baseline so progress is locked in.
 *
 * Refresh after a split:
 *
 *   npx tsx scripts/build-file-size-baseline.ts > qa/fixtures/file-size-baseline.json
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildBaseline,
  FILE_SIZE_THRESHOLD,
  type FileSizeBaselineEntry,
} from "../../../scripts/build-file-size-baseline";

const BASELINE_PATH = path.join(process.cwd(), "qa", "fixtures", "file-size-baseline.json");

interface BaselineFile {
  threshold: number;
  buffer?: number;
  files: FileSizeBaselineEntry[];
}

describe("EE-QA-015 — file-size ratchet", () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as BaselineFile;
  const buffer = baseline.buffer ?? 50;
  const baselineByPath = new Map(baseline.files.map((f) => [f.file, f.loc] as const));

  it("baseline threshold matches the script (drift guard)", () => {
    expect(baseline.threshold).toBe(FILE_SIZE_THRESHOLD);
  });

  it("no baseline file has grown above its captured LOC + buffer", () => {
    const current = buildBaseline();
    const violations: string[] = [];
    for (const cur of current) {
      const max = baselineByPath.get(cur.file);
      if (max == null) continue; // handled by the next test (new offenders)
      if (cur.loc > max + buffer) {
        violations.push(`  ${cur.file}: ${cur.loc} (was ${max}, max ${max + buffer})`);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        [
          `${violations.length} baseline file(s) grew beyond their cap:`,
          ...violations,
          "",
          "Either split the file or, if growth is genuinely unavoidable for THIS",
          "PR, refresh the baseline AFTER understanding why:",
          "  npx tsx scripts/build-file-size-baseline.ts > qa/fixtures/file-size-baseline.json",
        ].join("\n"),
      );
    }
    expect(violations).toEqual([]);
  });

  it("no NEW file lands above the threshold without an explicit baseline entry", () => {
    const current = buildBaseline();
    const newOffenders = current
      .filter((c) => !baselineByPath.has(c.file))
      .map((c) => `  ${c.file} (${c.loc} LOC, threshold ${FILE_SIZE_THRESHOLD})`);
    if (newOffenders.length > 0) {
      throw new Error(
        [
          `${newOffenders.length} new file(s) landed above the ${FILE_SIZE_THRESHOLD}-LOC threshold:`,
          ...newOffenders,
          "",
          "Split the file into focused modules under 1500 LOC before merging.",
          "Each domain split is its own PR (audit guidance — see EE-QA-015).",
        ].join("\n"),
      );
    }
    expect(newOffenders).toEqual([]);
  });

  it("baseline shrinks downward — refresh the JSON when a split lands", () => {
    const current = new Map(buildBaseline().map((c) => [c.file, c.loc] as const));
    const stale: string[] = [];
    for (const [file, recordedLoc] of baselineByPath.entries()) {
      const cur = current.get(file);
      if (cur == null) {
        // File was split / removed entirely. Excellent — drop it from the baseline.
        stale.push(`  ${file} — file no longer over the threshold (or moved). Remove from baseline.`);
      } else if (recordedLoc - cur > 100) {
        stale.push(`  ${file} — was ${recordedLoc}, now ${cur}. Refresh the baseline to lock the win.`);
      }
    }
    if (stale.length > 0) {
      throw new Error(
        [
          "Baseline is stale (some files have been split / shrunk significantly):",
          ...stale,
          "",
          "Lock the wins in by running:",
          "  npx tsx scripts/build-file-size-baseline.ts > qa/fixtures/file-size-baseline.json",
        ].join("\n"),
      );
    }
    expect(stale).toEqual([]);
  });
});

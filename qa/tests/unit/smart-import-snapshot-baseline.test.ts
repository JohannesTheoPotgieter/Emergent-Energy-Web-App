/**
 * Smart Import v2 — Snapshot Baseline Alignment
 *
 * Verifies the fix for the "More conflicts found — data changed while
 * you were resolving" loop reported on Mondi/Bree imports. The root
 * cause was that the planner / 3-way conflict gate built its baseline
 * (B) from `smartImportRuns.summaryJson.normalization` while the
 * writer engine used per-row `import_snapshot` JSONB. The two drifted
 * apart whenever a user committed conflict resolutions or made manual
 * cell edits, producing a 409 loop where each engine surfaced a
 * different conflict set.
 *
 * These are pure-function tests over the planner's classifier — no DB
 * required. They exercise the documented PLAN snapshot-key →
 * normalizer-field mapping and prove the planner now resolves
 * conflicts the same way the writer does given identical inputs.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { classifyField } from "../../../server/lib/import/conflict-engine";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Snapshot baseline loader (loadBaselineFromSnapshots)", () => {
  it("baseline.ts exports loadBaselineFromSnapshots and loadBaselineForPlanner", () => {
    const code = read("server/lib/import/baseline.ts");
    expect(code).toMatch(/export async function loadBaselineFromSnapshots/);
    expect(code).toMatch(/export async function loadBaselineForPlanner/);
  });

  it("planner uses loadBaselineForPlanner (snapshot-aware), not the legacy loadBaselineNormalization", () => {
    const code = read("server/lib/import/planner.ts");
    expect(code).toMatch(/loadBaselineForPlanner/);
    expect(code).not.toMatch(/loadBaselineNormalization\(/);
  });

  it("commit route uses loadBaselineForPlanner for the conflict-engine baseline", () => {
    const code = read("server/smart-import-routes.ts");
    expect(code).toMatch(/loadBaselineForPlanner/);
  });

  it("PLAN snapshot keys are mapped to normalizer field names", () => {
    const code = read("server/lib/import/baseline.ts");
    // Spot-check the four mappings most likely to drift between
    // work_items columns and normalizer fields. If any of these are
    // dropped, the planner will read `undefined` from the baseline and
    // mis-classify every PLAN field as a conflict.
    expect(code).toMatch(/duration:\s*"durationDays"/);
    expect(code).toMatch(/actualStart:\s*"actualStartDate"/);
    expect(code).toMatch(/ownerName:\s*"owner"/);
    expect(code).toMatch(/percentComplete:\s*"pctComplete"/);
    expect(code).toMatch(/description:\s*"comment"/);
    expect(code).toMatch(/outlineNumber:\s*"parentTaskNo"/);
  });

  it("snapshot-baseline feature flag exists with default ON", () => {
    const code = read("server/lib/import/feature-flags.ts");
    expect(code).toMatch(/snapshotBaselineEnabled/);
    expect(code).toMatch(/USE_SNAPSHOT_BASELINE/);
    expect(code).toMatch(/default ON/);
  });
});

describe("Conflict engine: aligned-baseline behaviour on expectedPctComplete", () => {
  // Mondi reproduction shape: workbook re-uploaded, user has edited a
  // bunch of expectedPctComplete cells in-app since the last commit.
  // With the snapshot baseline, the planner sees B = (the value we
  // wrote on the previous commit), C = (user's edit), F = (workbook
  // value). When the workbook hasn't moved (B === F) the field MUST
  // resolve as KEEP_APP, not CONFLICT — otherwise the user gets an
  // un-clearable loop on every subsequent re-import.
  it("KEEP_APP when workbook value matches the snapshot baseline", () => {
    const fm = classifyField("expectedPctComplete", /*B*/ 0.4, /*C*/ 0.85, /*F*/ 0.4);
    expect(fm.mergeCase).toBe("KEEP_APP");
    expect(fm.requiresDecision).toBe(false);
  });

  it("CONFLICT only when both app and workbook have moved differently", () => {
    const fm = classifyField("expectedPctComplete", /*B*/ 0.4, /*C*/ 0.85, /*F*/ 0.5);
    expect(fm.mergeCase).toBe("CONFLICT");
    expect(fm.requiresDecision).toBe(true);
  });

  it("AUTO_ACCEPT_FILE when only the workbook has moved", () => {
    const fm = classifyField("expectedPctComplete", /*B*/ 0.4, /*C*/ 0.4, /*F*/ 0.5);
    expect(fm.mergeCase).toBe("AUTO_ACCEPT_FILE");
    expect(fm.requiresDecision).toBe(false);
  });

  // Screenshot 2 case — BASELINE empty, YOUR EDIT 0, SOURCE 0.5.
  // Numeric normalizer treats 0 and null as equivalent ("absent"), so
  // B === C === "absent" and F === 0.5: this is AUTO_ACCEPT_FILE, not a
  // user-blocking conflict.
  it("AUTO_ACCEPT_FILE when baseline & app are both empty/zero and workbook has a value", () => {
    const fm = classifyField("expectedPctComplete", /*B*/ null, /*C*/ 0, /*F*/ 0.5);
    expect(fm.mergeCase).toBe("AUTO_ACCEPT_FILE");
    expect(fm.requiresDecision).toBe(false);
  });
});

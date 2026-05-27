/**
 * TF-22 (audit V3) — Contract test for the S_HOLD finance freeze gate.
 *
 * Pins the surface of `project-hold-gate.ts` so a future refactor cannot
 * silently drop the gate or its override mechanism. End-to-end correctness
 * against a fixture project (needs test DB) is queued behind DF-21.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as gate from "../../../server/services/project-hold-gate";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-22 — project hold gate contract", () => {
  it("exports the evaluator + assertion + error class", () => {
    expect(typeof gate.isProjectOnHold).toBe("function");
    expect(typeof gate.assertProjectNotOnHold).toBe("function");
    expect(typeof gate.ProjectOnHoldError).toBe("function");
  });

  it("wires the gate into finance-line-write-service create + update paths", () => {
    const src = read("server/services/finance-line-write-service.ts");
    expect(src).toContain('from "./project-hold-gate"');
    expect(src).toContain("assertProjectNotOnHold");
    // Override envelope ferries through values.__overrideHold so a route can
    // opt out for an owner-authored override + reason.
    expect(src).toContain("__overrideHold");
    expect(src).toContain("__overrideHoldReason");
    // The envelope must be stripped before the DB write — otherwise the
    // INSERT would set a non-column.
    expect(src).toMatch(/const \{ __overrideHold, __overrideHoldReason, \.\.\.persistable \}/);
  });

  it("requires a 10-character reason when override=true", () => {
    const src = read("server/services/project-hold-gate.ts");
    expect(src).toContain("override_reason_required");
    expect(src).toContain("at least 10 characters");
  });
});

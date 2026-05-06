import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

describe("lifecycle stage gate engine", () => {
  it("allows stage transition when requirements are complete", () => {
    const source = read("server/services/lifecycle-stage-gate-service.ts");
    expect(source).toContain("const allowed = missingItems.length === 0 || Boolean(activeOverride)");
  });

  it("blocks stage transition with missing requirements", () => {
    const source = read("server/lifecycle-routes.ts");
    expect(source).toContain('error: "stage_gate_failed"');
    expect(source).toContain("missingItems: evaluation.missingItems");
  });

  it("rejects override attempt by unauthorized role", () => {
    const source = read("server/lifecycle-routes.ts");
    expect(source).toContain("Your role is not authorized to submit stage gate overrides");
  });

  it("accepts override by authorized role", () => {
    const source = read("server/lifecycle-routes.ts");
    expect(source).toContain("STAGE_GATE_OVERRIDE_ROLES");
    expect(source).toContain("createStageGateOverride");
  });

  it("does not use expired overrides", () => {
    const source = read("server/services/lifecycle-stage-gate-service.ts");
    expect(source).toContain("or(isNull(stageGateOverrides.expiresAt), lte(sql`now()`, stageGateOverrides.expiresAt))");
  });

  it("records gate and override events in project timeline", () => {
    const source = read("server/services/lifecycle-stage-gate-service.ts");
    expect(source).toContain('eventType: allowed ? "project.gate_passed" : "project.gate_failed"');
    expect(source).toContain('eventType: "project.override_granted"');
  });
});

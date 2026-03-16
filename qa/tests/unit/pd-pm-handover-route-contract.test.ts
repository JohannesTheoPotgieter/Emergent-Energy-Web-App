import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "server/handover-routes.ts"), "utf8");

describe("pd pm handover route contract", () => {
  it("persists the canonical latest update through the existing PD draft route", () => {
    expect(source).toContain("storage.upsertProjectEditableFields");
  });

  it("writes explicit handover history records for submit, accept, and reject decisions", () => {
    expect(source).toContain("PD_PM_HANDOVER_SUBMITTED");
    expect(source).toContain("PD_PM_HANDOVER_ACCEPTED");
    expect(source).toContain("PD_PM_HANDOVER_REJECTED");
    expect(source).toContain("PD_PM_HANDOVER_SUBMIT_BLOCKED");
  });

  it("reuses lifecycle phase history when a handover is accepted", () => {
    expect(source).toContain("projectPhaseHistory");
    expect(source).toContain("PD to PM handover accepted");
  });
});

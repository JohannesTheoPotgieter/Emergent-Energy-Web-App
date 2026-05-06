import { describe, expect, it } from "vitest";
import { isPhase1ADomainEnabled, isPhase1AEndpointEnabled, type Phase1AFlagSet } from "../../../server/services/phase1a-reconciliation-policy";

const allOff: Phase1AFlagSet = {
  migration_bridge_project_read_v1: false,
  migration_bridge_lifecycle_read_v1: false,
  migration_bridge_approvals_dual_read_v1: false,
  migration_bridge_finance_read_v1: false,
  migration_bridge_deliverables_read_v1: false,
  migration_bridge_party_read_v1: false,
};

describe("Phase 1A endpoint gating policy", () => {
  it("keeps endpoint disabled when compare mode is off and bridge project-read flag is off", () => {
    expect(isPhase1AEndpointEnabled(false, allOff)).toBe(false);
  });

  it("enables endpoint with compare mode even when all bridge flags are off", () => {
    expect(isPhase1AEndpointEnabled(true, allOff)).toBe(true);
  });

  it("enables only flagged domains when compare mode is off", () => {
    const flags: Phase1AFlagSet = { ...allOff, migration_bridge_finance_read_v1: true };
    expect(isPhase1ADomainEnabled("finance", false, flags)).toBe(true);
    expect(isPhase1ADomainEnabled("approvals", false, flags)).toBe(false);
  });

  it("enables all domains in compare mode", () => {
    expect(isPhase1ADomainEnabled("project_reads", true, allOff)).toBe(true);
    expect(isPhase1ADomainEnabled("party_contacts", true, allOff)).toBe(true);
  });
});

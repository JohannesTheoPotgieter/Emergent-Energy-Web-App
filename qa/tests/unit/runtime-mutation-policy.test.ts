import { describe, expect, it } from "vitest";
import { getStartupModes } from "../../../server/startup-modes";
import { getRuntimeMutationPolicy } from "../../../server/bootstrap/runtime-mutation-policy";

function resetEnv() {
  delete process.env.ENABLE_STARTUP_MAINTENANCE;
  delete process.env.ENABLE_STARTUP_SCHEMA_REPAIR;
  delete process.env.ENABLE_RUNTIME_MAINTENANCE;
  delete process.env.ENABLE_STARTUP_MIGRATIONS;
}

describe("runtime mutation policy", () => {
  it("keeps runtime mutations disabled by default", () => {
    resetEnv();
    const policy = getRuntimeMutationPolicy(getStartupModes());
    expect(policy.runtimeMaintenanceEnabled).toBe(false);
    expect(policy.runtimeMutationsActive).toBe(false);
  });

  it("requires runtime maintenance flag for startup mutations", () => {
    resetEnv();
    process.env.ENABLE_STARTUP_SCHEMA_REPAIR = "true";
    process.env.ENABLE_STARTUP_MIGRATIONS = "true";

    const policyWithoutRuntimeFlag = getRuntimeMutationPolicy(getStartupModes());
    expect(policyWithoutRuntimeFlag.runtimeMutationsActive).toBe(false);

    process.env.ENABLE_RUNTIME_MAINTENANCE = "true";
    const policyWithRuntimeFlag = getRuntimeMutationPolicy(getStartupModes());
    expect(policyWithRuntimeFlag.runtimeMaintenanceEnabled).toBe(true);
    expect(policyWithRuntimeFlag.runtimeMutationsActive).toBe(true);
    expect(policyWithRuntimeFlag.runtimeStartupMigrationsActive).toBe(true);
  });
});

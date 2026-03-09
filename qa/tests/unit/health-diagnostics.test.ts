import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildHealthDiagnostics } from "../../../server/health-diagnostics";
import { getStartupModes } from "../../../server/startup-modes";

const keys = [
  "ENABLE_STARTUP_MAINTENANCE",
  "ENABLE_STARTUP_SCHEMA_REPAIR",
  "ENABLE_STARTUP_DATA_SEED",
  "ENABLE_STARTUP_BACKFILL",
  "ENABLE_STARTUP_SESSION_RESET",
  "ENABLE_STARTUP_USER_SEED",
] as const;

function clearFlags() {
  for (const key of keys) {
    delete process.env[key];
  }
}

describe("health diagnostics contract", () => {
  beforeEach(() => clearFlags());
  afterEach(() => clearFlags());

  it("includes raw startup flags and derived startup modes", () => {
    process.env.ENABLE_STARTUP_MAINTENANCE = "true";

    const startupModes = getStartupModes();
    const payload = buildHealthDiagnostics(
      "postgres",
      { connected: true, mode: "postgres", message: "ok", host: "db.internal" },
      startupModes,
    );

    expect(payload.startupFlagsRaw).toEqual(
      expect.objectContaining({
        ENABLE_STARTUP_MAINTENANCE: "true",
        ENABLE_STARTUP_SCHEMA_REPAIR: null,
      }),
    );
    expect(payload.startupModes).toEqual(
      expect.objectContaining({
        startupMaintenanceEnabled: true,
        startupSchemaRepairEnabled: true,
        startupSessionResetEnabled: true,
        startupReadOnlyByDefault: false,
      }),
    );
    expect(payload.startupMutationClassification).toBe("mixed");
  });
});

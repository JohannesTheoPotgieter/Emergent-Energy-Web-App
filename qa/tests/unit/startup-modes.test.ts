import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getStartupModes, parseEnvFlag } from "../../../server/startup-modes";

import fs from "node:fs";
import path from "node:path";

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

describe("startup mode derivation", () => {
  beforeEach(() => clearFlags());
  afterEach(() => clearFlags());

  it("parseEnvFlag supports common true values", () => {
    expect(parseEnvFlag("true")).toBe(true);
    expect(parseEnvFlag("TRUE")).toBe(true);
    expect(parseEnvFlag("1")).toBe(true);
    expect(parseEnvFlag("yes")).toBe(true);
    expect(parseEnvFlag("on")).toBe(true);
    expect(parseEnvFlag("false")).toBe(false);
    expect(parseEnvFlag(undefined)).toBe(false);
  });

  it("default boot is read-only and mutation flags are disabled", () => {
    const modes = getStartupModes();
    expect(modes.startupMaintenanceEnabled).toBe(false);
    expect(modes.startupSchemaRepairEnabled).toBe(false);
    expect(modes.startupSessionResetEnabled).toBe(false);
    expect(modes.startupReadOnlyByDefault).toBe(true);
    expect(modes.startupMutationClassification).toBe("read_only");
  });

  it("maintenance mode enables all gated startup mutations", () => {
    process.env.ENABLE_STARTUP_MAINTENANCE = "true";
    const modes = getStartupModes();
    expect(modes.startupSchemaRepairEnabled).toBe(true);
    expect(modes.startupDataSeedEnabled).toBe(true);
    expect(modes.startupBackfillEnabled).toBe(true);
    expect(modes.startupSessionResetEnabled).toBe(true);
    expect(modes.startupReadOnlyByDefault).toBe(false);
    expect(modes.startupMutationClassification).toBe("mixed");
  });

  it("schema repair flag enables repair classification without session reset", () => {
    process.env.ENABLE_STARTUP_SCHEMA_REPAIR = "true";
    const modes = getStartupModes();
    expect(modes.startupSchemaRepairEnabled).toBe(true);
    expect(modes.startupSessionResetEnabled).toBe(false);
    expect(modes.startupReadOnlyByDefault).toBe(false);
    expect(modes.startupMutationClassification).toBe("repair_enabled");
  });

  it("explicit session reset without schema repair is destructive classification", () => {
    process.env.ENABLE_STARTUP_SESSION_RESET = "true";
    const modes = getStartupModes();
    expect(modes.startupSchemaRepairEnabled).toBe(false);
    expect(modes.startupSessionResetEnabled).toBe(true);
    expect(modes.startupMutationClassification).toBe("destructive_reset_enabled");
  });
});

describe("server auth/session middleware wiring", () => {
  it("delegates session/auth setup into bootstrap modules and keeps memory fallback path", () => {
    const indexSource = fs.readFileSync(path.resolve(process.cwd(), "server/index.ts"), "utf8");
    const sessionSource = fs.readFileSync(path.resolve(process.cwd(), "server/bootstrap/session.ts"), "utf8");

    expect(indexSource).toContain("configureSession({");
    expect(indexSource).toContain("configurePassportAuth(storage);");
    expect((indexSource.match(/app\.use\(passport\.initialize\(\)\);/g) || []).length).toBe(1);
    expect((indexSource.match(/app\.use\(passport\.session\(\)\);/g) || []).length).toBe(1);

    expect(sessionSource).toContain("MemoryStore(session)");
    expect(sessionSource).toContain("createTableIfMissing: startupSchemaRepairEnabled");
  });
});

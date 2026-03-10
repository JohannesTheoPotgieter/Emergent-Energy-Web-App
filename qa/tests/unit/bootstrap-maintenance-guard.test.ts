import { describe, expect, it, vi } from "vitest";
import { shouldRunRuntimeStartupMigrations } from "../../../server/bootstrap/maintenance-guard";

describe("shouldRunRuntimeStartupMigrations", () => {
  it("does not run when ENABLE_STARTUP_MIGRATIONS is false", () => {
    const original = process.env.ENABLE_STARTUP_MIGRATIONS;
    process.env.ENABLE_STARTUP_MIGRATIONS = "false";

    const log = vi.fn();
    const result = shouldRunRuntimeStartupMigrations(true, log);

    expect(result).toBe(false);
    expect(log).not.toHaveBeenCalled();

    if (original) process.env.ENABLE_STARTUP_MIGRATIONS = original;
    else delete process.env.ENABLE_STARTUP_MIGRATIONS;
  });

  it("does not run and logs when migration flag is on but schema repair is off", () => {
    const original = process.env.ENABLE_STARTUP_MIGRATIONS;
    process.env.ENABLE_STARTUP_MIGRATIONS = "true";

    const log = vi.fn();
    const result = shouldRunRuntimeStartupMigrations(false, log);

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);

    if (original) process.env.ENABLE_STARTUP_MIGRATIONS = original;
    else delete process.env.ENABLE_STARTUP_MIGRATIONS;
  });
});

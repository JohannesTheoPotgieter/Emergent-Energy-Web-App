export function shouldRunRuntimeStartupMigrations(startupSchemaRepairEnabled: boolean, log: (message: string, source?: string) => void): boolean {
  const startupMigrationsEnabled = process.env.ENABLE_STARTUP_MIGRATIONS === "true";
  if (!startupMigrationsEnabled) {
    return false;
  }

  if (!startupSchemaRepairEnabled) {
    log(
      "ENABLE_STARTUP_MIGRATIONS=true ignored because startup schema repair is disabled. Enable ENABLE_STARTUP_SCHEMA_REPAIR or ENABLE_STARTUP_MAINTENANCE for explicit mutation mode.",
      "startup",
    );
    return false;
  }

  return true;
}

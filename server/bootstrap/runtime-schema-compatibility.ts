export async function runRuntimeSchemaCompatibility(
  enabled: boolean,
  log: (message: string, source?: string) => void,
) {
  if (!enabled) return;

  // Runtime compatibility is intentionally tiny: broad schema evolution now lives in SQL migrations.
  if (process.env.NODE_ENV === "production") {
    log("Runtime compatibility repair skipped in production; use migrations for schema changes", "Startup:Maintenance");
    return;
  }

  log("Runtime compatibility repair mode enabled (no schema DDL executed)", "Startup:Maintenance");
}

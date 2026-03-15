export async function runGuardedStartupMaintenance(options: {
  enabled: boolean;
  schemaRepairEnabled: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { enabled, schemaRepairEnabled, log } = options;
  if (!enabled || !schemaRepairEnabled) return;

  log(
    "Guarded startup maintenance mode enabled (schema evolution moved to SQL migrations)",
    "startup-maintenance",
  );
}

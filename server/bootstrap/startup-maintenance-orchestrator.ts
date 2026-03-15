import { runGuardedStartupMaintenance } from "./maintenance";
import { runRuntimeSchemaCompatibility } from "./runtime-schema-compatibility";

export async function runStartupMaintenanceOrchestrator(options: {
  runtimeMaintenanceEnabled: boolean;
  startupSchemaRepairEnabled: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { runtimeMaintenanceEnabled, startupSchemaRepairEnabled, log } = options;
  await runGuardedStartupMaintenance({
    enabled: runtimeMaintenanceEnabled,
    schemaRepairEnabled: startupSchemaRepairEnabled,
    log,
  });

  await runRuntimeSchemaCompatibility(runtimeMaintenanceEnabled && startupSchemaRepairEnabled, log);
}

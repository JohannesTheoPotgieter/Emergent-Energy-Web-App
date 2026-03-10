import type { getStartupModes } from "../startup-modes";

export interface RuntimeMutationPolicy {
  runtimeMaintenanceEnabled: boolean;
  runtimeMutationsActive: boolean;
  runtimeStartupMigrationsActive: boolean;
  reason: string;
}

export function getRuntimeMutationPolicy(startupModes: ReturnType<typeof getStartupModes>): RuntimeMutationPolicy {
  const runtimeMaintenanceEnabled = startupModes.startupMaintenanceEnabled || process.env.ENABLE_RUNTIME_MAINTENANCE === "true";
  if (!runtimeMaintenanceEnabled) {
    return {
      runtimeMaintenanceEnabled,
      runtimeMutationsActive: false,
      runtimeStartupMigrationsActive: false,
      reason: "runtime-maintenance-disabled",
    };
  }

  const runtimeStartupMigrationsActive = process.env.ENABLE_STARTUP_MIGRATIONS === "true" && startupModes.startupSchemaRepairEnabled;

  return {
    runtimeMaintenanceEnabled,
    runtimeMutationsActive: startupModes.startupSchemaRepairEnabled || startupModes.startupBackfillEnabled || startupModes.startupDataSeedEnabled,
    runtimeStartupMigrationsActive,
    reason: "runtime-maintenance-enabled",
  };
}

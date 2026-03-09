const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function normalizeKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function readFirst(...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = parseBoolean(process.env[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Reads startup-task toggles while keeping compatibility with legacy
 * ENABLE_STARTUP_* flags.
 */
export function isStartupTaskEnabled(taskName: string, defaultValue = true): boolean {
  const normalized = normalizeKey(taskName);
  const resolved = readFirst(
    `STARTUP_${normalized}_ENABLED`,
    `ENABLE_STARTUP_${normalized}`,
  );

  return resolved ?? defaultValue;
}

/**
 * Reads maintenance-task toggles and derives defaults from the umbrella
 * maintenance flag when a task-specific value is not present.
 */
export function isMaintenanceStartupTaskEnabled(taskName: string, defaultValue = true): boolean {
  const normalized = normalizeKey(taskName);

  const explicit = readFirst(
    `STARTUP_MAINTENANCE_${normalized}_ENABLED`,
    `ENABLE_STARTUP_MAINTENANCE_${normalized}`,
  );
  if (explicit !== undefined) return explicit;

  const maintenanceUmbrella = readFirst(
    "STARTUP_MAINTENANCE_ENABLED",
    "ENABLE_STARTUP_MAINTENANCE",
  );

  return maintenanceUmbrella ?? defaultValue;
}

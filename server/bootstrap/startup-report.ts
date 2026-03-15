export interface StartupReport {
  dbMode: string;
  startupFlags: Record<string, unknown>;
  maintenance: string[];
  backfills: string[];
  seeds: string[];
  routes: string[];
  runtimeServices: string[];
  warnings: string[];
}

export function createStartupReport(dbMode: string, startupFlags: Record<string, unknown>): StartupReport {
  return {
    dbMode,
    startupFlags,
    maintenance: [],
    backfills: [],
    seeds: [],
    routes: [],
    runtimeServices: [],
    warnings: [],
  };
}

export function logStartupSummary(
  report: StartupReport,
  log: (message: string, source?: string) => void,
) {
  log(`[Startup] dbMode=${report.dbMode}`, "Startup");
  log(`[Startup] flags=${JSON.stringify(report.startupFlags)}`, "Startup");
  log(`[Startup] maintenance=${report.maintenance.join(", ") || "none"}`, "Startup");
  log(`[Startup] backfills=${report.backfills.join(", ") || "none"}`, "Startup");
  log(`[Startup] seeds=${report.seeds.join(", ") || "none"}`, "Startup");
  log(`[Startup] routes=${report.routes.join(", ") || "none"}`, "Startup");
  log(`[Startup] runtime=${report.runtimeServices.join(", ") || "none"}`, "Startup");
  if (report.warnings.length > 0) {
    log(`[Startup] warnings=${report.warnings.join(" | ")}`, "Startup");
  }
}

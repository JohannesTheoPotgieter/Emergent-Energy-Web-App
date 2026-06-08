/**
 * C2 — Dashboard refresh scheduler + registry wiring.
 *
 * Called from start-runtime-services at boot. Registers the known
 * org-wide dashboards with their compute functions, starts the
 * periodic refresh loop, and kicks a single immediate refresh so
 * the cache is warm by the time users hit the dashboard endpoints.
 */

import {
  DASHBOARD_REFRESH_INTERVAL_MS,
  refreshAllDashboards,
  registerDashboard,
} from "../services/dashboard-refresh-service";
import { evaluateAppSchemaReadiness } from "./schema-readiness-runtime";
import { formatPendingSummary, isSchemaBehind } from "../lib/schema-readiness";

let refreshTimer: NodeJS.Timeout | null = null;
let schemaBehindWarned = false;

async function registerOrgWideDashboards(): Promise<void> {
  // Company overview — exec home tile.
  try {
    const { getCompanyOverviewData } = await import("../services/company-overview-service");
    registerDashboard({
      key: "company_overview",
      label: "Company Overview",
      compute: async () => getCompanyOverviewData(),
    });
  } catch (err) {
    console.error("[DashboardRefresh] Failed to register company_overview:", err);
  }

  // Integration health — C1 surface, refreshed by this loop so we don't
  // hit the per-integration query fan-out on every read.
  try {
    const { getIntegrationHealth } = await import("../services/integration-health-service");
    registerDashboard({
      key: "integration_health",
      label: "Integration Health",
      compute: async () => getIntegrationHealth(),
    });
  } catch (err) {
    console.error("[DashboardRefresh] Failed to register integration_health:", err);
  }

  // O&M handover — B8 close-to-handover dashboard.
  try {
    const { getOmHandoverDashboard } = await import("../services/om-handover-service");
    registerDashboard({
      key: "om_handover",
      label: "O&M Handover (Close to Handover)",
      compute: async () => getOmHandoverDashboard(),
    });
  } catch (err) {
    console.error("[DashboardRefresh] Failed to register om_handover:", err);
  }
}

/**
 * Run a refresh cycle, logging the outcome. Never throws — individual
 * compute failures are captured inside refreshDashboard.
 */
export async function runDashboardRefreshCycle(): Promise<void> {
  // Skip the cycle (with a single warning) when the DB is behind on
  // migrations, rather than throwing a Drizzle error every run.
  const readiness = await evaluateAppSchemaReadiness().catch(() => null);
  if (readiness && isSchemaBehind(readiness)) {
    if (!schemaBehindWarned) {
      console.warn(
        `[DashboardRefresh] Skipping cycle — DB schema behind on migrations (${formatPendingSummary(readiness)}).`,
      );
      schemaBehindWarned = true;
    }
    return;
  }
  schemaBehindWarned = false;

  try {
    const result = await refreshAllDashboards();
    console.log(
      `[DashboardRefresh] cycle complete: refreshed=${result.refreshed}, failed=${result.failed}`,
    );
    if (result.failed > 0) {
      for (const d of result.durations.filter((x) => !x.ok)) {
        console.warn(`[DashboardRefresh] failed: ${d.key} (${d.ms}ms)`);
      }
    }
  } catch (err) {
    console.error("[DashboardRefresh] cycle threw:", err);
  }
}

/**
 * Register dashboards + start the periodic refresh loop. Idempotent.
 */
export async function scheduleDashboardRefresh(): Promise<void> {
  await registerOrgWideDashboards();

  // Kick one immediate refresh so readers don't see an empty cache.
  // Don't await — let it run in the background.
  runDashboardRefreshCycle().catch((err) => {
    console.error("[DashboardRefresh] initial cycle error:", err);
  });

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    runDashboardRefreshCycle().catch((err) => {
      console.error("[DashboardRefresh] scheduled cycle error:", err);
    });
  }, DASHBOARD_REFRESH_INTERVAL_MS);

  // Don't keep the event loop alive just for this timer.
  if (typeof refreshTimer.unref === "function") refreshTimer.unref();
}

export function stopDashboardRefreshScheduler(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

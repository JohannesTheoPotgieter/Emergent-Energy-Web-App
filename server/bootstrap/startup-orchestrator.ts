import type { Express } from "express";
import type { Server } from "http";
import { registerAllRoutes } from "../routes/register-all-routes";
import { runStartupBackfills } from "./run-startup-backfills";
import { runStartupSeeds } from "./run-startup-seeds";
import { runStartupMaintenanceOrchestrator } from "./startup-maintenance-orchestrator";
import { startRuntimeServices } from "./start-runtime-services";
import type { StartupReport } from "./startup-report";
import { db, getDbMode } from "../db";
import { sql } from "drizzle-orm";
import { warnOnDangerousRoutesInNonDev } from "../middleware/production-safety";
import { loadRevokedTokensFromDb } from "../auth-context";

export async function runStartupOrchestrator(options: {
  app: Express;
  httpServer: Server;
  runtimeMaintenanceEnabled: boolean;
  startupSchemaRepairEnabled: boolean;
  startupDataSeedEnabled: boolean;
  startupBackfillEnabled: boolean;
  allowStartupMutations: boolean;
  startupSyncEnabled: boolean;
  report: StartupReport;
  log: (message: string, source?: string) => void;
}) {
  const {
    app,
    httpServer,
    runtimeMaintenanceEnabled,
    startupSchemaRepairEnabled,
    startupDataSeedEnabled,
    startupBackfillEnabled,
    allowStartupMutations,
    startupSyncEnabled,
    report,
    log,
  } = options;

  // ---------------------------------------------------------------------------
  // PRODUCTION SAFETY POLICY
  // ---------------------------------------------------------------------------
  // Schema evolution lives exclusively in ./migrations/*.sql — the runtime
  // startup path no longer runs ANY DDL (no CREATE TABLE, no ALTER TABLE, no
  // DROP, no CREATE INDEX). The legacy runDrizzleSchemaSync and
  // runAdditiveSchemaAlignments helpers were removed in a cleanup pass once
  // it was confirmed that shared/schema.ts + ./migrations are the joint
  // source of truth and that the orchestrator blocks duplicated them.
  //
  // Data-mutating housekeeping (import cleanup, safety-net backfills, data
  // seeds) must also default to read-only in production. It only runs when
  // the operator explicitly opts in via env flags, admin/migration mode, or
  // a local dev workspace.
  // ---------------------------------------------------------------------------
  const isProduction = process.env.NODE_ENV === "production";
  const startupMutationsAllowed = allowStartupMutations || !isProduction;

  log(
    `Runtime schema sync is disabled — schema is owned by ./migrations/*.sql (shared/schema.ts is the Drizzle mirror). Production startup is read-only.`,
    "Startup:Schema",
  );

  // Load persisted token/session revocations into memory so they survive restarts.
  try {
    await loadRevokedTokensFromDb();
  } catch (err) {
    log(`loadRevokedTokensFromDb failed (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:Auth");
  }

  await runStartupMaintenanceOrchestrator({ runtimeMaintenanceEnabled, startupSchemaRepairEnabled, log });
  report.maintenance.push(runtimeMaintenanceEnabled && startupSchemaRepairEnabled ? "completed" : "skipped");

  // Import cleanup writes to production tables. Only run when startup
  // mutations are explicitly allowed (dev, or admin/migration modes).
  if (startupMutationsAllowed && getDbMode() !== "sqlite") {
    try {
      const clearResult = await db.execute(sql.raw(`
        UPDATE smart_import_runs
        SET status = (CASE WHEN status::text = 'PREVIEW' THEN 'SUPERSEDED' ELSE 'superseded' END)::smart_import_status
        WHERE status::text IN ('PREVIEW', 'preview', 'AWAITING_REVIEW', 'awaiting_review')
      `));
      const cleared = (clearResult as any).rowCount ?? (clearResult as any).rows?.length ?? 0;
      if (cleared > 0) log(`Cleared ${cleared} staged import runs`, "Startup:ImportCleanup");
    } catch (err: unknown) {
      log(`Import cleanup skipped: ${(err instanceof Error ? err.message : String(err))}`, "Startup:ImportCleanup");
    }
  } else if (startupMutationsAllowed) {
    log("Import cleanup skipped in SQLite mode (Postgres enum casts not portable)", "Startup:ImportCleanup");
  } else {
    log("Import cleanup skipped (production read-only mode)", "Startup:ImportCleanup");
  }

  // Auto-enable data seeding ONLY in non-production when project_info is empty.
  // In production this must stay opt-in — an empty table or a transient error
  // must never trigger a full reseed against live data.
  let effectiveDataSeedEnabled = startupDataSeedEnabled;
  if (!effectiveDataSeedEnabled && !isProduction && getDbMode() === "postgres") {
    try {
      const countResult = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM project_info`));
      const count = parseInt(String((countResult as any).rows?.[0]?.cnt ?? "0"), 10);
      if (count === 0) {
        log("PostgreSQL project_info is empty — auto-enabling data seed migration (dev only)", "Startup:DataSeed");
        effectiveDataSeedEnabled = true;
      }
    } catch (err: unknown) {
      // In dev we still auto-enable on error (table may not exist yet).
      // In production we never reach this branch because isProduction guards it.
      log(`Could not check project_info count (${(err instanceof Error ? err.message : String(err))}) — auto-enabling data seed (dev only)`, "Startup:DataSeed");
      effectiveDataSeedEnabled = true;
    }
  } else if (!effectiveDataSeedEnabled && isProduction) {
    log("Data seed auto-enable skipped (production read-only mode)", "Startup:DataSeed");
  }
  await runStartupSeeds({ startupDataSeedEnabled: effectiveDataSeedEnabled, allowStartupMutations: effectiveDataSeedEnabled || allowStartupMutations, log });
  report.seeds.push(effectiveDataSeedEnabled ? "completed" : "skipped");

  // Safety-net backfills (integrity guard, stage instances, gate evaluation)
  // are write-paths and must respect the production read-only default.
  // They only run when explicit startup mutations are allowed (dev, admin
  // migration mode, or when the operator has turned on startup backfills).
  const mutationBackfillsAllowed =
    startupBackfillEnabled || allowStartupMutations || !isProduction;

  if (mutationBackfillsAllowed) {
    // Integrity guard (idempotent safety net for 1:1 relationships)
    try {
      const { runIntegrityGuard } = await import("./backfills/integrity-guard");
      await runIntegrityGuard(log);
    } catch (err: unknown) {
      log(`Integrity guard error (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:IntegrityGuard");
    }

    // Stage instance backfill — ensures all projects have stage instances,
    // marks historical projects' prior stages as PROGRESSED (not forced through gates)
    try {
      const { runStageInstanceBackfill } = await import("./backfills/stage-instance-backfill");
      await runStageInstanceBackfill(log);
    } catch (err: unknown) {
      log(`Stage instance backfill error (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:StageInstanceBackfill");
    }

    // Gate evaluation backfill — one-time: evaluates stage gates for all existing
    // projects so that gate_status and project_gate_evaluations are populated
    try {
      const { runGateEvaluationBackfill } = await import("./backfills/gate-evaluation-backfill");
      await runGateEvaluationBackfill(log);
    } catch (err: unknown) {
      log(`Gate evaluation backfill error (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:GateEvaluationBackfill");
    }
    // Priority collaboration tables (priority_comments, priority_watches) — idempotent DDL
    try {
      const { runPriorityTablesDdl } = await import("./backfills/priority-tables-backfill");
      await runPriorityTablesDdl(log);
    } catch (err: unknown) {
      log(`Priority tables DDL error (non-fatal): ${(err instanceof Error ? err.message : String(err))}`, "Startup:PriorityDdl");
    }
  } else {
    log(
      "Safety-net backfills skipped (production read-only mode). Enable ENABLE_STARTUP_BACKFILL or ADMIN_MIGRATION_MODE to run them.",
      "Startup:Backfill",
    );
  }

  await runStartupBackfills({
    startupBackfillEnabled,
    allowStartupMutations,
    log,
  });
  report.backfills.push(startupBackfillEnabled ? "completed" : "skipped");

  await registerAllRoutes({
    app,
    httpServer,
    log,
  });
  report.routes.push("registered");

  // Emit a loud warning for every dangerous route that is wired into the
  // app whenever the server boots in any non-development runtime. Each of
  // these routes is gated with a 403 at request time, but flagging them on
  // boot makes accidental prod exposure extremely obvious in the logs.
  warnOnDangerousRoutesInNonDev(log);

  const runtimeServices = await startRuntimeServices({ startupBackfillEnabled, startupSyncEnabled, log });
  report.runtimeServices.push(...runtimeServices);
}

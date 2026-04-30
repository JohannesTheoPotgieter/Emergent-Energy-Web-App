import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appSettings } from "@shared/schema";
import { hasBackfillRun, markBackfillComplete } from "./backfills/backfill-registry";

export async function runStartupSeeds(options: {
  startupDataSeedEnabled: boolean;
  allowStartupMutations: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { startupDataSeedEnabled, allowStartupMutations, log } = options;

  if (!startupDataSeedEnabled) return;

  // D6 — Active Clients folder taxonomy. Runs OUTSIDE the startup_seeds_v1
  // one-shot guard so it executes on every boot (idempotent insert keyed
  // on internal_key). New rows added to the seed picked up automatically;
  // admin-edited rows preserved (we only insert when missing).
  try {
    const { seedFolderTaxonomy } = await import("../seed-folder-taxonomy");
    const { inserted, skipped } = await seedFolderTaxonomy();
    log(`[Seed] Folder taxonomy: inserted=${inserted} skipped=${skipped}`, "Startup");
  } catch (err) {
    log(`[Seed] Folder taxonomy error: ${err}`, "Startup");
  }

  // One-time guard: skip the v1 batch if all original seeds have already completed
  if (await hasBackfillRun("startup_seeds_v1")) return;

  const { seedQualityTemplate } = await import("../seed-quality-template");
  await seedQualityTemplate().catch((err) => log(`[Seed] Quality template error: ${err}`, "Startup"));

  const { ensureNcrTables } = await import("../quality-ncr-routes");
  await ensureNcrTables().catch((err) => log(`[Seed] NCR tables error: ${err}`, "Startup"));

  const { seedEngStageTemplates } = await import("../seed-eng-templates");
  await seedEngStageTemplates().catch((err) => log(`[Seed] Eng stage templates error: ${err}`, "Startup"));

  const { seedRoleCredentials } = await import("../role-auth-routes");
  await seedRoleCredentials().catch((err) => log(`[Seed] Role credentials error: ${err}`, "Startup"));

  const { seedTrRegisterData } = await import("../tr-register-routes");
  await seedTrRegisterData().catch((err) => log(`[Seed] TR Register error: ${err}`, "Startup"));

  const { seedIntakeTaskTemplates } = await import("../seed-intake-templates");
  await seedIntakeTaskTemplates().catch((err) => log(`[Seed] Intake templates error: ${err}`, "Startup"));

  const { seedMockIntakeData } = await import("../seed-mock-intake");
  await seedMockIntakeData().catch((err) => log(`[Seed] Mock intake data error: ${err}`, "Startup"));

  const { seedRolePermissions } = await import("../role-management");
  await seedRolePermissions().catch((err) => log(`[Seed] Role permissions error: ${err}`, "Startup"));

  // Task #101 — curated role templates (idempotent upsert).
  const { seedRoleTemplates } = await import("../services/role-template-service");
  await seedRoleTemplates()
    .then(({ inserted, updated }) =>
      log(`[Seed] Role templates: inserted=${inserted} updated=${updated}`, "Startup"),
    )
    .catch((err) => log(`[Seed] Role templates error: ${err}`, "Startup"));

  try {
    const {
      setFeatureFlag,
      getFeatureFlag,
      ensureRolloutFeatureFlags,
      applyOneShotFeatureFlagEnablements,
    } = await import("../lib/feature-flags");
    if (allowStartupMutations) {
      await ensureRolloutFeatureFlags("system");

      // Prompt 0.4 follow-up: apply the 20260415 ready-flag enablement to
      // existing environments whose app_settings rows were seeded `false`
      // before the enablement migration shipped. One-shot and idempotent —
      // a deliberate post-enablement opt-out is preserved (not re-enabled).
      const result = await applyOneShotFeatureFlagEnablements(
        "20260415-ready-flags",
        [
          "onboarding_tour",
          "action_launchpad",
          "cleaned_admin_visibility",
          "micro_walkthrough",
          "role_aware_ux",
        ],
        "system:20260415_enable_ready_feature_flags",
      );
      if (result.applied && result.enabled.length > 0) {
        log(
          `[FeatureFlags] Enabled ready flags on this environment: ${result.enabled.join(", ")}`,
          "Startup",
        );
      }
    }
    const existing = await getFeatureFlag("unified_work_v1");
    if (!existing) {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "unified_work_v1")).limit(1);
      if (allowStartupMutations && !row) {
        await setFeatureFlag("unified_work_v1", true, "system");
      }
    }
  } catch (err: unknown) {
    log(`[Seed] Feature flag seed error: ${(err instanceof Error ? err.message : String(err))}`, "Startup");
  }

  const { bootImportCheck, seedStoryLifecycleData, seedStoryDemoData } = await import("../ee-info-routes");
  await bootImportCheck().catch((err) => log(`[EE-Info] Boot import error: ${err}`, "Startup"));

  try {
    const storyCheck = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ee_info_nodes WHERE stage_code IS NOT NULL AND stage_code != 'DEMO' AND node_type = 'lifecycle_stage'`));
    const storyCount = parseInt(String((storyCheck as any).rows?.[0]?.cnt || "0"));
    if (storyCount === 0) await seedStoryLifecycleData();

    const demoCheck = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ee_info_nodes WHERE stage_code = 'DEMO'`));
    const demoCount = parseInt(String((demoCheck as any).rows?.[0]?.cnt || "0"));
    if (demoCount === 0) await seedStoryDemoData();
  } catch (err) {
    log(`[Story] Seed error (non-fatal): ${err}`, "Startup");
  }

  const { seedEeInfoUpdates } = await import("../seed-ee-info-updates");
  await seedEeInfoUpdates().catch((err) => log(`[EE-Info-Update] Seed error: ${err}`, "Startup"));

  const { seedLessonsLearnt } = await import("../seed-lessons-learnt");
  await seedLessonsLearnt().catch((err) => log(`[Lessons-Learnt] Seed error: ${err}`, "Startup"));

  // Mark all seeds as complete
  await markBackfillComplete("startup_seeds_v1").catch(() => {});
}

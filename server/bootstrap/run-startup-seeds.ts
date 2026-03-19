import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appSettings } from "@shared/schema";

export async function runStartupSeeds(options: {
  startupDataSeedEnabled: boolean;
  allowStartupMutations: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { startupDataSeedEnabled, allowStartupMutations, log } = options;
  if (!startupDataSeedEnabled) return;

  const { seedQualityTemplate } = await import("../seed-quality-template");
  await seedQualityTemplate().catch((err) => log(`[Seed] Quality template error: ${err}`, "Startup"));

  const { seedEngStageTemplates } = await import("../seed-eng-templates");
  await seedEngStageTemplates().catch((err) => log(`[Seed] Eng stage templates error: ${err}`, "Startup"));

  const { seedRoleCredentials } = await import("../role-auth-routes");
  await seedRoleCredentials().catch((err) => log(`[Seed] Role credentials error: ${err}`, "Startup"));

  const { seedTrRegisterData } = await import("../tr-register-routes");
  await seedTrRegisterData().catch((err) => log(`[Seed] TR Register error: ${err}`, "Startup"));

  const { seedEngineeringData } = await import("../seed-engineering");
  await seedEngineeringData().catch((err) => log(`[Seed] Engineering data error: ${err}`, "Startup"));

  const { seedIntakeTaskTemplates } = await import("../seed-intake-templates");
  await seedIntakeTaskTemplates().catch((err) => log(`[Seed] Intake templates error: ${err}`, "Startup"));

  const { seedMockIntakeData } = await import("../seed-mock-intake");
  await seedMockIntakeData().catch((err) => log(`[Seed] Mock intake data error: ${err}`, "Startup"));

  const { seedRolePermissions } = await import("../role-management");
  await seedRolePermissions().catch((err) => log(`[Seed] Role permissions error: ${err}`, "Startup"));

  const { runDataSeedMigration } = await import("../seed-data-migration");
  await runDataSeedMigration().catch((err) => log(`[DataSeed] Migration error: ${err}`, "Startup"));

  try {
    const { setFeatureFlag, getFeatureFlag, ensureRolloutFeatureFlags } = await import("../lib/feature-flags");
    if (allowStartupMutations) {
      await ensureRolloutFeatureFlags("system");
    }
    const existing = await getFeatureFlag("unified_work_v1");
    if (!existing) {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "unified_work_v1")).limit(1);
      if (allowStartupMutations && !row) {
        await setFeatureFlag("unified_work_v1", true, "system");
      }
    }
  } catch (err: any) {
    log(`[Seed] Feature flag seed error: ${err.message}`, "Startup");
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
}

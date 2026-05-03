#!/usr/bin/env tsx
// One-shot seeder for the curated role-template library.
// Used in dev when ENABLE_STARTUP_DATA_SEED is off. In prod the
// orchestrator runs the same function on boot via run-startup-seeds.
import { initializeDatabase } from "../../server/db";

(async () => {
  await initializeDatabase();
  const { seedRoleTemplates } = await import("../../server/services/role-template-service");
  const r = await seedRoleTemplates();
  console.log("[seed] role_templates:", r);
  process.exit(0);
})();

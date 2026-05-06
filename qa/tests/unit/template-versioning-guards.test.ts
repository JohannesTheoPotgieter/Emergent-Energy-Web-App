/**
 * Template-versioning regression guards (§6b)
 *
 * Pins the outcome of the §6b template-governance fix:
 *
 *   1. Schema has `source_template_id` + `template_version_at_hydrate`
 *      columns on project_stage_requirements so we can trace which
 *      template version spawned each row.
 *
 *   2. `hydrateStageChecklist` filters templates by isCurrentVersion=true
 *      (without this filter, edits duplicate requirements) and stamps
 *      the new columns on each inserted row.
 *
 *   3. `diffTemplateVsOpenStages` skips closed stages, returns per-project
 *      add/update/remove buckets.
 *
 *   4. `applyTemplateSync` is gated on COO_ADMIN / CEO_ADMIN and a
 *      ≥10-char reason, writes a `template_sync` row to
 *      project_stage_decisions, recomputes readiness.
 *
 *   5. The sync-preview and sync HTTP endpoints exist, are admin-gated,
 *      and forward the reason.
 *
 *   6. The migration file adding the two columns is committed.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("§6b — schema traceability", () => {
  const schemaText = read("shared/schema/stage-lifecycle.ts");

  it("projectStageRequirements declares sourceTemplateId with FK to stageChecklistTemplates", () => {
    expect(schemaText).toMatch(
      /sourceTemplateId:\s*integer\("source_template_id"\)\.references\(\(\)\s*=>\s*stageChecklistTemplates\.id/,
    );
  });

  it("projectStageRequirements declares templateVersionAtHydrate", () => {
    expect(schemaText).toMatch(
      /templateVersionAtHydrate:\s*integer\("template_version_at_hydrate"\)/,
    );
  });

  it("a migration file for these columns is committed", () => {
    const migrationsDir = path.join(process.cwd(), "migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    const hit = files.some((f) => {
      const text = fs.readFileSync(path.join(migrationsDir, f), "utf8");
      return (
        text.includes('"source_template_id"') &&
        text.includes('"template_version_at_hydrate"') &&
        text.includes('"project_stage_requirements"')
      );
    });
    expect(hit).toBe(true);
  });
});

describe("§6b — hydrate current-version filter + stamping", () => {
  const svc = read("server/services/stage-lifecycle-service.ts");

  it("hydrate filters templates on isCurrentVersion=true", () => {
    expect(svc).toMatch(
      /eq\(stageChecklistTemplates\.stageCode,\s*stageCode\),[\s\S]*?eq\(stageChecklistTemplates\.isActive,\s*true\),[\s\S]*?eq\(stageChecklistTemplates\.isCurrentVersion,\s*true\)/,
    );
  });

  it("hydrate stamps sourceTemplateId + templateVersionAtHydrate on inserts", () => {
    expect(svc).toMatch(/sourceTemplateId:\s*t\.id/);
    expect(svc).toMatch(/templateVersionAtHydrate:\s*t\.version/);
  });
});

describe("§6b — diff + sync service", () => {
  const svc = read("server/services/stage-lifecycle-service.ts");

  it("diffTemplateVsOpenStages is exported", () => {
    expect(svc).toMatch(/export async function diffTemplateVsOpenStages\(/);
  });

  it("diff skips closed stages via CLOSED_STAGE_STATUSES", () => {
    expect(svc).toMatch(/CLOSED_STAGE_STATUSES\.has\(stageStatus\)/);
    expect(svc).toMatch(/snapshot is immutable/);
  });

  it("applyTemplateSync enforces COO/CEO role and ≥10-char reason", () => {
    expect(svc).toMatch(/export async function applyTemplateSync\(/);
    expect(svc).toMatch(/STAGE_REOPEN_ROLES\.has\(actorRole\)/);
    expect(svc).toMatch(/reason\.trim\(\)\.length < 10/);
  });

  it("applyTemplateSync writes a template_sync decision row per touched project", () => {
    expect(svc).toMatch(
      /await db\.insert\(projectStageDecisions\)\.values\(\{[\s\S]*?decisionType:\s*'template_sync'/,
    );
  });

  it("applyTemplateSync recomputes readiness after mutation", () => {
    expect(svc).toMatch(
      /const readiness = computeReadinessPct\(refreshed\)[\s\S]*?\.update\(projectStageInstances\)[\s\S]*?readinessPct:\s*readiness/,
    );
  });
});

describe("§6b — HTTP routes", () => {
  const routes = read("server/routes/template-governance-routes.ts");

  it("imports diff + apply from stage-lifecycle-service", () => {
    expect(routes).toMatch(
      /import\s*\{\s*diffTemplateVsOpenStages,\s*applyTemplateSync\s*\}\s*from\s*"\.\.\/services\/stage-lifecycle-service"/,
    );
  });

  it("GET /sync-preview endpoint exists and is admin-gated", () => {
    expect(routes).toMatch(
      /app\.get\([\s\S]*?"\/api\/templates\/stage-checklist\/:stageCode\/sync-preview"[\s\S]*?isAdmin\(user\.role\)/,
    );
  });

  it("POST /sync endpoint exists, admin-gated, requires ≥10-char reason", () => {
    expect(routes).toMatch(
      /app\.post\([\s\S]*?"\/api\/templates\/stage-checklist\/:stageCode\/sync"[\s\S]*?isAdmin\(user\.role\)[\s\S]*?reason\.trim\(\)\.length < 10/,
    );
  });

  it("POST /sync passes actorRole and reason to applyTemplateSync", () => {
    expect(routes).toMatch(
      /applyTemplateSync\(\{[\s\S]*?actorRole:\s*user\.role,[\s\S]*?reason,?[\s\S]*?\}\)/,
    );
  });
});

/**
 * D6 Phase 2.1 — folder taxonomy seed + repository integration.
 *
 * Touches the real database. Skipped in environments without DATABASE_URL
 * (matches the pattern in canonical-lifecycle-migration-backfill.test.ts).
 *
 * Verifies:
 *   1. seedFolderTaxonomy() inserts the canonical Pattern A + Pattern B
 *      rows, is idempotent on re-run, and the FK / unique constraints
 *      from migration 0038 are present and active.
 *   2. createTaxonomyRow + updateTaxonomyRow + deactivateTaxonomyRow
 *      round-trip through the repo against the real DB.
 *   3. The cycle-prevention guard rejects A -> B -> A re-parenting.
 *   4. document_approval_requirements FK to folder_taxonomy.internal_key
 *      is enforced (insert with bogus key fails).
 *
 * Test rows are namespaced with a `__d6_test__` prefix and cleaned up in
 * afterAll() so the test never leaves drift behind.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import {
  folderTaxonomy,
  documentApprovalRequirements,
} from "@shared/schema/documents";

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("D6 Phase 2.1 — seed + repository integration", () => {
  // We import the server-side modules lazily so the test still loads in
  // environments without DATABASE_URL (vitest evaluates `describe.skip`
  // body but defers `it()` callbacks; module imports at the top would
  // explode on missing env).
  type DbModule = typeof import("../../../server/db");
  type SeedModule = typeof import("../../../server/seed-folder-taxonomy");
  type TaxonomyRepoModule = typeof import("../../../server/repositories/folder-taxonomy-repository");

  let dbMod: DbModule;
  let seedMod: SeedModule;
  let taxonomyRepo: TaxonomyRepoModule;

  const TEST_PREFIX = "__d6_test__";

  beforeAll(async () => {
    dbMod = await import("../../../server/db");
    seedMod = await import("../../../server/seed-folder-taxonomy");
    taxonomyRepo = await import(
      "../../../server/repositories/folder-taxonomy-repository"
    );
  });

  afterAll(async () => {
    if (!dbMod) return;
    // Clean up test rows. Approval requirements first (FK) then taxonomy.
    await dbMod.db
      .delete(documentApprovalRequirements)
      .where(like(documentApprovalRequirements.taxonomyKey, `${TEST_PREFIX}%`));
    await dbMod.db
      .delete(folderTaxonomy)
      .where(like(folderTaxonomy.internalKey, `${TEST_PREFIX}%`));
  });

  it("seeds Pattern A + Pattern B canonical rows (idempotent)", async () => {
    // First run inserts (or skips if already seeded). Second run must skip
    // every row to prove idempotency.
    const first = await seedMod.seedFolderTaxonomy();
    const second = await seedMod.seedFolderTaxonomy();

    expect(first.inserted + first.skipped).toBeGreaterThanOrEqual(35);
    expect(second.inserted).toBe(0);

    // Spot-check the marquee rows from both patterns.
    const construction = await taxonomyRepo.getTaxonomyByKey("07_construction");
    expect(construction).not.toBeNull();
    expect(construction!.lifecycleMode).toBe("full_lifecycle");
    expect(construction!.disciplines.sort()).toEqual(
      ["CONSTRUCTION", "ENGINEERING", "QUALITY"].sort(),
    );

    const preCost = await taxonomyRepo.getTaxonomyByKey("pre_cost_proposal");
    expect(preCost).not.toBeNull();
    expect(preCost!.lifecycleMode).toBe("pre_construction");
  });

  it("createTaxonomyRow / updateTaxonomyRow / deactivateTaxonomyRow round-trip", async () => {
    const key = `${TEST_PREFIX}round_trip`;
    const created = await taxonomyRepo.createTaxonomyRow({
      internalKey: key,
      displayName: "D6 Test — round-trip",
      parentKey: null,
      lifecycleMode: "full_lifecycle",
      stageCode: null,
      disciplines: ["ENGINEERING"],
      description: null,
      sortOrder: 9999,
      active: true,
    });
    expect(created.internalKey).toBe(key);
    expect(created.active).toBe(true);

    const updated = await taxonomyRepo.updateTaxonomyRow(key, {
      displayName: "D6 Test — round-trip (renamed)",
      disciplines: ["ENGINEERING", "QUALITY"],
    });
    expect(updated.displayName).toContain("renamed");
    expect(updated.disciplines.sort()).toEqual(["ENGINEERING", "QUALITY"].sort());

    const deactivated = await taxonomyRepo.deactivateTaxonomyRow(key);
    expect(deactivated.active).toBe(false);
  });

  it("rejects transitive cycle (A -> B -> A) at the repository", async () => {
    const a = `${TEST_PREFIX}cycle_a`;
    const b = `${TEST_PREFIX}cycle_b`;

    await taxonomyRepo.createTaxonomyRow({
      internalKey: a,
      displayName: "Cycle A",
      parentKey: null,
      lifecycleMode: "full_lifecycle",
      stageCode: null,
      disciplines: [],
      description: null,
      sortOrder: 9000,
      active: true,
    });
    await taxonomyRepo.createTaxonomyRow({
      internalKey: b,
      displayName: "Cycle B",
      parentKey: a,
      lifecycleMode: "full_lifecycle",
      stageCode: null,
      disciplines: [],
      description: null,
      sortOrder: 9001,
      active: true,
    });

    await expect(
      taxonomyRepo.updateTaxonomyRow(a, { parentKey: b }),
    ).rejects.toThrow(/cycle/i);
  });

  it("rejects an approval requirement whose taxonomy_key does not exist (FK enforced)", async () => {
    // The route layer also checks this, but we want to prove the DB FK is
    // wired correctly, not just the application guard.
    await expect(
      dbMod.db
        .insert(documentApprovalRequirements)
        .values({
          taxonomyKey: `${TEST_PREFIX}does_not_exist`,
          fileNamePattern: null,
          displayName: "D6 Test — bogus FK",
          description: null,
          approverRoles: ["COO_ADMIN"],
          requiresAllApprovers: false,
          extractSpec: null,
          active: true,
          sortOrder: 0,
        })
        .returning(),
    ).rejects.toThrow();
  });

  it("enforces unique (parentKey null, internalKey) — duplicate insert is rejected", async () => {
    const key = `${TEST_PREFIX}dup_key`;
    await taxonomyRepo.createTaxonomyRow({
      internalKey: key,
      displayName: "D6 Test — duplicate",
      parentKey: null,
      lifecycleMode: "full_lifecycle",
      stageCode: null,
      disciplines: [],
      description: null,
      sortOrder: 0,
      active: true,
    });
    await expect(
      taxonomyRepo.createTaxonomyRow({
        internalKey: key,
        displayName: "Should be rejected",
        parentKey: null,
        lifecycleMode: "full_lifecycle",
        stageCode: null,
        disciplines: [],
        description: null,
        sortOrder: 0,
        active: true,
      }),
    ).rejects.toThrow(/already exists/i);
  });
});

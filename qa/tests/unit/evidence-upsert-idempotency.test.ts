/**
 * Wave-6 audit (2026-05-26) — upsertEvidenceItem idempotency contract.
 *
 * The function was named `upsert*` but the underlying SQL was a plain
 * INSERT — duplicate calls created duplicate rows. Wave 6 added a
 * partial unique index on the natural key and switched the statement
 * to ON CONFLICT DO UPDATE. This test pins:
 *   1. The service code uses an ON CONFLICT clause that matches the
 *      partial unique index from migration 0075.
 *   2. The natural-key columns in the index match the columns in the
 *      ON CONFLICT clause.
 *   3. updated_at is refreshed on conflict.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SERVICE = fs.readFileSync(
  path.join(
    __dirname,
    "../../../server/services/evidence-evaluation-service.ts",
  ),
  "utf8",
);

const MIGRATION = fs.readFileSync(
  path.join(
    __dirname,
    // Wave-6 migration was renumbered to 0077 on rebase after main
    // shipped its own 0075 + 0076 (finance audit V3).
    "../../../migrations/0077_evidence_collected_items_updated_at.sql",
  ),
  "utf8",
);

describe("evidence-collected-items — upsert idempotency", () => {
  it("upsertEvidenceItem uses ON CONFLICT DO UPDATE", () => {
    expect(SERVICE).toMatch(/ON CONFLICT/i);
    expect(SERVICE).toMatch(/DO UPDATE SET/i);
  });

  it("ON CONFLICT key matches the natural-key index columns", () => {
    // Match by listing the columns; whitespace-tolerant.
    const conflictBlock = SERVICE.match(/ON CONFLICT\s*\(([\s\S]*?)\)\s*WHERE/i);
    expect(conflictBlock, "ON CONFLICT block not found").not.toBeNull();
    const cols = conflictBlock![1].toLowerCase();
    for (const c of [
      "project_id",
      "completion_type",
      "source_type",
      "source_ref",
      "coalesce(requirement_key",
      "evidence_type",
    ]) {
      expect(cols, `missing key column in ON CONFLICT: ${c}`).toContain(c);
    }
  });

  it("the partial unique index from migration 0075 has the matching column list", () => {
    expect(MIGRATION).toMatch(/uq_evidence_collected_items_natural_key/i);
    expect(MIGRATION).toMatch(/WHERE\s+"deleted_at"\s+IS\s+NULL/i);
    for (const c of [
      "project_id",
      "completion_type",
      "source_type",
      "source_ref",
      "requirement_key",
      "evidence_type",
    ]) {
      expect(MIGRATION.toLowerCase(), `missing column in index: ${c}`).toContain(c);
    }
  });

  it("updated_at is refreshed on conflict", () => {
    // The DO UPDATE clause must touch updated_at = NOW().
    expect(SERVICE).toMatch(/updated_at\s*=\s*NOW\(\)/i);
  });

  it("created_at is NOT overwritten on conflict (only updated_at refreshes)", () => {
    // Confirm DO UPDATE doesn't set created_at — preserve the original
    // insert timestamp.
    const doUpdateBlock = SERVICE.match(/DO UPDATE SET([\s\S]*?)RETURNING/i);
    expect(doUpdateBlock, "DO UPDATE block not found").not.toBeNull();
    expect(doUpdateBlock![1]).not.toMatch(/\bcreated_at\b\s*=/i);
  });
});

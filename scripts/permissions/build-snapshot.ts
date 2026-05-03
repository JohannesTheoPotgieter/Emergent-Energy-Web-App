#!/usr/bin/env tsx
/**
 * Permission snapshot builder — Task #101.
 *
 * Walks every (role × entity × action) triple through the existing
 * `evaluatePermissionForRole` resolver and writes a deterministic JSON
 * map to `qa/fixtures/permission-snapshot-pre-rework.json`.
 *
 * Used as the cutover gate: `qa/tests/unit/permission-snapshot.test.ts`
 * recomputes the same map after the registry/middleware refactor and
 * asserts byte-equality. A single bit of drift fails CI.
 *
 * Defaults-only mode: roleRecord is empty so we capture pure
 * registry behaviour (not DB-backed overrides). The registry refactor
 * only shuffles code; DB rows are untouched.
 *
 * Run: `npx tsx scripts/permissions/build-snapshot.ts`
 */
import fs from "node:fs";
import path from "node:path";
import { COMPANY_ROLES, ENTITY_PERMISSION_DEFAULTS, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { evaluatePermissionForRole } from "@shared/permission-resolver";

const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

type Snapshot = Record<string, Record<string, Record<PermissionAction, boolean>>>;

function buildSnapshot(): Snapshot {
  const snapshot: Snapshot = {};
  const sortedRoles = [...COMPANY_ROLES].sort();
  const sortedEntities = [...ENTITY_PERMISSION_DEFAULTS]
    .map((r) => r.entity)
    .sort() as PermissionEntity[];

  for (const role of sortedRoles) {
    snapshot[role] = {};
    for (const entity of sortedEntities) {
      const row: Record<PermissionAction, boolean> = {} as any;
      for (const action of ACTIONS) {
        const result = evaluatePermissionForRole({ role, entity, action });
        row[action] = result.allowed;
      }
      snapshot[role][entity] = row;
    }
  }
  return snapshot;
}

function main() {
  const snapshot = buildSnapshot();
  const outPath = path.join(process.cwd(), "qa/fixtures/permission-snapshot-pre-rework.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  const trues = Object.values(snapshot).reduce(
    (n, perRole) =>
      n +
      Object.values(perRole).reduce(
        (m, perEntity) => m + Object.values(perEntity).filter(Boolean).length,
        0,
      ),
    0,
  );
  const total = Object.keys(snapshot).length * ENTITY_PERMISSION_DEFAULTS.length * ACTIONS.length;
  console.log(
    `[snapshot] roles=${Object.keys(snapshot).length} entities=${ENTITY_PERMISSION_DEFAULTS.length} actions=${ACTIONS.length} grants=${trues}/${total}`,
  );
  console.log(`[snapshot] wrote ${outPath}`);
}

main();

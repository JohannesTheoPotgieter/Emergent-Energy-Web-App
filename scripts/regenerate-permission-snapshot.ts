// Helper script to regenerate the permission snapshot fixture after
// adding new entities to the registry. Reads the live ENTITY_PERMISSION_DEFAULTS
// + COMPANY_ROLES, computes the grant map, and writes the JSON fixture.
//
// Run with: npx tsx scripts/regenerate-permission-snapshot.ts
//
// Use cases: adding a new permission entity, role, or action; otherwise
// the canonical fixture must NOT drift (zero-drift gate in
// qa/tests/unit/permission-snapshot-no-drift.test.ts).

import fs from "node:fs";
import path from "node:path";
import {
  COMPANY_ROLES,
  ENTITY_PERMISSION_DEFAULTS,
  type PermissionAction,
  type PermissionEntity,
} from "../shared/schema";
import { evaluatePermissionForRole } from "../shared/permission-resolver";

const ACTIONS: PermissionAction[] = ["view", "edit"];

const out: Record<string, Record<string, Record<string, boolean>>> = {};
const roles = [...COMPANY_ROLES].sort();
const entities = [...ENTITY_PERMISSION_DEFAULTS].map((r) => r.entity).sort() as PermissionEntity[];
for (const role of roles) {
  out[role] = {};
  for (const entity of entities) {
    const row: Record<string, boolean> = {};
    for (const action of ACTIONS) {
      row[action] = evaluatePermissionForRole({ role, entity, action }).allowed;
    }
    out[role][entity] = row;
  }
}

const fixturePath = path.join(process.cwd(), "qa/fixtures/permission-snapshot-pre-rework.json");
fs.writeFileSync(fixturePath, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log(`Wrote ${Object.keys(out).length} roles × ${entities.length} entities × ${ACTIONS.length} actions to ${fixturePath}`);

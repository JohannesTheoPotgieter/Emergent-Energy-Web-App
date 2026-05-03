// Zero-drift gate — Task #101.
//
// Recomputes the (role × entity × action) grant map after the
// canonical-registry refactor and asserts byte-equality against
// qa/fixtures/permission-snapshot-pre-rework.json.
//
// A single bit of drift fails CI, which is the user-facing promise:
// "no user loses access on day one of the rework".

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  COMPANY_ROLES,
  ENTITY_PERMISSION_DEFAULTS,
  type PermissionAction,
  type PermissionEntity,
} from "@shared/schema";
import { evaluatePermissionForRole } from "@shared/permission-resolver";

const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];

function buildMap() {
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
  return out;
}

describe("permission snapshot — zero-drift gate (Task #101)", () => {
  it("post-rework grant map equals pre-rework fixture byte-for-byte", () => {
    const fixturePath = path.join(process.cwd(), "qa/fixtures/permission-snapshot-pre-rework.json");
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const current = buildMap();
    expect(current).toEqual(fixture);
  });

  it("snapshot covers every role and every entity", () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "qa/fixtures/permission-snapshot-pre-rework.json"), "utf8"),
    );
    expect(Object.keys(fixture).length).toBe(COMPANY_ROLES.length);
    for (const role of COMPANY_ROLES) {
      expect(fixture[role]).toBeDefined();
      expect(Object.keys(fixture[role]).length).toBe(ENTITY_PERMISSION_DEFAULTS.length);
    }
  });
});

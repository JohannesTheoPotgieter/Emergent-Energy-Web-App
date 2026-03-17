import { describe, expect, it } from "vitest";
import { checkPermission, normalizeRoleForPermissions } from "@shared/schema";
import { PAGE_REGISTRY, getPermissionEntityForPath } from "@/config/page-registry";

const COO_ROLE = "COO_ADMIN";

const KNOWLEDGE_PATHS = [
  "/ee-info",
  "/leaderboard",
  "/training",
  "/department-scores",
  "/feedback",
] as const;

const KNOWLEDGE_CHILD_ENTITIES = [
  "ee_info_lifecycle",
  "ee_info_departments",
  "ee_info_processes",
  "ee_info_templates",
] as const;

describe("knowledge RBAC consistency", () => {
  it("maps legacy COO aliases into canonical COO_ADMIN", () => {
    expect(normalizeRoleForPermissions("COO")).toBe(COO_ROLE);
    expect(normalizeRoleForPermissions("admin")).toBe(COO_ROLE);
  });

  it("allows COO to view all in-scope knowledge routes shown in navigation", () => {
    for (const path of KNOWLEDGE_PATHS) {
      const route = PAGE_REGISTRY.find((entry) => entry.path === path);
      expect(route, `Missing page registry route for ${path}`).toBeTruthy();
      expect(route?.permissionEntity, `Route ${path} must have permission entity`).toBeTruthy();
      expect(checkPermission(COO_ROLE, route!.permissionEntity!, "view"), `COO must view ${path}`).toBe(true);
    }
  });

  it("removes the knowledge game route and merges department scoring into leaderboard", () => {
    expect(PAGE_REGISTRY.some((entry) => entry.path === "/knowledge-game")).toBe(false);
    expect(PAGE_REGISTRY.find((entry) => entry.path === "/department-scores")?.redirectTo).toBe("/leaderboard?tab=departments");
  });

  it("keeps route-to-permission resolution aligned for knowledge pages", () => {
    for (const path of KNOWLEDGE_PATHS) {
      const entity = getPermissionEntityForPath(path);
      expect(entity, `No entity resolved for ${path}`).toBeTruthy();
      expect(checkPermission(COO_ROLE, entity!, "view"), `COO denied by route guard for ${path}`).toBe(true);
    }
  });

  it("allows COO on all Knowledge child views/entities", () => {
    for (const entity of KNOWLEDGE_CHILD_ENTITIES) {
      expect(checkPermission(COO_ROLE, entity, "view"), `COO must view ${entity}`).toBe(true);
    }
  });

  it("blocks unknown non-authorized role from department scores", () => {
    expect(checkPermission("INTERN", "department_scores", "view")).toBe(false);
  });
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const SERVER_ROOT = path.join(REPO_ROOT, "server");
const CANONICAL_AUTH_ROUTES = path.join(SERVER_ROOT, "routes", "auth-routes.ts");

const AUTH_ROUTE_OWNERS = {
  "/api/auth/login": CANONICAL_AUTH_ROUTES,
  "/api/auth/logout": CANONICAL_AUTH_ROUTES,
  "/api/auth/me": CANONICAL_AUTH_ROUTES,
  "/api/auth/status": CANONICAL_AUTH_ROUTES,
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(fullPath);
    }
    return entry.isFile() && fullPath.endsWith(".ts") ? [fullPath] : [];
  });
}

const serverFiles = listTypeScriptFiles(SERVER_ROOT);

function findRouteOwners(route: string): string[] {
  const matcher = new RegExp(`\\.(?:get|post|put|patch|delete|all)\\(\\s*["'\`]${escapeRegExp(route)}["'\`]`);

  return serverFiles
    .filter((filePath) => matcher.test(fs.readFileSync(filePath, "utf8")))
    .sort();
}

describe("auth route ownership", () => {
  for (const [route, expectedOwner] of Object.entries(AUTH_ROUTE_OWNERS)) {
    it(`keeps ${route} registered only in the canonical auth routes module`, () => {
      expect(findRouteOwners(route)).toEqual([expectedOwner]);
    });
  }
});

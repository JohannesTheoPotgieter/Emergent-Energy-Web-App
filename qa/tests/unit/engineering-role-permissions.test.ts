import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Role and permission enforcement tests for engineering routes.
 *
 * These are static-analysis tests that verify every write route has a
 * permission gate beyond just `requireAuth`. The goal is to catch the
 * bug class where a new route is added with only `requireAuth` and any
 * authenticated user (ACCOUNTANT, HSE_MANAGER, etc.) can modify
 * engineering data.
 *
 * The tests scan route registration patterns in the source files and
 * verify that permission middleware is present.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/** Extracts route registrations from source: app.post("/path", ...middleware...) */
function extractRoutes(source: string): Array<{
  lineNo: number;
  method: string;
  path: string;
  line: string;
}> {
  const lines = source.split("\n");
  const routes: Array<{ lineNo: number; method: string; path: string; line: string }> = [];
  for (const [idx, line] of lines.entries()) {
    const match = line.match(/app\.(get|post|patch|put|delete)\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (match) {
      routes.push({ lineNo: idx + 1, method: match[1].toUpperCase(), path: match[2], line: line.trim() });
    }
    // Also match router.post/get/etc patterns
    const routerMatch = line.match(/router\.(get|post|patch|put|delete)\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (routerMatch) {
      routes.push({ lineNo: idx + 1, method: routerMatch[1].toUpperCase(), path: routerMatch[2], line: line.trim() });
    }
  }
  return routes;
}

/** Permission gate patterns — if any of these appear on the route line, it's gated. */
const GATE_PATTERNS = [
  /requirePermission/,
  /requireAuthority/,
  /requireAdmin/,
  /requireAdminOrEpm/,
  /requireEngineerOrAdmin/,
  /requireRole/,
  /requireEpmChallenge/,
];

function hasGate(line: string): boolean {
  return GATE_PATTERNS.some(p => p.test(line));
}

describe("eng-stage-routes.ts: write routes must have permission gates", () => {
  const source = read("server/eng-stage-routes.ts");
  const routes = extractRoutes(source);
  const writeRoutes = routes.filter(r => r.method !== "GET");

  it("has at least 10 write routes (sanity check)", () => {
    expect(writeRoutes.length).toBeGreaterThanOrEqual(10);
  });

  for (const route of writeRoutes) {
    it(`${route.method} ${route.path} (line ${route.lineNo}) has a permission gate`, () => {
      const gated = hasGate(route.line);
      expect(gated).toBe(true);
    });
  }
});

describe("engineering-routes.ts: write routes must have permission gates", () => {
  const source = read("server/engineering-routes.ts");
  const routes = extractRoutes(source);
  const writeRoutes = routes.filter(r => r.method !== "GET");

  it("has at least 15 write routes (sanity check)", () => {
    expect(writeRoutes.length).toBeGreaterThanOrEqual(15);
  });

  for (const route of writeRoutes) {
    it(`${route.method} ${route.path} (line ${route.lineNo}) has a permission gate`, () => {
      const gated = hasGate(route.line);
      expect(gated).toBe(true);
    });
  }
});

describe("drawing-register-routes.ts: write routes must have role gates", () => {
  const source = read("server/departments/drawing-register-routes.ts");
  const routes = extractRoutes(source);
  const writeRoutes = routes.filter(r => r.method !== "GET");

  it("has at least 3 write routes (sanity check)", () => {
    expect(writeRoutes.length).toBeGreaterThanOrEqual(3);
  });

  for (const route of writeRoutes) {
    it(`${route.method} ${route.path} (line ${route.lineNo}) has a permission gate`, () => {
      const gated = hasGate(route.line);
      expect(gated).toBe(true);
    });
  }
});

describe("eng-stage-routes.ts: critical actions have inline role checks", () => {
  const source = read("server/eng-stage-routes.ts");

  it("deliverable approve checks for self-review", () => {
    // The approve endpoint must prevent self-review
    expect(source).toContain("uploadedBy === user.id");
  });

  it("issue-for-construction checks for self-issue", () => {
    expect(source).toContain("uploadedBy === user.id");
    expect(source).toContain("issue-for-construction");
  });

  it("stage override-complete requires COO", () => {
    expect(source).toContain("isCoo(user.role)");
    expect(source).toContain("COO access required for override");
  });

  it("QA review approval requires QUALITY_MANAGER role", () => {
    expect(source).toContain("QA_REVIEW");
    expect(source).toContain("QA_ROLE");
  });
});

describe("authority model: separation of duties", () => {
  const stageSource = read("server/eng-stage-routes.ts");

  it("deliverable approval prevents the uploader from approving their own file", () => {
    // This is the self-review block
    const approveSection = stageSource.substring(
      stageSource.indexOf('"/api/eng-stages/deliverables/:id/approve"'),
      stageSource.indexOf('"/api/eng-stages/deliverables/:id/approve"') + 2000
    );
    expect(approveSection).toContain("uploadedBy === user.id");
    expect(approveSection).toMatch(/cannot approve your own/i);
  });

  it("IFC issuance prevents the uploader from issuing their own file", () => {
    const ifcSection = stageSource.substring(
      stageSource.indexOf('"/api/eng-stages/deliverables/:id/issue-for-construction"'),
      stageSource.indexOf('"/api/eng-stages/deliverables/:id/issue-for-construction"') + 2000
    );
    expect(ifcSection).toContain("uploadedBy === user.id");
    expect(ifcSection).toMatch(/cannot issue your own/i);
  });

  it("stage gate self-approval is blocked", () => {
    const approvalSection = stageSource.substring(
      stageSource.indexOf('"/api/eng-stages/approvals/:id"'),
      stageSource.indexOf('"/api/eng-stages/approvals/:id"') + 1000
    );
    expect(approvalSection).toContain("createdBy === user.id");
    expect(approvalSection).toMatch(/cannot approve your own stage/i);
  });
});

describe("engineering route permission entities are valid", () => {
  const schemaSource = read("shared/schema/users.ts");

  // Every entity used in requirePermission must exist in PermissionEntity
  const entities = ["eng_stages", "eng_tasks", "deliverables", "engineering", "lifecycle"];

  for (const entity of entities) {
    it(`PermissionEntity includes "${entity}"`, () => {
      expect(schemaSource).toContain(`'${entity}'`);
    });
  }
});

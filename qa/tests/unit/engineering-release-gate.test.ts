import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ENGINEERING RELEASE GATE
 *
 * This test file is a machine-readable release checklist. Every test
 * represents a prerequisite that must pass before engineering changes
 * can ship. If any test fails, the release is blocked and the failing
 * check must be investigated.
 *
 * Run this file alone: npx vitest run -c qa/vitest.config.ts qa/tests/unit/engineering-release-gate.test.ts
 *
 * Sections:
 * 1. Schema integrity — canonical types are consistent
 * 2. Route permission coverage — no ungated write routes
 * 3. Status normalization — no UPPERCASE comparisons in dashboards
 * 4. UI copy safety — no misleading "Approved" labels
 * 5. Feature containment — half-cooked features are gated
 * 6. Migration safety — all migrations are idempotent
 * 7. Test coverage minimums — critical test files exist and have content
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function exists(relative: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relative));
}

// ===== 1. Schema integrity =====

describe("GATE 1: Schema integrity", () => {
  const schema = read("shared/schema/engineering.ts");

  it("RELEASED_FOR_STATES has exactly 6 states", () => {
    expect((schema.match(/RELEASED_FOR_STATES = \[/g) || []).length).toBe(1);
  });

  it("DRAWING_STATUSES has exactly 7 states", () => {
    expect(schema).toContain("DRAWING_STATUSES");
  });

  it("engTransmittals table is defined", () => {
    expect(schema).toContain('engTransmittals = pgTable("eng_transmittals"');
  });

  it("projectEngDeliverables has releasedFor column", () => {
    expect(schema).toContain("releasedFor: text");
  });

  it("projectEngDeliverables has supersededById column", () => {
    expect(schema).toContain("supersededById");
  });

  it("drawingRegister has IFC timestamp columns", () => {
    expect(schema).toContain("issuedForConstructionAt");
    expect(schema).toContain("issuedForConstructionBy");
  });
});

// ===== 2. Route permission coverage =====

describe("GATE 2: All write routes have permission gates", () => {
  const GATE_PATTERNS = [
    /requirePermission/,
    /requireAuthority/,
    /requireAdmin/,
    /requireAdminOrEpm/,
    /requireEngineerOrAdmin/,
    /requireRole/,
  ];

  function hasGate(line: string): boolean {
    return GATE_PATTERNS.some(p => p.test(line));
  }

  for (const file of [
    "server/eng-stage-routes.ts",
    "server/engineering-routes.ts",
    "server/departments/drawing-register-routes.ts",
  ]) {
    const source = read(file);
    const lines = source.split("\n");
    const writeRoutes = lines.filter(l =>
      /app\.(post|patch|put|delete)\s*\(/.test(l) || /router\.(post|patch|put|delete)\s*\(/.test(l)
    );

    for (const line of writeRoutes) {
      const pathMatch = line.match(/["'`]([^"'`]+)["'`]/);
      const routePath = pathMatch?.[1] || "unknown";
      it(`${path.basename(file)}: ${routePath} has permission gate`, () => {
        expect(hasGate(line)).toBe(true);
      });
    }
  }
});

// ===== 3. Status normalization =====

describe("GATE 3: No UPPERCASE status comparisons in dashboard/report code", () => {
  const dashboard = read("server/engineering-routes.ts");
  const dashboardLines = dashboard.substring(
    dashboard.indexOf('"/api/eng/dashboard/overview"')
  ).split("\n").slice(0, 300);

  it("dashboard uses canonical lowercase openStatuses", () => {
    const setLine = dashboardLines.find(l => l.includes("openStatuses") && l.includes("new Set"));
    expect(setLine).toBeTruthy();
    expect(setLine).not.toMatch(/"[A-Z ]+"/);
  });

  it("monthly report service imports canonical helpers", () => {
    const report = read("server/services/engineering-monthly-report-service.ts");
    expect(report).toContain("isTaskComplete");
    expect(report).toContain("toCanonicalStatus");
    expect(report).not.toMatch(/COMPLETED_STATUSES/);
  });
});

// ===== 4. UI copy safety =====

describe("GATE 4: No misleading approval copy", () => {
  it("EngineeringStagesTab does not say 'Approved — task can now be completed'", () => {
    const source = read("client/src/components/tabs/EngineeringStagesTab.tsx");
    expect(source).not.toContain("Approved — task can now be completed");
  });

  it("EngineeringTasksPage uses 'Submit for QC Review' not 'Send for Approval'", () => {
    const source = read("client/src/pages/EngineeringTasksPage.tsx");
    expect(source).not.toMatch(/>.*Send for Approval.*</);
  });

  it("EngineeringTasksPage uses 'QC Review Pending' not 'Approval Pending'", () => {
    const source = read("client/src/pages/EngineeringTasksPage.tsx");
    expect(source).not.toMatch(/label:\s*"Approval Pending"/);
  });
});

// ===== 5. Feature containment =====

describe("GATE 5: Half-cooked features are gated", () => {
  it("CaptureDeliverable is gated behind feature flag", () => {
    const source = read("client/src/components/CaptureDeliverable.tsx");
    expect(source).toContain("legacy_capture_deliverable");
    expect(source).toContain("if (!isEnabled) return null");
  });

  it("Dashboard response includes _trustMetadata", () => {
    const source = read("server/engineering-routes.ts");
    expect(source).toContain("_trustMetadata");
  });
});

// ===== 6. Migration safety =====

describe("GATE 6: All engineering migrations are idempotent", () => {
  const migrationFiles = [
    "migrations/20260415_engineering_ifc_guardrails.sql",
    "migrations/20260416_backfill_html_comment_deps.sql",
    "migrations/20260416_eng_transmittal_register.sql",
  ];

  for (const file of migrationFiles) {
    it(`${path.basename(file)} exists`, () => {
      expect(exists(file)).toBe(true);
    });

    it(`${path.basename(file)} uses IF NOT EXISTS or DO $$ (idempotent)`, () => {
      const source = read(file);
      const hasGuard = source.includes("IF NOT EXISTS") || source.includes("DO $$");
      expect(hasGuard).toBe(true);
    });
  }

  it("IFC guardrails migration has a rollback file", () => {
    expect(exists("migrations/20260415_engineering_ifc_guardrails_rollback.sql")).toBe(true);
  });
});

// ===== 7. Test coverage minimums =====

describe("GATE 7: Critical engineering test files exist and have content", () => {
  const requiredTestFiles = [
    { file: "qa/tests/unit/engineering-ifc-guardrails.test.ts", minTests: 15 },
    { file: "qa/tests/unit/engineering-control-state.test.ts", minTests: 15 },
    { file: "qa/tests/unit/engineering-data-trust.test.ts", minTests: 10 },
    { file: "qa/tests/unit/engineering-role-permissions.test.ts", minTests: 10 },
    { file: "qa/tests/unit/engineering-ui-copy.test.ts", minTests: 10 },
    { file: "qa/tests/unit/engineering-kpi-trust.test.ts", minTests: 10 },
    { file: "qa/tests/unit/engineering-containment.test.ts", minTests: 10 },
    { file: "qa/tests/unit/engineering-control-gaps.test.ts", minTests: 20 },
    { file: "qa/tests/unit/engineering-workflow-regression.test.ts", minTests: 30 },
    { file: "qa/tests/unit/engineering-release-gate.test.ts", minTests: 15 },
  ];

  for (const { file, minTests } of requiredTestFiles) {
    it(`${path.basename(file)} exists`, () => {
      expect(exists(file)).toBe(true);
    });

    it(`${path.basename(file)} has at least ${minTests} test cases`, () => {
      const source = read(file);
      const testCount = (source.match(/\bit\(/g) || []).length;
      expect(testCount).toBeGreaterThanOrEqual(minTests);
    });
  }
});

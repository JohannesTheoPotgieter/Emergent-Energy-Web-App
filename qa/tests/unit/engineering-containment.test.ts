import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Engineering containment tests — verify that half-cooked features are
 * properly gated, labelled, or removed to prevent users from trusting
 * unfinished controls.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("H6: CaptureDeliverable gated behind feature flag", () => {
  const source = read("client/src/components/CaptureDeliverable.tsx");

  it("checks the legacy_capture_deliverable feature flag", () => {
    expect(source).toContain("legacy_capture_deliverable");
  });

  it("returns null when feature flag is off", () => {
    expect(source).toContain("if (!isEnabled) return null");
  });

  it("has a containment comment explaining why it is gated", () => {
    expect(source).toMatch(/CONTAINMENT/);
    expect(source).toMatch(/legacy.*deliverables.*table/i);
  });
});

describe("H6: legacy_capture_deliverable feature flag exists", () => {
  const flags = read("shared/feature-flags.ts");

  it("is defined in FEATURE_FLAG_KEYS", () => {
    expect(flags).toContain('"legacy_capture_deliverable"');
  });

  it("defaults to false (off)", () => {
    expect(flags).toMatch(/key:\s*"legacy_capture_deliverable"[\s\S]*?defaultValue:\s*false/);
  });
});

describe("H1: DrawingRegisterTab dead code removed", () => {
  const source = read("client/src/components/tabs/DrawingRegisterTab.tsx");

  it("does not have an unused STATUSES array", () => {
    expect(source).not.toMatch(/const STATUSES\s*=/);
  });

  it("does not have an unused statusMutation", () => {
    expect(source).not.toContain("statusMutation");
  });

  it("has a comment explaining status transitions are server-side", () => {
    expect(source).toContain("DRAWING_STATUS_TRANSITIONS");
  });
});

describe("H2+H3+H4: Dashboard trust metadata present", () => {
  const source = read("server/engineering-routes.ts");
  const overviewStart = source.indexOf('"/api/eng/dashboard/overview"');
  const overviewEnd = source.indexOf('"/api/eng/dashboard/projects"');
  const overview = source.substring(overviewStart, overviewEnd);

  it("includes _trustMetadata in the response", () => {
    expect(overview).toContain("_trustMetadata");
  });

  it("marks workload as provisional", () => {
    expect(overview).toContain("workload");
    expect(overview).toContain("provisional");
    expect(overview).toContain("Name-based grouping");
  });

  it("marks projectHealthRag as provisional", () => {
    expect(overview).toContain("projectHealthRag");
    expect(overview).toContain("Automated thresholds");
  });

  it("marks warningEngine as provisional", () => {
    expect(overview).toContain("warningEngine");
    expect(overview).toContain("backend-only");
  });
});

describe("H5: Monthly report provisional metrics", () => {
  const source = read("server/services/engineering-monthly-report-service.ts");

  it("includes provisionalMetrics in the report meta", () => {
    expect(source).toContain("provisionalMetrics");
  });

  it("marks deliverables metrics as provisional", () => {
    expect(source).toContain("deliverablesSubmitted");
    expect(source).toContain("legacy deliverableVersions");
  });

  it("marks monthlyCompletionRate as provisional", () => {
    expect(source).toContain("monthlyCompletionRate");
    expect(source).toContain("proxy");
  });
});

describe("H9: empty engineering.routes.ts", () => {
  const source = read("server/routes/engineering.routes.ts");

  it("is effectively empty (only router boilerplate)", () => {
    // Verify it has no actual route handlers
    expect(source).not.toMatch(/router\.(get|post|patch|put|delete)\(/);
    // But it exports a router (harmless)
    expect(source).toContain("export default router");
  });
});

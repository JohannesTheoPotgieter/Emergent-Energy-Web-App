import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isTaskComplete } from "../../../shared/task-status";
import { TASK_STATUSES } from "../../../shared/schema/tasks";

/**
 * Engineering KPI trust tests — verify that every metric in the
 * dashboard and monthly report uses canonical status logic rather
 * than fragile UPPERCASE/heuristic comparisons.
 *
 * These tests catch two classes of bugs:
 * 1. Status comparisons against raw strings instead of canonical helpers
 * 2. Name-based heuristics where ID-based lookups should be used
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("canonical status helpers: isTaskComplete", () => {
  it("recognizes 'complete' as complete", () => {
    expect(isTaskComplete("complete")).toBe(true);
  });

  it("does NOT recognize UPPERCASE 'COMPLETE'", () => {
    // isTaskComplete only accepts canonical lowercase — this ensures
    // callers must normalize first. If your code passes raw DB values,
    // you must call toCanonicalStatus() first.
    expect(isTaskComplete("COMPLETE")).toBe(false);
  });

  it("does NOT recognize 'in_progress' as complete", () => {
    expect(isTaskComplete("in_progress")).toBe(false);
  });

  it("all canonical statuses have a defined complete/not-complete answer", () => {
    for (const s of TASK_STATUSES) {
      expect(typeof isTaskComplete(s)).toBe("boolean");
    }
  });
});

describe("dashboard overview: no UPPERCASE status comparisons", () => {
  const source = read("server/engineering-routes.ts");
  // Extract the dashboard overview function (between the route registration
  // and the response). Lines from the overview endpoint to end of the handler.
  const overviewStart = source.indexOf('"/api/eng/dashboard/overview"');
  const overviewEnd = source.indexOf('"/api/eng/dashboard/projects"');
  const overview = source.substring(overviewStart, overviewEnd);

  it("does not compare status against UPPERCASE string literals", () => {
    const lines = overview.split("\n");
    for (const [idx, line] of lines.entries()) {
      if (line.trim().startsWith("//")) continue;
      // Look for .status === "UPPERCASE_STRING" pattern
      const dangerousMatch = line.match(/\.status\s*===?\s*"([A-Z][A-Z _]+)"/);
      if (dangerousMatch) {
        expect.soft(
          false,
          `Dashboard overview uses UPPERCASE status "${dangerousMatch[1]}" at offset ${idx}: ${line.trim()}`
        ).toBe(true);
      }
    }
  });

  it("uses isTaskComplete() for completion checks", () => {
    expect(overview).toContain("isTaskComplete");
  });

  it("uses canonical lowercase in openStatuses set", () => {
    expect(overview).toContain('"to_do"');
    expect(overview).toContain('"in_progress"');
    expect(overview).not.toContain('"TO DO"');
    expect(overview).not.toContain('"IN PROGRESS"');
  });

  it("uses projectId-based phase lookup, not name heuristic", () => {
    expect(overview).toContain("lookupPhaseById");
    expect(overview).not.toContain("normalizeKey");
  });

  it("totalProjects excludes Unassigned bucket", () => {
    expect(overview).toContain("Unassigned");
    expect(overview).toContain("realProjectCount");
  });
});

describe("monthly report service: canonical status logic", () => {
  const source = read("server/services/engineering-monthly-report-service.ts");

  it("imports isTaskComplete from shared/task-status", () => {
    expect(source).toContain('from "@shared/task-status"');
    expect(source).toContain("isTaskComplete");
  });

  it("imports toCanonicalStatus from work-items-adapter", () => {
    expect(source).toContain("toCanonicalStatus");
  });

  it("does not use COMPLETED_STATUSES constant (replaced by isComplete helper)", () => {
    // The old constant was:
    //   const COMPLETED_STATUSES = ["COMPLETE", "COMPLETED", "DONE"];
    // Ensure it's been removed and replaced with the canonical helper.
    expect(source).not.toMatch(/COMPLETED_STATUSES/);
    expect(source).not.toMatch(/CANCELLED_STATUSES/);
  });

  it("uses isComplete/isActive for status checks, not toUpperCase heuristic", () => {
    expect(source).toContain("isComplete(");
    expect(source).toContain("isActive(");
    // The old pattern was (w.status || "").toUpperCase() — should not appear
    // in status-checking code. Allow it only in the deliverable version
    // section which reads from a different table with different conventions.
    const statusCheckLines = source.split("\n").filter(
      l => l.includes(".toUpperCase()") && !l.trim().startsWith("//") && !l.includes("deliverableVersion")
    );
    // Only the deliverable version events section should use toUpperCase
    for (const line of statusCheckLines) {
      // Allow in the deliverable version filter section only
      if (line.includes("v.status") || line.includes("String(v.status")) continue;
      expect.soft(
        false,
        `Monthly report uses .toUpperCase() outside deliverable section: ${line.trim()}`
      ).toBe(true);
    }
  });

  it("uses toCanonicalStatus for per-project status breakdown", () => {
    expect(source).toContain('toCanonicalStatus(t.status) === "in_progress"');
    // "to_do" and "not_started" are checked via a variable assigned
    // from toCanonicalStatus — verify the function is called at least.
    expect(source).toContain('toCanonicalStatus(t.status)');
    expect(source).toContain('"not_started"');
  });

  it("has metric definition comments for Section 1 KPIs", () => {
    expect(source).toContain("Metric definitions:");
    expect(source).toContain("totalEngineeringTasks:");
    expect(source).toContain("tasksCompletedThisMonth:");
  });
});

describe("dashboard overview: metric definitions exist as comments", () => {
  const source = read("server/engineering-routes.ts");
  const overviewStart = source.indexOf('"/api/eng/dashboard/overview"');
  const overviewEnd = source.indexOf('"/api/eng/dashboard/projects"');
  const overview = source.substring(overviewStart, overviewEnd);

  it("has a comment explaining what totalProjects counts", () => {
    expect(overview).toMatch(/Metric:.*totalProjects/i);
  });
});

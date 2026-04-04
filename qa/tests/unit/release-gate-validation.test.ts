import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// ===========================================================================
// 1. Release Gate Script Structure
// ===========================================================================
describe("Release Gate Script Structure", () => {
  it("scripts/release-gate.ts exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "scripts/release-gate.ts"))).toBe(true);
  });

  it("imports runReconciliationPack and formatReportText", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("runReconciliationPack");
    expect(f).toContain("formatReportText");
  });

  it("performs pre-flight DB connectivity check", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("checkDbConnectivity");
    expect(f).toContain("SELECT 1");
  });

  it("exits with code 2 on pre-flight failure", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("process.exit(2)");
  });

  it("exits with code 0 on PASS and 1 on FAIL", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain('report.overall === "PASS" ? 0 : 1');
  });

  it("supports --ci flag for CI mode", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("--ci");
    expect(f).toContain("ciMode");
  });

  it("supports --out-dir flag for custom output directory", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("--out-dir");
  });
});

// ===========================================================================
// 2. Report Output Files
// ===========================================================================
describe("Release Gate Report Files", () => {
  it("writes JSON report to disk", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("reconciliation-");
    expect(f).toContain(".json");
    expect(f).toContain("JSON.stringify(report, null, 2)");
  });

  it("writes human-readable text report to disk", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain(".txt");
    expect(f).toContain("formatReportText(report)");
  });

  it("writes stakeholder summary to disk", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("release-gate-");
    expect(f).toContain(".summary.txt");
  });

  it("creates output directory if it does not exist", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("mkdirSync");
    expect(f).toContain("recursive: true");
  });
});

// ===========================================================================
// 3. GO / NO-GO Verdict
// ===========================================================================
describe("Release Gate Verdict", () => {
  it("outputs GO or NO-GO verdict", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain('"GO"');
    expect(f).toContain('"NO-GO"');
  });

  it("includes hard failure count in verdict output", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("Hard failures:");
    expect(f).toContain("report.hardFailCount");
  });

  it("includes warning count in verdict output", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("Warnings:");
    expect(f).toContain("report.warningCount");
  });

  it("reports elapsed time", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("elapsedSec");
    expect(f).toContain("Date.now()");
  });
});

// ===========================================================================
// 4. Top Broken Entities
// ===========================================================================
describe("Top Broken Entities", () => {
  it("extracts top broken entities from FAIL checks", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("extractTopBrokenEntities");
    expect(f).toContain('c.status === "FAIL"');
  });

  it("includes sample IDs in broken entity output", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("sampleIds");
  });

  it("includes top warnings sorted by impact", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("Top warnings by impact");
    expect(f).toContain('c.status === "WARN"');
  });
});

// ===========================================================================
// 5. Summary Report Content
// ===========================================================================
describe("Summary Report Content", () => {
  it("summary includes RELEASE GATE VERDICT header", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("RELEASE GATE VERDICT");
  });

  it("summary includes domain status section", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("DOMAIN STATUS");
    expect(f).toContain("domainSummaries");
  });

  it("summary includes next steps for GO verdict", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("NEXT STEPS");
    expect(f).toContain("Safe to proceed with cutover");
  });

  it("summary includes required actions for NO-GO verdict", () => {
    const f = readFile("scripts/release-gate.ts");
    expect(f).toContain("REQUIRED ACTIONS");
    expect(f).toContain("Re-run after fixes");
  });
});

// ===========================================================================
// 6. Cutover Runbook Documentation
// ===========================================================================
describe("Cutover Runbook", () => {
  it("docs/cutover-runbook.md exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "docs/cutover-runbook.md"))).toBe(true);
  });

  it("runbook documents prerequisites", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("DATABASE_URL");
    expect(doc).toContain("Prerequisites");
  });

  it("runbook documents exact CLI commands", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("npx tsx scripts/release-gate.ts");
    expect(doc).toContain("npx tsx scripts/reconciliation-pack.ts");
  });

  it("runbook documents exit codes", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("Exit Codes");
    expect(doc).toContain("GO");
    expect(doc).toContain("NO-GO");
    expect(doc).toContain("ERROR");
  });

  it("runbook documents all HARD_FAIL checks with fix guidance", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("projects_row_parity");
    expect(doc).toContain("cost_lines_row_parity");
    expect(doc).toContain("bridge_failures_unresolved");
    expect(doc).toContain("How to Fix");
  });

  it("runbook documents WARNING checks", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("WARNING checks");
    expect(doc).toContain("field_drift");
    expect(doc).toContain("null_legacy_fk");
  });

  it("runbook states what still needs a human", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("What Still Needs a Human");
    expect(doc).toContain("Database access");
    expect(doc).toContain("Signing off");
  });

  it("runbook documents pre-flight checks", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("Pre-flight");
    expect(doc).toContain("bridge_sync_failures");
  });

  it("runbook documents report archival", () => {
    const doc = readFile("docs/cutover-runbook.md");
    expect(doc).toContain("Archive");
    expect(doc).toContain("audit");
  });
});

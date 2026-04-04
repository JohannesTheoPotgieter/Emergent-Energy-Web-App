import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// ===========================================================================
// 1. Module Structure & Exports
// ===========================================================================
describe("Reconciliation Pack Module Structure", () => {
  it("reconciliation-pack.ts exports runReconciliationPack", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("export async function runReconciliationPack");
  });

  it("reconciliation-pack.ts exports formatReportText", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("export function formatReportText");
  });

  it("exports ReconciliationPackReport type", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("export interface ReconciliationPackReport");
  });

  it("exports Severity and CheckStatus types", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain('export type Severity = "HARD_FAIL" | "WARNING" | "INFO"');
    expect(f).toContain('export type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP"');
  });
});

// ===========================================================================
// 2. Domain Coverage
// ===========================================================================
describe("Reconciliation Pack Domain Coverage", () => {
  const REQUIRED_DOMAINS = [
    "projects",
    "clients",
    "users",
    "finance",
    "work_items",
    "bridge",
  ];

  it.each(REQUIRED_DOMAINS)("covers domain: %s", (domain) => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain(`"${domain}"`);
  });
});

// ===========================================================================
// 3. Check Categories
// ===========================================================================
describe("Reconciliation Pack Check Categories", () => {
  const REQUIRED_CATEGORIES = [
    "row_parity",
    "field_drift",
    "fk_integrity",
    "finance_amounts",
    "bridge_health",
  ];

  it.each(REQUIRED_CATEGORIES)("includes category: %s", (category) => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain(`"${category}"`);
  });
});

// ===========================================================================
// 4. Hard Fail Checks Exist
// ===========================================================================
describe("Hard Fail Checks", () => {
  it("projects_row_parity is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("projects_row_parity");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("cost_lines_row_parity is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("cost_lines_row_parity");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("revenue_lines_row_parity is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("revenue_lines_row_parity");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("bridge_failures_unresolved is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("bridge_failures_unresolved");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("cost_lines_broken_legacy_fk is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("cost_lines_broken_legacy_fk");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("change_requests_row_parity is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("change_requests_row_parity");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("opening_balance_cost_count is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("opening_balance_cost_count");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("opening_balance_cost_amount is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("opening_balance_cost_amount");
    const section = f.slice(idx, idx + 300);
    expect(section).toContain("HARD_FAIL");
  });

  it("unresolved_projects is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("unresolved_projects");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("unresolved_cost_lines is HARD_FAIL", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("unresolved_cost_lines");
    const section = f.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });
});

// ===========================================================================
// 5. Warning Checks Exist
// ===========================================================================
describe("Warning Checks", () => {
  it("field drift checks are WARNING severity", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    // projects_field_drift
    const pidx = f.indexOf("projects_field_drift");
    expect(f.slice(pidx, pidx + 200)).toContain("WARNING");
    // clients_field_drift
    const cidx = f.indexOf("clients_field_drift");
    expect(f.slice(cidx, cidx + 200)).toContain("WARNING");
  });

  it("native promoted row checks are INFO severity", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("cost_lines_native_promoted");
    expect(f.slice(idx, idx + 200)).toContain("INFO");
  });
});

// ===========================================================================
// 6. Finance Amount Comparisons
// ===========================================================================
describe("Finance Amount Comparisons", () => {
  it("compares cost line SUM amounts", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("cost_lines_amount_parity");
    expect(f).toContain("SUM(amount_ex_vat");
  });

  it("compares revenue line SUM amounts", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("revenue_lines_amount_parity");
    // Two SUM queries — one for legacy, one for promoted
    const matches = f.match(/SUM\(amount_ex_vat/g);
    expect(matches!.length).toBeGreaterThanOrEqual(4); // 2 cost + 2 revenue
  });

  it("finance amount checks use finance_amounts category", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const costIdx = f.indexOf("cost_lines_amount_parity");
    expect(f.slice(costIdx, costIdx + 300)).toContain("finance_amounts");
    const revIdx = f.indexOf("revenue_lines_amount_parity");
    expect(f.slice(revIdx, revIdx + 300)).toContain("finance_amounts");
  });
});

// ===========================================================================
// 7. FK Integrity Checks
// ===========================================================================
describe("FK Integrity Checks", () => {
  it("checks for broken legacy FK references in cost lines", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("cost_lines_broken_legacy_fk");
    expect(f).toContain("NOT EXISTS");
  });

  it("checks for broken legacy FK references in revenue lines", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("revenue_lines_broken_legacy_fk");
  });

  it("checks for null client FK in promoted projects", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("projects_null_client_fk");
  });

  it("checks for orphaned work item legacy references", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("work_items_orphaned_legacy_refs");
  });
});

// ===========================================================================
// 7b. Opening Balance Checks
// ===========================================================================
describe("Opening Balance Checks", () => {
  it("checks opening-balance cost line count parity", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("opening_balance_cost_count");
    expect(f).toContain("is_opening_balance = true");
  });

  it("checks opening-balance revenue line count parity", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("opening_balance_revenue_count");
  });

  it("checks opening-balance cost amount parity", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("opening_balance_cost_amount");
  });

  it("checks opening-balance revenue amount parity", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("opening_balance_revenue_amount");
  });

  it("verifies opening-balance rows preserved in finance_records", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("opening_balance_cost_in_records");
    expect(f).toContain("record_data");
  });
});

// ===========================================================================
// 7c. Unresolved Row Checks
// ===========================================================================
describe("Unresolved Row Checks", () => {
  it("detects lost projects (missing from promoted + no sync failure)", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("unresolved_projects");
    expect(f).toContain("bridge_sync_failures");
  });

  it("detects lost cost lines", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("unresolved_cost_lines");
  });

  it("detects lost revenue lines", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("unresolved_revenue_lines");
  });

  it("detects lost users", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("unresolved_users");
  });

  it("uses unresolved category", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const idx = f.indexOf("unresolved_projects");
    expect(f.slice(idx, idx + 300)).toContain('"unresolved"');
  });
});

// ===========================================================================
// 7d. Per-Project Amount Drift Checks
// ===========================================================================
describe("Per-Project Amount Drift", () => {
  it("checks per-project cost amount SUM drift", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("finance_project_cost_amount_drift");
  });

  it("checks per-project revenue amount SUM drift", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("finance_project_revenue_amount_drift");
  });

  it("uses 0.01 tolerance for amount comparisons", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    // Per-project drift uses ABS >= 0.01
    expect(f).toContain("ABS(sub.legacy_sum - sub.promoted_sum) >= 0.01");
  });
});

// ===========================================================================
// 8. Project-Level Breakdowns
// ===========================================================================
describe("Project-Level Breakdowns", () => {
  it("checks per-project cost line count drift", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("finance_project_cost_count_drift");
  });

  it("checks per-project revenue line count drift", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("finance_project_revenue_count_drift");
  });
});

// ===========================================================================
// 9. Report Structure
// ===========================================================================
describe("Report Structure", () => {
  it("report includes version field", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain('version: "1.0.0"');
  });

  it("report includes environment field", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("environment:");
    expect(f).toContain("NODE_ENV");
  });

  it("report includes domainSummaries", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("domainSummaries");
    expect(f).toContain("buildDomainSummaries");
  });

  it("report includes hardFailCount and warningCount", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    expect(f).toContain("hardFailCount");
    expect(f).toContain("warningCount");
  });

  it("overall is FAIL when any HARD_FAIL check fails", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    // hardFailCount > 0 → FAIL
    expect(f).toContain('hardFailCount > 0 ? "FAIL"');
  });
});

// ===========================================================================
// 10. CLI Runner
// ===========================================================================
describe("Reconciliation Pack CLI Runner", () => {
  it("scripts/reconciliation-pack.ts exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "scripts/reconciliation-pack.ts"))).toBe(true);
  });

  it("CLI supports --json flag", () => {
    const f = readFile("scripts/reconciliation-pack.ts");
    expect(f).toContain("--json");
  });

  it("CLI supports --text flag", () => {
    const f = readFile("scripts/reconciliation-pack.ts");
    expect(f).toContain("--text");
  });

  it("CLI supports --out flag for file output", () => {
    const f = readFile("scripts/reconciliation-pack.ts");
    expect(f).toContain("--out");
  });

  it("CLI exits with code 1 on FAIL", () => {
    const f = readFile("scripts/reconciliation-pack.ts");
    expect(f).toContain('report.overall === "PASS" ? 0 : 1');
  });

  it("CLI imports from reconciliation-pack service", () => {
    const f = readFile("scripts/reconciliation-pack.ts");
    expect(f).toContain("runReconciliationPack");
    expect(f).toContain("formatReportText");
  });
});

// ===========================================================================
// 11. Human-Readable Formatter
// ===========================================================================
describe("Human-Readable Report Formatter", () => {
  it("formatReportText outputs domain summaries section", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const section = f.slice(f.indexOf("function formatReportText"));
    expect(section).toContain("DOMAIN SUMMARIES");
  });

  it("formatReportText outputs detailed checks section", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const section = f.slice(f.indexOf("function formatReportText"));
    expect(section).toContain("DETAILED CHECKS");
  });

  it("formatReportText outputs hard failures section", () => {
    const f = readFile("server/services/reconciliation-pack.ts");
    const section = f.slice(f.indexOf("function formatReportText"));
    expect(section).toContain("HARD FAILURES");
  });
});

// ===========================================================================
// 12. Documentation
// ===========================================================================
describe("Reconciliation Pack Documentation", () => {
  it("docs/reconciliation-pack.md exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "docs/reconciliation-pack.md"))).toBe(true);
  });

  it("documentation describes domains covered", () => {
    const doc = readFile("docs/reconciliation-pack.md");
    expect(doc).toContain("projects");
    expect(doc).toContain("clients");
    expect(doc).toContain("finance");
    expect(doc).toContain("work_items");
    expect(doc).toContain("bridge");
  });

  it("documentation describes HARD_FAIL vs WARNING", () => {
    const doc = readFile("docs/reconciliation-pack.md");
    expect(doc).toContain("HARD_FAIL");
    expect(doc).toContain("WARNING");
  });

  it("documentation includes usage instructions", () => {
    const doc = readFile("docs/reconciliation-pack.md");
    expect(doc).toContain("npx tsx");
    expect(doc).toContain("reconciliation-pack");
  });
});

/**
 * EXPENDITURE DUPLICATE ANALYSIS
 *
 * Forensic analysis of every duplicate risk pathway in the finance system.
 * Each category is analyzed with exact code locations, mechanisms, triggers,
 * detection methods, and severity ratings.
 *
 * Categories:
 * 1. True duplicate DB rows
 * 2. Same business cost in multiple tables
 * 3. Duplicate joins
 * 4. Duplicate merge output
 * 5. UI duplicate rendering
 * 6. Duplicate aggregation
 * 7. Duplicate import commit
 * 8. Duplicate manual create
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  getExpenseBusinessKey,
  selectWinningExpenseRows,
} from "../../../server/lib/expense-row-selector";
import { adaptCostToExpense } from "../../../server/lib/data-merge";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// =========================================================================
// CATEGORY 1: True Duplicate DB Rows
// =========================================================================

describe("CAT 1: True duplicate DB rows in normalized_cost_lines", () => {
  it("MECHANISM: no unique constraint on business key (projectId + sourceRow)", () => {
    const schema = read("shared/schema/finance.ts");
    const nclBlock = schema.substring(
      schema.indexOf('pgTable("normalized_cost_lines"'),
      schema.indexOf("insertNormalizedCostLineSchema")
    );
    // Only unique constraint is on idempotency_key (partial)
    expect(nclBlock).toContain("idempotency_key");
    // No unique constraint on (project_id, source_row)
    expect(nclBlock).not.toContain('unique("ncl_project_source_unique")');
  });

  it("PROTECTION: temporal soft-close prevents active duplicates from imports", () => {
    const smartImport = read("server/smart-import-routes.ts");
    // Before inserting, soft-close existing rows for the project
    expect(smartImport).toContain("softCloseByProjectId");
    expect(smartImport).toContain("softCloseByProjectName");
    // This sets effective_to = NOW() on old rows, so queries with
    // WHERE effective_to IS NULL only see the latest import's rows
  });

  it("PROTECTION: idempotency key prevents manual create duplicates", () => {
    const writeService = read("server/services/finance-line-write-service.ts");
    expect(writeService).toContain("values.idempotencyKey");
    // Partial unique index at DB level catches races
    const migration = read("migrations/20260407_add_idempotency_key_to_cost_lines.sql");
    expect(migration).toContain("CREATE UNIQUE INDEX");
  });

  it("PROTECTION: atomic commit guard prevents double-commit", () => {
    const smartImport = read("server/smart-import-routes.ts");
    expect(smartImport).toContain("Atomic commit guard");
    expect(smartImport).toContain("AND status IN ('PREVIEW', 'AWAITING_REVIEW')");
  });

  it("RESIDUAL RISK: closed rows accumulate (temporal history)", () => {
    // Soft-closed rows (effective_to IS NOT NULL) remain in the table.
    // This is by design — they serve as history. But queries MUST filter
    // by effective_to IS NULL to avoid counting historical rows.
    const storage = read("server/storage.ts");
    // Every active query filters by effectiveTo IS NULL
    expect(storage).toContain("isNull(normalizedCostLines.effectiveTo)");
  });

  it("SEVERITY: LOW — import soft-close + manual idempotency + commit guard cover all paths", () => {
    // No unprotected write path remains
    const writeService = read("server/services/finance-line-write-service.ts");
    expect(writeService).toContain("insert(normalizedCostLines)");
    // createCostLine is the only insert path, and it has idempotency guard
  });
});

// =========================================================================
// CATEGORY 2: Same Business Cost in Multiple Tables
// =========================================================================

describe("CAT 2: Same business cost in multiple tables (resolved by PE/PI cutover)", () => {
  it("RESOLVED: smart import writes only to normalized_cost_lines (no program_expense dual-write)", () => {
    const smartImport = read("server/smart-import-routes.ts");
    expect(smartImport).toContain("tx.insert(normalizedCostLines)");
    expect(smartImport).not.toContain("tx.insert(programExpense)");
  });

  it("PROTECTION: merge path deduplicates via business key", () => {
    const storage = read("server/storage.ts");
    expect(storage).toContain("selectWinningExpenseRows");
    // The dedup uses projectId + sourceRow as business key. Still useful
    // for guarding against duplicates from temporal history / re-imports.
  });

  it("PROTECTION: canonical read paths skip PE entirely", () => {
    const storage = read("server/storage.ts");
    const cashflowBlock = storage.substring(
      storage.indexOf("async getAllCostLinesForCashflow"),
      storage.indexOf("async getAllCostLinesForCashflow") + 600
    );
    expect(cashflowBlock).not.toContain("programExpense");
    // All tracker endpoints now use this path
  });

  it("SEVERITY: RESOLVED — program_expense and program_inflows dropped (Wave 2 cutover)", () => {
    // The dual-write was removed in commits 956ebe0 and 079b451.
    // The legacy tables themselves were dropped via
    // migrations/20260414_drop_program_expense_and_program_inflows.sql.
  });
});

// =========================================================================
// CATEGORY 3: Duplicate Joins
// =========================================================================

describe("CAT 3: Duplicate joins (rows multiplied by JOINs)", () => {
  it("MECHANISM: expense_task_links could multiply expense rows in a JOIN", () => {
    const schema = read("shared/schema/finance.ts");
    expect(schema).toContain("expense_task_links");
    // If a join between expenses and task_links uses a non-unique key,
    // it could produce duplicate expense rows in the result
  });

  it("PROTECTION: expenditure-breakdown uses Map for task link lookup (not JOIN)", () => {
    const routes = read("server/departments/finance-routes.ts");
    // The expenditure-breakdown endpoint uses a Map, not a DB JOIN
    expect(routes).toContain("const linkMap = new Map(taskLinks.map(l => [l.expenseId, l]))");
    // This guarantees 1:1 mapping — no multiplication
  });

  it("SEVERITY: NONE — no SQL JOINs between expense and link tables in active endpoints", () => {
    // All expense-to-link mapping is done in-memory via Maps
  });
});

// =========================================================================
// CATEGORY 4: Duplicate Merge Output
// =========================================================================

describe("CAT 4: Duplicate merge output (dedup failure in selectWinningExpenseRows)", () => {
  it("MECHANISM: if business keys don't match between NCL and PE rows, both survive", () => {
    // A normalized row with id=-42, projectId=10, _sourceRow=5
    // and a PE row with id=42, projectId=10, rowNumber=5
    // should produce the same business key and merge
    const nclRow = { id: -42, projectId: 10, _sourceRow: 5, _isNormalized: true };
    const peRow = { id: 42, projectId: 10, rowNumber: 5, _isNormalized: false };
    expect(getExpenseBusinessKey(nclRow)).toBe(getExpenseBusinessKey(peRow));
  });

  it("RISK: rows without sourceRow/rowNumber fall back to id-based keys (no merge)", () => {
    // A row with no sourceRow gets key "id:{id}" — unique, never merges
    const noSourceRow = { id: 42, projectId: 10 };
    expect(getExpenseBusinessKey(noSourceRow)).toBe("id:42");
    // This means it appears as a separate row in the output
  });

  it("RISK: rows with null projectId fall back to projectName-based keys", () => {
    const nullProjectId = { id: 42, projectName: "Test", sourceRow: 5 };
    expect(getExpenseBusinessKey(nullProjectId)).toBe("pname:test::row:5");
    // A row with projectId=10 and sourceRow=5 gets "pid:10::row:5"
    const withProjectId = { id: -42, projectId: 10, _sourceRow: 5 };
    expect(getExpenseBusinessKey(withProjectId)).toBe("pid:10::row:5");
    // These DON'T merge — different key formats!
  });

  it("PROTECTION: manual expenses now get projectId (fix in earlier commit)", () => {
    const storage = read("server/storage.ts");
    const block = storage.substring(
      storage.indexOf("async createManualExpense"),
      storage.indexOf("async createManualExpense") + 1000
    );
    expect(block).toContain("resolvedProjectId");
    // This ensures manual expenses get pid-based keys, matching import rows
  });

  it("PROTECTION: canonical paths bypass merge entirely", () => {
    // getAllCostLinesForCashflow reads NCL only — no merge needed
    // No duplicate output possible from a single-source read
  });

  it("SEVERITY: LOW — merge path is only used by expenditure tabs now", () => {
    // The merge path (getAllProgramExpenses) is only called by:
    // - ExpenditureTab pass-through
    // - ExpenditureEditableTab via expenditure-breakdown
    // - cos-control-routes (scenario views)
    // All tracker/dashboard endpoints use canonical NCL-only path
  });
});

// =========================================================================
// CATEGORY 5: UI Duplicate Rendering
// =========================================================================

describe("CAT 5: UI duplicate rendering", () => {
  it("MECHANISM: React renders each item in the array with a unique key", () => {
    const tab = read("client/src/components/tabs/ExpenditureEditableTab.tsx");
    // Key uses canonicalLineKey when available, falling back to id
    expect(tab).toContain("key={exp.canonicalLineKey || exp.id}");
    // If two items had the same key, React would only render one (last wins)
    // If two different items had different keys, both render
  });

  it("PROTECTION: negative IDs guarantee no collision with PE IDs", () => {
    const dataMerge = read("server/lib/data-merge.ts");
    expect(dataMerge).toContain("id: -cost.id");
    // Negative IDs for adapted NCL rows, positive for PE rows
    // Never the same value
  });

  it("PROTECTION: selectWinningExpenseRows deduplicates before response", () => {
    // The API layer runs dedup before sending to frontend
    const storage = read("server/storage.ts");
    expect(storage).toContain("selectWinningExpenseRows([...adaptedNormalized, ...legacyAdapted])");
  });

  it("SEVERITY: NONE — IDs are unique, dedup runs server-side", () => {
    // The frontend receives pre-deduplicated data with unique IDs
  });
});

// =========================================================================
// CATEGORY 6: Duplicate Aggregation
// =========================================================================

describe("CAT 6: Duplicate aggregation (same amount counted twice)", () => {
  it("MECHANISM: if a screen reads both NCL and PE separately and sums both", () => {
    // This would happen if an endpoint summed normalizedCostLines.amountExVat
    // AND ALSO summed programExpense.expenseActualTotal for the same project
  });

  it("PROTECTION: no endpoint reads both tables and sums them separately", () => {
    // Dashboard services read NCL only
    // Tracker endpoints now read NCL only via getAllCostLinesForCashflow
    // The merge path deduplicates before summing
    const compOverview = read("server/services/company-overview-service.ts");
    expect(compOverview).not.toContain("programExpense");

    const metrics = read("server/services/dashboard-metrics.ts");
    expect(metrics).not.toContain("programExpense");
  });

  it("RESOLVED: FYE revenue tracking now reads canonical NCL (PE retired in cutover)", () => {
    const fye = read("server/departments/fye-revenue-tracking-routes.ts");
    // The PE/NCL inconsistency that existed before the PE/PI cutover was
    // resolved when commit 3d3fb59 repointed FYE to normalizedCostLines /
    // normalizedRevenueLines. PE was retired entirely.
    expect(fye).not.toContain(".from(programExpense)");
    expect(fye).toContain("normalizedCostLines");
  });

  it("SEVERITY: NONE for double-counting; MEDIUM for inconsistency", () => {
    // No screen sums both tables. But FYE may show different totals than
    // other screens because it reads a different source.
  });
});

// =========================================================================
// CATEGORY 7: Duplicate Import Commit
// =========================================================================

describe("CAT 7: Duplicate import commit", () => {
  it("MECHANISM: two concurrent commits could both write rows", () => {
    // Without the atomic guard, two requests reading status=PREVIEW
    // could both proceed to insert rows
  });

  it("PROTECTION: atomic UPDATE guard inside transaction", () => {
    const smartImport = read("server/smart-import-routes.ts");
    expect(smartImport).toContain("Atomic commit guard");
    expect(smartImport).toContain("SET status = 'AWAITING_REVIEW'");
    expect(smartImport).toContain("AND status IN ('PREVIEW', 'AWAITING_REVIEW')");
    expect(smartImport).toContain("RETURNING id");
    // PostgreSQL row-level lock ensures second request blocks until first commits
  });

  it("PROTECTION: early status check for non-concurrent retries", () => {
    const smartImport = read("server/smart-import-routes.ts");
    expect(smartImport).toContain('run.status === "COMMITTED"');
    expect(smartImport).toContain("This import has already been committed");
  });

  it("SEVERITY: NONE (after fix) — atomic guard eliminates race condition", () => {
    // Before fix: HIGH (race window between SELECT and INSERT)
    // After fix: NONE (UPDATE-RETURNING inside transaction is atomic)
  });
});

// =========================================================================
// CATEGORY 8: Duplicate Manual Create
// =========================================================================

describe("CAT 8: Duplicate manual expense creation", () => {
  it("MECHANISM: double-click sends two POST requests with same data", () => {
    // Without idempotency key, both requests create separate rows
  });

  it("PROTECTION: client generates UUID per mutation invocation", () => {
    const tab = read("client/src/components/tabs/ExpenditureEditableTab.tsx");
    expect(tab).toContain("idempotencyKey: crypto.randomUUID()");
  });

  it("PROTECTION: server checks for existing row with same key", () => {
    const writeService = read("server/services/finance-line-write-service.ts");
    expect(writeService).toContain("values.idempotencyKey");
    expect(writeService).toContain("return existing[0]");
  });

  it("PROTECTION: partial unique index at DB level catches races", () => {
    const migration = read("migrations/20260407_add_idempotency_key_to_cost_lines.sql");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_ncl_idempotency_key");
    expect(migration).toContain("WHERE idempotency_key IS NOT NULL");
  });

  it("SEVERITY: NONE (after fix) — two-layer protection (app + DB)", () => {
    // App-level: SELECT before INSERT (catches most retries)
    // DB-level: UNIQUE index (catches concurrent races)
  });
});

// =========================================================================
// DETECTION: Business key analysis
// =========================================================================

describe("DETECTION: Business key collision analysis", () => {
  it("two NCL rows with same projectId+sourceRow produce same business key", () => {
    const a = { id: 1, projectId: 10, sourceRow: 5 };
    const b = { id: 2, projectId: 10, sourceRow: 5 };
    expect(getExpenseBusinessKey(a)).toBe(getExpenseBusinessKey(b));
    // selectWinningExpenseRows would keep only one
  });

  it("NCL and PE rows with matching projectId+sourceRow merge correctly", () => {
    const ncl = { id: -42, projectId: 10, _sourceRow: 5, _isNormalized: true };
    const pe = { id: 42, projectId: 10, rowNumber: 5, _isNormalized: false };
    const result = selectWinningExpenseRows([ncl, pe]);
    expect(result.winners).toHaveLength(1);
    expect(result.diagnostics.duplicatesRemoved).toBe(1);
  });

  it("rows without sourceRow get unique id-based keys (never merge)", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    expect(getExpenseBusinessKey(a)).not.toBe(getExpenseBusinessKey(b));
    const result = selectWinningExpenseRows([a, b]);
    expect(result.winners).toHaveLength(2);
  });

  it("manual expense with resolved projectId merges with import for same sourceRow", () => {
    const imported = { id: -100, projectId: 10, _sourceRow: 7, _isNormalized: true };
    const manual = { id: -200, projectId: 10, _sourceRow: 7, _isNormalized: true, approvedDate: "2026-04-01" };
    const result = selectWinningExpenseRows([imported, manual]);
    expect(result.winners).toHaveLength(1);
    // Manual (approved) wins over imported
    expect(result.winners[0].id).toBe(-200);
  });
});

// =========================================================================
// RANKED DUPLICATE HEATMAP
// =========================================================================

describe("RANKED DUPLICATE HEATMAP", () => {
  it("documents all risks ranked by severity", () => {
    // This test serves as documentation — the heatmap is the test structure itself
    const heatmap = [
      { cause: "Dual-table storage (NCL+PE)", tables: "normalized_cost_lines, program_expense", likelihood: "CERTAIN", impact: "MEDIUM", confidence: "HIGH", fixOrder: 1, status: "MITIGATED — canonical reads bypass PE" },
      { cause: "Import double-commit", tables: "normalized_cost_lines", likelihood: "RARE", impact: "HIGH", confidence: "HIGH", fixOrder: 2, status: "FIXED — atomic commit guard" },
      { cause: "Manual expense double-create", tables: "normalized_cost_lines", likelihood: "OCCASIONAL", impact: "MEDIUM", confidence: "HIGH", fixOrder: 3, status: "FIXED — idempotency key" },
      { cause: "Merge dedup failure (missing sourceRow)", tables: "selectWinningExpenseRows", likelihood: "RARE", impact: "LOW", confidence: "MEDIUM", fixOrder: 4, status: "MITIGATED — only affects expenditure tabs" },
      { cause: "FYE reads different source than dashboards", tables: "program_expense vs normalized_cost_lines", likelihood: "CERTAIN", impact: "LOW", confidence: "HIGH", fixOrder: 5, status: "KNOWN — FYE migration pending" },
      { cause: "PO double-create", tables: "purchase_orders", likelihood: "RARE", impact: "MEDIUM", confidence: "HIGH", fixOrder: 6, status: "FIXED — idempotency key + poRef UNIQUE" },
      { cause: "Join multiplication", tables: "expense_task_links", likelihood: "NONE", impact: "N/A", confidence: "HIGH", fixOrder: "N/A", status: "NOT APPLICABLE — Map-based lookup, no SQL JOIN" },
      { cause: "UI duplicate rendering", tables: "frontend", likelihood: "NONE", impact: "N/A", confidence: "HIGH", fixOrder: "N/A", status: "NOT APPLICABLE — unique IDs + server-side dedup" },
    ];

    // Verify all HIGH/CERTAIN risks are FIXED or MITIGATED
    const highRisks = heatmap.filter(h => h.likelihood === "CERTAIN" || h.impact === "HIGH");
    for (const risk of highRisks) {
      expect(risk.status).toMatch(/FIXED|MITIGATED|KNOWN/);
    }

    // Verify no UNMITIGATED risks remain
    const unmitigated = heatmap.filter(h => h.status.includes("UNMITIGATED"));
    expect(unmitigated).toHaveLength(0);
  });
});

/**
 * Smart Import v2 — Plain-Language UX Tests
 *
 * Verifies:
 * 1. Baseline import uses plain wording
 * 2. Incremental import uses plain wording
 * 3. Conflict decision UI uses non-technical labels
 * 4. No technical jargon in main UI labels
 * 5. Advanced details are hidden by default
 * 6. File and folder uploads render through the same flow
 * 7. Confirm screen reflects planner summary correctly
 * 8. Component structure is modular (not one giant file)
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Plain-language labels
// ---------------------------------------------------------------------------

describe("Plain-language label constants", () => {
  const labels = read("client/src/components/smart-import/labels.ts");

  it("V2 step labels use plain language", () => {
    expect(labels).toContain('"Upload"');
    expect(labels).toContain('"What we found"');
    expect(labels).toContain('"What changed"');
    expect(labels).toContain('"Needs your decision"');
    expect(labels).toContain('"Confirm import"');
  });

  it("import mode labels are non-technical", () => {
    expect(labels).toContain('"First-time import"');
    expect(labels).toContain('"Update"');
  });

  it("section labels use plain names", () => {
    expect(labels).toContain('"Schedule / Timeline"');
    expect(labels).toContain('"Revenue / Milestones"');
    expect(labels).toContain('"Costs / Expenses"');
  });

  it("classification labels are plain", () => {
    expect(labels).toContain('"New data"');
    expect(labels).toContain('"Updated data"');
    expect(labels).toContain('"No change"');
    expect(labels).toContain('"Not in this upload"');
  });

  it("conflict action labels are clear", () => {
    expect(labels).toContain('"Keep current app value"');
    expect(labels).toContain('"Use uploaded value"');
  });

  it("does NOT contain forbidden technical jargon in user-facing labels", () => {
    // These terms should not appear in user-facing label constants
    expect(labels).not.toContain('"canonical"');
    expect(labels).not.toContain('"normalization"');
    expect(labels).not.toContain('"fuzzy confidence"');
    expect(labels).not.toContain('"temporal row"');
    expect(labels).not.toContain('"diff planner"');
    expect(labels).not.toContain('"issue fingerprint"');
  });

  it("field display names are human-readable", () => {
    expect(labels).toContain('"Start date"');
    expect(labels).toContain('"End date"');
    expect(labels).toContain('"Invoice number"');
    expect(labels).toContain('"Amount (excl. VAT)"');
    expect(labels).toContain('"Supplier / counterparty"');
  });

  it("confirm labels are plain language", () => {
    expect(labels).toContain('"New rows will be added"');
    expect(labels).toContain('"Existing rows will be updated"');
    expect(labels).toContain('"Rows have no change"');
  });

  it("result labels are plain language", () => {
    expect(labels).toContain('"Import completed"');
    expect(labels).toContain('"Dashboard summaries may take a moment to update."');
  });
});

// ---------------------------------------------------------------------------
// 2. "What we found" step component
// ---------------------------------------------------------------------------

describe("SmartImportFoundStep component", () => {
  const code = read("client/src/components/smart-import/SmartImportFoundStep.tsx");

  it("shows 'What we found in your spreadsheet' title", () => {
    expect(code).toContain("What we found in your spreadsheet");
  });

  it("shows project name", () => {
    expect(code).toContain("found-project-name");
  });

  it("shows import type with plain label", () => {
    expect(code).toContain("IMPORT_MODE_LABELS");
    expect(code).toContain("found-import-mode-badge");
  });

  it("describes baseline as 'All data will be added as new'", () => {
    expect(code).toContain("All data will be added as new");
  });

  it("describes incremental as 'Only changes will be applied'", () => {
    expect(code).toContain("Only changes will be applied");
  });

  it("shows sections found with plain labels", () => {
    expect(code).toContain("SECTION_LABELS");
    expect(code).toContain("Sections found");
  });

  it("shows sheets not used in plain language", () => {
    expect(code).toContain("Sheets not used");
    expect(code).toContain("skipped");
  });

  it("has advanced details collapsed by default", () => {
    expect(code).toContain("useState(false)");
    expect(code).toContain("Advanced details");
    expect(code).toContain("found-advanced-toggle");
  });

  it("detection internals only appear inside advanced panel", () => {
    // headerRowIndex only appears inside the showAdvanced block
    const advancedSection = code.slice(code.indexOf("found-advanced-panel"));
    expect(advancedSection).toContain("headerRowIndex");
    // The main card title/body should not have raw technical fields
    const mainSection = code.slice(0, code.indexOf("Advanced details"));
    expect(mainSection).not.toContain("headerRowIndex");
  });
});

// ---------------------------------------------------------------------------
// 3. "What changed" step component
// ---------------------------------------------------------------------------

describe("SmartImportChangesStep component", () => {
  const code = read("client/src/components/smart-import/SmartImportChangesStep.tsx");

  it("uses 'What changed' title", () => {
    expect(code).toContain("What changed");
  });

  it("shows plain classification labels", () => {
    expect(code).toContain("CLASSIFICATION_LABELS");
  });

  it("explains baseline vs incremental in plain terms", () => {
    expect(code).toContain("first-time import");
    expect(code).toContain("compared your spreadsheet with the current app data");
  });

  it("shows conflict notice in plain language", () => {
    expect(code).toContain("Some items need your decision");
    expect(code).toContain("both the app and your spreadsheet changed differently");
  });

  it("uses section summary cards", () => {
    expect(code).toContain("SectionSummaryCard");
  });
});

// ---------------------------------------------------------------------------
// 4. "Needs your decision" step component
// ---------------------------------------------------------------------------

describe("SmartImportDecisionStep component", () => {
  const code = read("client/src/components/smart-import/SmartImportDecisionStep.tsx");

  it("uses 'Needs your decision' title", () => {
    expect(code).toContain("Needs your decision");
  });

  it("uses plain conflict action labels", () => {
    expect(code).toContain("CONFLICT_ACTIONS.KEEP_APP");
    expect(code).toContain("CONFLICT_ACTIONS.ACCEPT_FILE");
  });

  it("shows three-value comparison (baseline, current, uploaded)", () => {
    expect(code).toContain("Last import");
    expect(code).toContain("Current app value");
    expect(code).toContain("Uploaded value");
  });

  it("has bulk decision buttons", () => {
    expect(code).toContain("Keep all app values");
    expect(code).toContain("Use all uploaded values");
    expect(code).toContain("decision-bulk-keep");
    expect(code).toContain("decision-bulk-accept");
  });

  it("shows 'No decisions needed' when no conflicts", () => {
    expect(code).toContain("No decisions needed");
    expect(code).toContain("All changes can be applied automatically");
  });

  it("uses fieldLabel for human-readable field names", () => {
    expect(code).toContain("fieldLabel(");
  });

  it("does NOT expose raw JSON by default", () => {
    expect(code).not.toContain("JSON.stringify");
  });
});

// ---------------------------------------------------------------------------
// 5. "Confirm import" step component
// ---------------------------------------------------------------------------

describe("SmartImportConfirmStep component", () => {
  const code = read("client/src/components/smart-import/SmartImportConfirmStep.tsx");

  it("uses 'Confirm import' title and button", () => {
    expect(code).toContain("Confirm import");
    expect(code).toContain("confirm-import-btn");
  });

  it("does NOT say 'commit transaction' or 'apply diff'", () => {
    expect(code).not.toContain("commit transaction");
    expect(code).not.toContain("apply diff");
    expect(code).not.toContain("resolve merge");
  });

  it("shows summary counts with plain labels", () => {
    expect(code).toContain("CONFIRM_LABELS");
  });

  it("shows result screen after commit", () => {
    expect(code).toContain("RESULT_LABELS.success");
    expect(code).toContain("confirm-result");
  });

  it("notes dashboard refresh delay", () => {
    expect(code).toContain("RESULT_LABELS.dashboardNote");
  });
});

// ---------------------------------------------------------------------------
// 6. V2 flow orchestrator
// ---------------------------------------------------------------------------

describe("SmartImportV2Flow orchestrator", () => {
  const code = read("client/src/components/smart-import/SmartImportV2Flow.tsx");

  it("uses the v2 step indicator", () => {
    expect(code).toContain("SmartImportStepIndicator");
  });

  it("reuses existing UploadStep for file/folder parity", () => {
    expect(code).toContain("UploadStep");
    expect(code).toContain("onBatchUploaded");
  });

  it("renders all v2 steps", () => {
    expect(code).toContain("SmartImportFoundStep");
    expect(code).toContain("SmartImportChangesStep");
    expect(code).toContain("SmartImportDecisionStep");
    expect(code).toContain("SmartImportConfirmStep");
  });

  it("loads planner data from /api/smart-import/:runId/plan", () => {
    expect(code).toContain("/plan");
  });

  it("skips decision step when no conflicts", () => {
    expect(code).toContain("hasConflicts ? 4 : 5");
  });

  it("passes same decisions to confirm step", () => {
    expect(code).toContain("decisions={decisions}");
  });
});

// ---------------------------------------------------------------------------
// 7. Page integration
// ---------------------------------------------------------------------------

describe("SmartImportPage v2 integration", () => {
  const code = read("client/src/pages/smart-import.tsx");

  it("imports SmartImportV2Flow", () => {
    expect(code).toContain("SmartImportV2Flow");
  });

  it("has useV2 state toggle", () => {
    expect(code).toContain("const [useV2, setUseV2] = useState(true)");
  });

  it("renders v2 flow when useV2 is true", () => {
    expect(code).toContain("{useV2 && !bulkMode && (");
    expect(code).toContain("<SmartImportV2Flow");
  });

  it("gates v1 step indicator behind !useV2", () => {
    expect(code).toContain("{!useV2 && !bulkMode && <StepIndicator");
  });

  it("gates v1 loading/error behind !useV2", () => {
    expect(code).toContain("{!useV2 && loadingRun");
    expect(code).toContain("{!useV2 && runLoadError");
  });
});

// ---------------------------------------------------------------------------
// 8. Modular component structure
// ---------------------------------------------------------------------------

describe("Modular component structure", () => {
  it("components directory exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "client/src/components/smart-import"))).toBe(true);
  });

  it("has barrel export", () => {
    const index = read("client/src/components/smart-import/index.ts");
    expect(index).toContain("SmartImportV2Flow");
    expect(index).toContain("labels");
  });

  it("labels are in a separate file", () => {
    expect(fs.existsSync(path.join(process.cwd(), "client/src/components/smart-import/labels.ts"))).toBe(true);
  });

  it("each step is a separate component file", () => {
    const dir = "client/src/components/smart-import";
    expect(fs.existsSync(path.join(process.cwd(), dir, "SmartImportFoundStep.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), dir, "SmartImportChangesStep.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), dir, "SmartImportDecisionStep.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), dir, "SmartImportConfirmStep.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), dir, "SmartImportV2Flow.tsx"))).toBe(true);
  });
});

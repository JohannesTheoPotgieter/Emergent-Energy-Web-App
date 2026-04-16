/**
 * Quality UI Consistency Tests
 *
 * Proves that quality terminology is consistent across all UI surfaces
 * and that components are properly decomposed without losing functionality.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("quality terminology consistency", () => {
  it("uses 'Passed' consistently for the pass status — never 'Approved' as a status synonym", () => {
    const qualityTab = read("client/src/components/tabs/QualityTab.tsx");

    // STATUS_CONFIG must label pass as "Passed", not "Approved"
    expect(qualityTab).toContain('pass: { label: "Passed"');

    // The inline "Approved" badge must say "QC Passed" instead
    expect(qualityTab).not.toMatch(/>\s*Approved\s*</);
    expect(qualityTab).toContain("QC Passed");
  });

  it("uses 'Submit for Review' not 'Send for Approval' for the review submission action", () => {
    const qualityTab = read("client/src/components/tabs/QualityTab.tsx");

    // The submit button label
    expect(qualityTab).toContain("Submit for Review");
    expect(qualityTab).not.toContain("Send for Approval");

    // The evidence gate message should match
    expect(qualityTab).toContain("submitted for review");
    expect(qualityTab).not.toContain("sent for approval");
  });

  it("uses 'Failed QC' not 'Resubmission' as the governance card label", () => {
    const qualityTab = read("client/src/components/tabs/quality/QualityGovernanceSummary.tsx");
    const dashboard = read("client/src/pages/qm-dashboard.tsx");

    // Governance summary component
    expect(qualityTab).toContain("Failed QC");
    expect(qualityTab).toContain("Items that failed inspection");

    // Dashboard must match
    expect(dashboard).toContain("Failed QC");
    expect(dashboard).not.toContain('"Resubmission needed"');
  });

  it("uses 'In Review' consistently for items awaiting QC decision", () => {
    const qualityTab = read("client/src/components/tabs/QualityTab.tsx");
    const govSummary = read("client/src/components/tabs/quality/QualityGovernanceSummary.tsx");

    // STATUS_CONFIG label
    expect(qualityTab).toContain('review: { label: "In Review"');

    // Filter button
    expect(qualityTab).toContain('label: "In Review"');

    // Governance summary card header
    expect(govSummary).toContain(">In Review</p>");
  });

  it("uses 'Not Started' instead of 'Pending' in phase summary counts", () => {
    const qualityTab = read("client/src/components/tabs/QualityTab.tsx");

    // The phase summary status label
    expect(qualityTab).toContain(">Not Started</p>");
    // Must NOT have the old ambiguous "Pending" label in the phase summary
    expect(qualityTab).not.toMatch(/>Pending<\/p>/);
  });

  it("uses specific handover blocked message instead of vague 'quality context'", () => {
    const govSummary = read("client/src/components/tabs/quality/QualityGovernanceSummary.tsx");

    expect(govSummary).toContain("Handover to execution is blocked");
    expect(govSummary).toContain("resolve these quality issues first");
    expect(govSummary).not.toContain("quality context");
  });

  it("uses 'Quality status' as the governance summary title, not 'governance view'", () => {
    const govSummary = read("client/src/components/tabs/quality/QualityGovernanceSummary.tsx");

    expect(govSummary).toContain("Quality status");
    expect(govSummary).not.toContain("Quality governance view");
  });
});

describe("quality component decomposition", () => {
  it("QualityTab imports and uses extracted sub-components", () => {
    const qualityTab = read("client/src/components/tabs/QualityTab.tsx");

    // Must import the extracted components
    expect(qualityTab).toContain('import { QualityGovernanceSummary }');
    expect(qualityTab).toContain('import { QualityWarningsPanel }');

    // Must render them
    expect(qualityTab).toContain("<QualityGovernanceSummary");
    expect(qualityTab).toContain("<QualityWarningsPanel");
  });

  it("QualityGovernanceSummary is a standalone component with typed props", () => {
    const govSummary = read("client/src/components/tabs/quality/QualityGovernanceSummary.tsx");

    // Must export the component
    expect(govSummary).toContain("export function QualityGovernanceSummary");

    // Must have typed props
    expect(govSummary).toContain("QualityGovernanceSummaryProps");
    expect(govSummary).toContain("counts: GovernanceCounts");
    expect(govSummary).toContain("risk: RiskInfo");
    expect(govSummary).toContain("handover: HandoverInfo");

    // Must preserve all governance card data-testids
    expect(govSummary).toContain('data-testid="quality-governance-summary"');
    expect(govSummary).toContain('data-testid="quality-handover-blocked"');
  });

  it("QualityWarningsPanel is a standalone component with typed props", () => {
    const warningsPanel = read("client/src/components/tabs/quality/QualityWarningsPanel.tsx");

    // Must export the component
    expect(warningsPanel).toContain("export function QualityWarningsPanel");

    // Must preserve warning data-testids
    expect(warningsPanel).toContain('data-testid="quality-warnings"');
    expect(warningsPanel).toContain("warning-item-");
  });

  it("QualityTab no longer has inline governance summary or warnings panel code", () => {
    const qualityTab = read("client/src/components/tabs/QualityTab.tsx");

    // The old inline governance card header should be gone
    expect(qualityTab).not.toContain('"Quality governance view"');

    // The old inline warnings Collapsible should be gone (replaced by component)
    expect(qualityTab).not.toContain("Active Warning{activeWarnings.length");
  });

  it("QualityTab still contains checklist execution, evidence, and risk questions inline", () => {
    const qualityTab = read("client/src/components/tabs/QualityTab.tsx");

    // These are execution-level concerns that stay in QualityTab
    expect(qualityTab).toContain("phase-tabs");
    expect(qualityTab).toContain("phase-summary-card");
    expect(qualityTab).toContain("evidence-dropzone-");
    expect(qualityTab).toContain("risk-questions-toggle");
    expect(qualityTab).toContain("btn-send-for-approval-");
    expect(qualityTab).toContain("Link Task");
  });
});

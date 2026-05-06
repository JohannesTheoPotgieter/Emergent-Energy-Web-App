/**
 * Excel-update-request mail body — pure body-shape tests.
 *
 * Recipient lookup, in-app notification dispatch, and Graph send are
 * tested at the integration level (mocked outlook + DB) — the unit
 * here pins the body shape so a regression in the wording or the
 * deep link fails loudly.
 */
import { describe, expect, it } from "vitest";
import {
  buildExcelUpdateMail,
  EXCEL_UPDATE_RECIPIENT_ROLES,
  type ExcelUpdateEntry,
} from "../../../server/services/excel-update-request-mailer";

const baseInput = {
  projectId: 42,
  projectName: "Acme Solar Phase 2",
  reason: "Vendor invoice arrived after the import; app value reflects the actual paid amount.",
  requesterName: "Janet Operator",
  baseUrl: "https://app.emergentenergy.co.za",
} as const;

const entry = (table: ExcelUpdateEntry["table"], rowId: number, fieldName: string): ExcelUpdateEntry => ({
  table, rowId, fieldName,
});

describe("Excel-update-request mail body", () => {
  it("targets exactly the three workbook-owning roles", () => {
    expect([...EXCEL_UPDATE_RECIPIENT_ROLES]).toEqual([
      "PROGRAM_MANAGER",
      "PROGRAM_FINANCE_MANAGER",
      "CONSTRUCTION_MANAGER",
    ]);
  });

  it("subject for keep_app says action required and names the project", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "keep_app",
      section: "EXPENDITURE",
      entries: [entry("normalized_cost_lines", 1, "amountExVat")],
    });
    expect(out.subject).toContain("[Action required]");
    expect(out.subject).toContain("Acme Solar Phase 2");
    expect(out.subject).toContain("1 field");
  });

  it("subject for request_approval says approval requested", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "request_approval",
      section: "REVENUE",
      entries: [entry("normalized_revenue_lines", 1, "paidDate")],
      requestId: 99,
    });
    expect(out.subject).toContain("[Approval requested]");
    expect(out.subject).toContain("Acme Solar Phase 2");
  });

  it("body lists distinct field names sorted, with row count", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "keep_app",
      section: "EXPENDITURE",
      entries: [
        entry("normalized_cost_lines", 1, "amountExVat"),
        entry("normalized_cost_lines", 1, "vatAmount"),
        entry("normalized_cost_lines", 2, "amountExVat"),
      ],
    });
    expect(out.fields).toEqual(["amountExVat", "vatAmount"]);
    expect(out.rowCount).toBe(2);
    expect(out.bodyHtml).toContain("3 field(s) across 2 row(s)");
  });

  it("body includes the per-project deep link", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "keep_app",
      section: "PLAN",
      entries: [entry("work_items", 7, "endDate")],
    });
    expect(out.bodyHtml).toContain("https://app.emergentenergy.co.za/projects/42/excel-vs-app");
    expect(out.bodyText).toContain("https://app.emergentenergy.co.za/projects/42/excel-vs-app");
  });

  it("body includes the operator's reason and name", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "keep_app",
      section: "EXPENDITURE",
      entries: [entry("normalized_cost_lines", 1, "amountExVat")],
    });
    expect(out.bodyHtml).toContain("Janet Operator");
    expect(out.bodyHtml).toContain("Vendor invoice arrived");
  });

  it("falls back to a generic operator name when none provided", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      requesterName: null,
      resolveAction: "keep_app",
      section: "EXPENDITURE",
      entries: [entry("normalized_cost_lines", 1, "amountExVat")],
    });
    expect(out.bodyHtml).toContain("An operator");
  });

  it("renders 'multiple sections' label when section is MIXED", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "keep_app",
      section: "MIXED",
      entries: [
        entry("normalized_cost_lines", 1, "amountExVat"),
        entry("normalized_revenue_lines", 1, "paidDate"),
      ],
    });
    expect(out.bodyHtml).toContain("multiple sections");
  });

  it("includes the approval request id when given", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "request_approval",
      section: "PLAN",
      entries: [entry("work_items", 7, "endDate")],
      requestId: 12345,
    });
    expect(out.bodyHtml).toContain("12345");
    expect(out.bodyText).toContain("12345");
  });

  it("trims trailing slash on baseUrl when building the link", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      baseUrl: "https://app.emergentenergy.co.za/",
      resolveAction: "keep_app",
      section: "EXPENDITURE",
      entries: [entry("normalized_cost_lines", 1, "amountExVat")],
    });
    expect(out.bodyHtml).toContain("https://app.emergentenergy.co.za/projects/42/excel-vs-app");
    expect(out.bodyHtml).not.toContain("//projects/");
  });

  it("escapes HTML in user-supplied strings", () => {
    const out = buildExcelUpdateMail({
      ...baseInput,
      projectName: "Evil <script>alert(1)</script> Project",
      reason: "She said \"keep it\" & we agreed",
      requesterName: "Bob <Boss>",
      resolveAction: "keep_app",
      section: "EXPENDITURE",
      entries: [entry("normalized_cost_lines", 1, "amountExVat")],
    });
    expect(out.bodyHtml).not.toContain("<script>alert(1)</script>");
    expect(out.bodyHtml).toContain("Evil &lt;script&gt;");
    expect(out.bodyHtml).toContain("&quot;keep it&quot;");
    expect(out.bodyHtml).toContain("Bob &lt;Boss&gt;");
  });

  it("caps the field list in the body and indicates overflow", () => {
    const many: ExcelUpdateEntry[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(entry("normalized_cost_lines", i, `field_${String(i).padStart(2, "0")}`));
    }
    const out = buildExcelUpdateMail({
      ...baseInput,
      resolveAction: "keep_app",
      section: "EXPENDITURE",
      entries: many,
    });
    expect(out.fields.length).toBe(25);
    expect(out.bodyHtml).toContain("and 5 more");
    expect(out.bodyText).toContain("and 5 more");
  });
});

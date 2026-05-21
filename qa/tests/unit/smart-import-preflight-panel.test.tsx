// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { SmartImportPreflightPanel } from "@/components/smart-import/SmartImportPreflightPanel";

describe("SmartImportPreflightPanel", () => {
  it("renders commit warning reason/cause payloads returned by the executor", () => {
    cleanup();
    render(
      <SmartImportPreflightPanel
        variant="post-commit"
        rowWarnings={[
          {
            section: "EXPENDITURE",
            reason: "duplicate_row_hash",
            cause: "Duplicate EXPENDITURE row within this import: same description, invoice amount, invoice number, and invoice date. Second occurrence skipped to avoid double counting.",
            ref: "row:375",
            sourceSheet: "Expenditure Breakdown",
            sourceRow: 375,
          } as any,
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("preflight-group-commit-warnings"));

    expect(screen.getByText(/\[EXPENDITURE:duplicate_row_hash\]/)).toBeTruthy();
    expect(screen.getByText(/same description, invoice amount, invoice number, and invoice date/)).toBeTruthy();
    expect(screen.getByText(/Expenditure Breakdown R375/)).toBeTruthy();
    expect(screen.getByText(/row:375/)).toBeTruthy();
  });
});

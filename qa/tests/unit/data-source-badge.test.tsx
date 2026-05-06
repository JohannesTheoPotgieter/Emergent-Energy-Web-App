// @vitest-environment jsdom
/**
 * EE-QA-022 — DataSourceBadge contract.
 *
 * Locks the four canonical data-origin states + the unknown fallback so
 * future edits to the wire shape can't silently swap a row's badge.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataSourceBadge } from "@/components/finance/DataSourceBadge";

describe("DataSourceBadge", () => {
  it("renders 'Imported' for source='imported'", () => {
    render(<DataSourceBadge source="imported" />);
    expect(screen.getByText("Imported")).toBeTruthy();
    expect(screen.getByTestId("data-source-badge-imported")).toBeTruthy();
  });

  it("renders 'Imported · Edited' for source='imported_edited'", () => {
    render(<DataSourceBadge source="imported_edited" />);
    expect(screen.getByText("Imported · Edited")).toBeTruthy();
  });

  it("renders 'Manual' for source='manual'", () => {
    render(<DataSourceBadge source="manual" />);
    expect(screen.getByText("Manual")).toBeTruthy();
  });

  it("renders 'Override' when overridden=true regardless of source", () => {
    render(<DataSourceBadge source="imported" overridden />);
    expect(screen.getByText("Override")).toBeTruthy();
    expect(screen.queryByText("Imported")).toBeNull();
  });

  it("renders unknown placeholder when source is null", () => {
    render(<DataSourceBadge source={null} />);
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByTestId("data-source-badge-unknown")).toBeTruthy();
  });

  it("renders unknown placeholder for unrecognised source values", () => {
    render(<DataSourceBadge source="some-future-source" />);
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("normalises case in source values", () => {
    render(<DataSourceBadge source="IMPORTED" />);
    expect(screen.getByText("Imported")).toBeTruthy();
  });

  it("respects custom testId", () => {
    render(<DataSourceBadge source="manual" testId="my-custom-id" />);
    expect(screen.getByTestId("my-custom-id")).toBeTruthy();
  });

  it("appends detail text to the title attribute", () => {
    render(<DataSourceBadge source="imported_edited" detail="Last edited 03/05/2026 by COO." />);
    const el = screen.getByText("Imported · Edited");
    expect(el.getAttribute("title")).toContain("Last edited 03/05/2026 by COO.");
  });
});

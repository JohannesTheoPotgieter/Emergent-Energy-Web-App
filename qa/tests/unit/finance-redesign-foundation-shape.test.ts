/**
 * Finance visual redesign — foundation contract test.
 *
 * Pins the public surface of the new shared components so a later
 * refactor cannot silently break the per-page migrations downstream.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Finance visual redesign — PageHero", () => {
  const src = read("client/src/components/finance/PageHero.tsx");

  it("exports the component with the documented prop names", () => {
    expect(src).toContain("export function PageHero");
    expect(src).toContain("eyebrow?");
    expect(src).toContain("label:");
    expect(src).toContain("value:");
    expect(src).toContain("supporting?");
    expect(src).toContain("trust?");
    expect(src).toContain("actions?");
  });

  it("supports four tones for the value", () => {
    expect(src).toMatch(/"default"\s*\|\s*"positive"\s*\|\s*"warning"\s*\|\s*"critical"/);
  });

  it("uses tabular-nums on the headline value", () => {
    expect(src).toContain("tabular-nums");
  });
});

describe("Finance visual redesign — KpiTile", () => {
  const src = read("client/src/components/finance/KpiTile.tsx");

  it("exports the component with click + href interaction options", () => {
    expect(src).toContain("export function KpiTile");
    expect(src).toContain("onClick?");
    expect(src).toContain("href?");
  });

  it("renders as a real <button> when onClick is supplied", () => {
    expect(src).toContain('<button');
    expect(src).toContain('type="button"');
  });

  it("forwards valueAriaLabel to the value element", () => {
    expect(src).toContain('"aria-label": valueAriaLabel');
  });

  it("supports an optional progress bar", () => {
    expect(src).toContain("progress?:");
    expect(src).toContain("pct");
  });

  it("supports optional icon / sourceBadge / description / delta slots (wave 4c)", () => {
    expect(src).toContain("icon?:");
    expect(src).toContain("sourceBadge?:");
    expect(src).toContain("description?:");
    expect(src).toContain("delta?:");
    expect(src).toContain("KpiTileDelta");
  });

  it("delta arrows carry an aria-label so direction is announced", () => {
    expect(src).toMatch(/aria-label=\{delta\.pct > 0\s*\?\s*"increase"/);
  });

  it("supports an optional sparkline slot (wave 4d)", () => {
    expect(src).toContain("sparkline?:");
    expect(src).toContain("KpiTileSparkline");
    expect(src).toContain('data-testid="kpi-tile-sparkline"');
  });
});

describe("Finance visual redesign — DirectionDelta", () => {
  const src = read("client/src/components/finance/DirectionDelta.tsx");

  it("exports the component with positiveIs semantics", () => {
    expect(src).toContain("export function DirectionDelta");
    expect(src).toMatch(/"bad"\s*\|\s*"good"\s*\|\s*"neutral"/);
  });

  it("renders ▲ / ▼ / · direction arrows", () => {
    expect(src).toContain('"▲"');
    expect(src).toContain('"▼"');
    expect(src).toContain('"·"');
  });

  it("carries an aria-label for the direction so screen readers announce it", () => {
    expect(src).toContain('aria-label={directionLabel}');
  });

  it("returns an em dash for null / non-numeric input", () => {
    expect(src).toMatch(/>—<\/span>/);
  });
});

describe("Finance visual redesign — SectionCard", () => {
  const src = read("client/src/components/finance/SectionCard.tsx");

  it("exports the component with header + footer slots", () => {
    expect(src).toContain("export function SectionCard");
    expect(src).toContain("title?");
    expect(src).toContain("description?");
    expect(src).toContain("metaRight?");
    expect(src).toContain("footer?");
  });

  it("uses hairline borders + bg-slate-50 for the footer", () => {
    expect(src).toContain("border-slate-200");
    expect(src).toContain("bg-slate-50");
  });
});

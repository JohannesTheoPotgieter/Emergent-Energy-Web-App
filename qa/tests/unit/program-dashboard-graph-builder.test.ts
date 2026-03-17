import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("program dashboard graph builder", () => {
  it("keeps workbook-aligned chart datasets in the program dashboard API", () => {
    const source = read("server/routes.ts");

    expect(source).toContain('id: "monthlyForecast"');
    expect(source).toContain('id: "weeklyCashflow"');
    expect(source).toContain('id: "phaseSummary"');
    expect(source).toContain('id: "milestonePipeline"');
    expect(source).toContain('id: "constructionWindow"');
    expect(source).toContain('title: "Portfolio Gantt Chart"');
    expect(source).toContain("charts: chartDatasets");
  });

  it("keeps the execution dashboard graph builder and workbook preset labels wired in the UI", () => {
    const source = read("client/src/pages/dashboard.tsx");

    expect(source).toContain("Workbook-aligned Program Dashboard");
    expect(source).toContain("Build graphs from imported execution data");
    expect(source).toContain('data-testid="execution-graph-builder"');
    expect(source).toContain('testId="program-preset-chart"');
    expect(source).toContain('testId="execution-builder-chart"');
    expect(source).toContain("Load current preset");
  });
});

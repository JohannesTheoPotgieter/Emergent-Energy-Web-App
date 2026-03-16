import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("finance route canonicalization", () => {
  it("keeps legacy finance paths as redirects to canonical workspaces", () => {
    const revenue = PAGE_REGISTRY.find((page) => page.path === "/revenue");
    const cosControl = PAGE_REGISTRY.find((page) => page.path === "/cos-control");
    const cashflowForecast = PAGE_REGISTRY.find((page) => page.path === "/cashflow-forecast");

    expect(revenue?.redirectTo).toBe("/revenue-tracker");
    expect(revenue?.routeComponentKey).toBeUndefined();
    expect(cosControl?.redirectTo).toBe("/cos");
    expect(cashflowForecast?.redirectTo).toBe("/cashflow");
  });

  it("retargets quick actions, tours, and EE info links to canonical finance paths", () => {
    const homeBrief = read("client/src/config/home-brief.ts");
    const screenTours = read("client/src/data/screen-tours.ts");
    const walkthroughs = read("client/src/data/walkthroughs.ts");
    const eeInfo = read("client/src/pages/ee-info.tsx");

    expect(homeBrief).toContain('path: "/cos"');
    expect(homeBrief).not.toContain('path: "/cos-control"');

    expect(screenTours).toContain('"/cos": {');
    expect(screenTours).not.toContain('"/cos-control": {');

    expect(walkthroughs).not.toContain('targetPage: "/cos-control"');
    expect(walkthroughs).not.toContain('targetPage: "/revenue"');
    expect(walkthroughs).toContain('targetPage: "/revenue-tracker"');

    expect(eeInfo).not.toContain('path: "/cos-control"');
    expect(eeInfo).not.toContain('path: "/cashflow-forecast"');
    expect(eeInfo).not.toContain('path: "/revenue"');
    expect(eeInfo).toContain('path: "/cos"');
    expect(eeInfo).toContain('path: "/cashflow"');
    expect(eeInfo).toContain('path: "/revenue-tracker"');
  });
});

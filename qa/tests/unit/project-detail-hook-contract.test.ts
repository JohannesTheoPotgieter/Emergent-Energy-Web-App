import { describe, expect, it } from "vitest";
import fs from "node:fs";

const SOURCE_PATH = "client/src/pages/project-detail.tsx";

describe("Project detail hook contract", () => {
  it("declares chip destination hook before early-return guard states", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf8");

    const chipHook = source.indexOf(
      "const chipDestinations = useMemo(() => buildProjectSummaryChipDestinations(projectName), [projectName]);",
    );
    const missingProjectGuard = source.indexOf("if (!projectName) {");
    const loadingGuard = source.indexOf("if (programDataLoading) {");
    const notFoundGuard = source.indexOf("if (projectsSummary && !projectInfo) {");

    expect(chipHook).toBeGreaterThan(-1);
    expect(missingProjectGuard).toBeGreaterThan(-1);
    expect(loadingGuard).toBeGreaterThan(-1);
    expect(notFoundGuard).toBeGreaterThan(-1);

    expect(chipHook).toBeLessThan(missingProjectGuard);
    expect(chipHook).toBeLessThan(loadingGuard);
    expect(chipHook).toBeLessThan(notFoundGuard);
  });

  it("keeps the default department/subtab on PM plan route", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf8");

    expect(source).toContain('const [activeDept, setActiveDept] = useState<string>(resolvedFromUrl?.dept || "pm")');
    expect(source).toContain('const [activeSubTab, setActiveSubTab] = useState<string>(resolvedFromUrl?.subTab || "plan")');
  });
});

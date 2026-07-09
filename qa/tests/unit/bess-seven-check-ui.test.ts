/**
 * Task 1.3 (client) — BESS 7-check panel surfaces the checklist + CM
 * countersignature on the commissioning stage workspace.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PANEL = fs.readFileSync(path.join(process.cwd(), "client/src/components/quality/BessSevenCheckPanel.tsx"), "utf8");
const STAGE = fs.readFileSync(path.join(process.cwd(), "client/src/components/stage-workspaces/Stage7Commissioning.tsx"), "utf8");

describe("BessSevenCheckPanel", () => {
  it("fetches the BESS 7-check for the project", () => {
    expect(PANEL).toContain("/bess-seven-check`");
  });

  it("only renders for hybrid/BESS projects", () => {
    expect(PANEL).toContain("!data?.applies) return null");
  });

  it("offers seed + countersign actions", () => {
    expect(PANEL).toContain("/bess-seven-check/seed`");
    expect(PANEL).toContain("/countersign`");
    expect(PANEL).toContain("data-testid={`bess-countersign-${item.id}`}");
  });

  it("disables countersign until the item is Eng-Lead approved", () => {
    expect(PANEL).toContain('item.status !== "approved" && item.status !== "closed"');
  });

  it("is mounted on the commissioning stage workspace", () => {
    expect(STAGE).toContain("<BessSevenCheckPanel projectId={projectId} />");
  });
});

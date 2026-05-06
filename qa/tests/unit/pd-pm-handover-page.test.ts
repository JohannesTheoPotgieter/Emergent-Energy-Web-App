import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/pd-pm-handover-v2.tsx"), "utf8");

describe("pd pm handover page (v2)", () => {
  it("keeps the existing route and primary handover actions", () => {
    expect(source).toContain('useRoute("/pd/handover/:projectId")');
    expect(source).toContain("Save Draft");
    expect(source).toContain("Submit for PM Review");
    expect(source).toContain("Accept");
    expect(source).toContain("Reject");
  });
});

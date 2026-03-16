import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/pd-pm-handover.tsx"), "utf8");

describe("pd pm handover page", () => {
  it("keeps the existing route and primary handover actions", () => {
    expect(source).toContain('useRoute("/pd/handover/:projectId")');
    expect(source).toContain("Save Draft");
    expect(source).toContain("Submit for PM Review");
    expect(source).toContain("Accept Handover");
    expect(source).toContain("Reject Handover");
  });

  it("surfaces intake, Microsoft-linked context, and audit trail on the same PD workspace", () => {
    expect(source).toContain("Intake and PD source context");
    expect(source).toContain("Microsoft");
    expect(source).toContain("Recent handover activity");
  });
});

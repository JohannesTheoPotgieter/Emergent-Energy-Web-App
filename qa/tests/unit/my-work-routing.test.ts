import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("my-work routing consolidation", () => {
  it("keeps approvals and exceptions navigation routed into my-work", () => {
    const approvalsPage = PAGE_REGISTRY.find((page) => page.id === "myWorkApprovals");
    const exceptionsPage = PAGE_REGISTRY.find((page) => page.id === "exceptions");

    expect(approvalsPage?.redirectTo).toBe("/my-work/tasks?source=approvals");
    expect(exceptionsPage?.redirectTo).toBe("/my-work");
  });

  it("routes the root home path into my-work", () => {
    const appSource = fs.readFileSync(path.join(process.cwd(), "client/src/App.tsx"), "utf8");
    expect(appSource).toContain('<Route path="/">{() => <Redirect to="/my-work" />}</Route>');
  });
});

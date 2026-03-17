import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("my-work routing consolidation", () => {
  it("keeps approvals navigation routed into my-work and command center retired", () => {
    const approvalsPage = PAGE_REGISTRY.find((page) => page.id === "myWorkApprovals");
    const commandCenterPage = PAGE_REGISTRY.find((page) => page.id === "commandCenter");

    expect(approvalsPage?.redirectTo).toBe("/my-work/tasks?source=approvals");
    expect(PAGE_REGISTRY.some((page) => page.id === "exceptions")).toBe(false);
    expect(commandCenterPage?.redirectTo).toBe("/my-work");
  });

  it("routes the root home path into the restored dashboard landing", () => {
    const appSource = fs.readFileSync(path.join(process.cwd(), "client/src/App.tsx"), "utf8");
    expect(appSource).toContain("return ROLE_LANDING_PAGE[effectiveRole] || \"/dashboard\";");
    expect(appSource).toContain('<Route path="/">{() => <HomeRedirect />}</Route>');
  });
});

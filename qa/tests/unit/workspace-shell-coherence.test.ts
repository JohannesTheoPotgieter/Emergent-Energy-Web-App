import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("workspace shell coherence", () => {
  it("keeps the main workspaces on shared page shell primitives", () => {
    const pages = [
      "client/src/pages/clients.tsx",
      "client/src/pages/my-work-calendar.tsx",
      "client/src/pages/my-work-tasks.tsx",
      "client/src/pages/collab-email.tsx",
      "client/src/pages/collab-teams.tsx",
      "client/src/pages/collaboration.tsx",
      "client/src/pages/projects.tsx",
      "client/src/pages/cashflow.tsx",
    ];

    for (const page of pages) {
      const source = read(page);
      expect(source).toContain("PageShell");
      expect(source).toContain("SectionHeader");
    }
  });

  it("keeps Microsoft-linked work visually integrated into the app operating model", () => {
    const emailSource = read("client/src/pages/collab-email.tsx");
    const teamsSource = read("client/src/pages/collab-teams.tsx");
    const collaborationSource = read("client/src/pages/collaboration.tsx");
    const myWorkTasksSource = read("client/src/pages/my-work-tasks.tsx");

    expect(emailSource).toContain("Microsoft-linked items behave like app work, not a separate inbox");
    expect(teamsSource).toContain("Microsoft conversations stay role-aware and project-aware");
    expect(collaborationSource).toContain("Microsoft-linked work stays inside the app's operating model");
    expect(myWorkTasksSource).toContain("My Work is the single personal action workspace");
  });

  it("keeps project management, finance, and admin trust cues explicit", () => {
    const projectListSource = read("client/src/pages/projects.tsx");
    const cashflowSource = read("client/src/pages/cashflow.tsx");
    const adminSource = read("client/src/pages/admin-control-center.tsx");

    expect(projectListSource).toContain("Project List is the execution directory inside Project Management");
    expect(projectListSource).toContain('href="/pm-dashboard"');
    expect(cashflowSource).toContain("Finance trust stays visible without adding clutter");
    expect(cashflowSource).toContain("ee-data-trust-grid");
    expect(adminSource).toContain("<AdminPageShell");
    expect(adminSource).not.toContain('data-testid="text-page-title"');
  });

  it("keeps disabled secondary navigation items non-clickable in the app shell", () => {
    const appLayoutSource = read("client/src/components/layout/AppLayout.tsx");

    expect(appLayoutSource).toContain("item.disabled ? (");
    expect(appLayoutSource).toContain('aria-disabled="true"');
  });
});

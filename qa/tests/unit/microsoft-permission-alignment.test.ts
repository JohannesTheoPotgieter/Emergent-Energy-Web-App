import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getMicrosoftPermissionEntity } from "../../../server/lib/microsoft-route-access";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("microsoft permission alignment", () => {
  it("maps microsoft item types onto the same permission surfaces used by the app", () => {
    expect(getMicrosoftPermissionEntity("email")).toBe("collaboration_hub");
    expect(getMicrosoftPermissionEntity("sharepoint_file")).toBe("collaboration_hub");
    expect(getMicrosoftPermissionEntity("teams")).toBe("teams_chat");
    expect(getMicrosoftPermissionEntity("channel")).toBe("teams_chat");
    expect(getMicrosoftPermissionEntity("event")).toBe("my_work");
    expect(getMicrosoftPermissionEntity("meeting")).toBe("my_work");
    expect(getMicrosoftPermissionEntity("unknown")).toBe("my_work");
  });

  it("keeps microsoft routes permission-gated and filters my-work microsoft payloads before returning them", () => {
    const msSyncRoutesSource = read("server/ms-sync-routes.ts");

    expect(msSyncRoutesSource).toContain('app.get("/api/ms-objects/mine", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftSurfaceFromRequest()');
    expect(msSyncRoutesSource).toContain('app.get("/api/ms-objects/project/:projectId", jwtAuth, requireAuth, requirePermission("projects", "view")');
    expect(msSyncRoutesSource).toContain('app.post("/api/ms-objects/:id/create-follow-up", jwtAuth, requireAuth, requireUnifiedWorkFlag, requireMicrosoftObjectSurfaceAccess()');
    expect(msSyncRoutesSource).toContain('app.get("/api/ms-sync/status", jwtAuth, requireAuth, requireMicrosoftSyncSurfaceAccess()');
    expect(msSyncRoutesSource).toContain('app.get("/api/ms-teams/project-chat/:projectId", jwtAuth, requireAuth, requirePermission("teams_chat", "view")');
    expect(msSyncRoutesSource).toContain('app.delete("/api/ms-teams/project-chat/:projectId/unlink", jwtAuth, requireAuth, requirePermission("teams_chat", "delete")');
    expect(msSyncRoutesSource).toContain("const visibleMicrosoftItems = await filterMicrosoftItemsForRequest(req, microsoftItems);");
  });

  it("filters microsoft shortcuts in the shell and my-work home cards through route visibility", () => {
    const appLayoutSource = read("client/src/components/layout/AppLayout.tsx");
    const myWorkHomeSource = read("client/src/pages/my-work-home.tsx");

    expect(appLayoutSource).toContain("MICROSOFT_SHORTCUTS.filter((shortcut) => canViewPath(shortcut.path))");
    expect(myWorkHomeSource).toContain(".filter((item) => canViewPath(item.path))");
    expect(myWorkHomeSource).toContain("Personal Microsoft Tools");
  });
});

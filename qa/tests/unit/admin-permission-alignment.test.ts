import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("admin permission alignment", () => {
  it("guards admin pages through route permission entities instead of a blanket admin-path redirect", () => {
    const appSource = read("client/src/App.tsx");

    expect(appSource).toContain("const entity = getPermissionEntityForPath(location);");
    expect(appSource).not.toContain('location.startsWith("/admin")');
  });

  it("keeps smart import and import control tower bound to explicit permission entities", () => {
    const smartImportSource = read("server/smart-import-routes.ts");

    expect(smartImportSource).toContain('requirePermission("smart_import", "view")');
    expect(smartImportSource).toContain('requirePermission("smart_import", "edit")');
    expect(smartImportSource).toContain('requirePermission("admin", "view")');
    expect(smartImportSource).toContain('requirePermission("admin", "edit")');
    expect(smartImportSource).not.toContain("IMPORT_ROLES");
  });
});

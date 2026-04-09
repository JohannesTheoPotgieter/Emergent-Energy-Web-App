import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY, getPermissionEntityForPath } from "@/config/page-registry";

describe("admin permission alignment", () => {
  it("returns the correct permission entity for admin paths", () => {
    expect(getPermissionEntityForPath("/admin/smart-import")).toBe("smart_import");
    expect(getPermissionEntityForPath("/admin/control-center")).toBe("admin");
    expect(getPermissionEntityForPath("/admin/import-control-tower")).toBe("admin");
    expect(getPermissionEntityForPath("/admin/roles")).toBe("admin_roles");
    expect(getPermissionEntityForPath("/admin/activity-log")).toBe("activity_log");
  });

  it("binds every admin route to an explicit permission entity", () => {
    const adminPages = PAGE_REGISTRY.filter((page) => page.path.startsWith("/admin"));
    expect(adminPages.length).toBeGreaterThan(0);

    for (const page of adminPages) {
      expect(page.permissionEntity, `${page.id} (${page.path}) must have a permissionEntity`).toBeTruthy();
    }
  });
});

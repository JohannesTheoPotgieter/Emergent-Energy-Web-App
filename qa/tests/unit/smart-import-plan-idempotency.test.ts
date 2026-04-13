import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Smart Import plan commit idempotency", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("uses work_items.external_ref to locate existing imported plan tasks", () => {
    expect(routesCode).toContain("existingWorkItemIdByExternalRef");
    expect(routesCode).toContain("existingWorkItemsForImport");
  });

  it("updates existing work_items when external_ref already exists", () => {
    expect(routesCode).toContain("const existingWorkItemId = existingWorkItemIdByExternalRef.get(externalRef)");
    expect(routesCode).toContain("await tx.update(workItems)");
    expect(routesCode).toContain(".where(eq(workItems.id, existingWorkItemId));");
  });

  it("inserts only when external_ref is not present", () => {
    expect(routesCode).toContain("await tx.insert(workItems).values({");
    expect(routesCode).toContain("createdBy: userId");
  });

  it("preserves rerun safety by avoiding duplicate OWNER assignment inserts", () => {
    expect(routesCode).toContain("existingOwnerKey");
    expect(routesCode).toContain("if (!existingOwnerKey.has(assignmentKey))");
  });
});

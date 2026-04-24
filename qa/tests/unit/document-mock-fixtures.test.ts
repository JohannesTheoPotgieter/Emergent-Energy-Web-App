import { describe, it, expect } from "vitest";
import {
  mockListChildren,
  mockGetItem,
  mockDownloadBuffer,
  mockUploadSmall,
  mockCreateFolder,
  mockRenameItem,
  mockCheckout,
  mockCheckin,
} from "../../../server/mocks/ms-graph-fixtures";

describe("ms-graph mock document fixtures", () => {
  it("lists project root children", () => {
    const items = mockListChildren("drive-project-mock", null);
    expect(items.length).toBeGreaterThan(0);
    const names = items.map((i) => i.name);
    expect(names).toContain("Engineering");
    expect(names).toContain("Contracts");
  });

  it("lists company root children", () => {
    const items = mockListChildren("drive-company-mock", null);
    const names = items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["HR", "Templates", "Policies"]));
  });

  it("getItem returns null for unknown id", () => {
    expect(mockGetItem("drive-project-mock", "nope")).toBeNull();
  });

  it("downloads a seeded file", () => {
    const result = mockDownloadBuffer("drive-project-mock", "proj-eng-spec");
    expect(result.fileName).toBe("design-spec-v2.pdf");
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("upload → listChildren reflects new file", () => {
    const uploaded = mockUploadSmall({
      driveId: "drive-project-mock",
      parentItemId: "proj-engineering",
      fileName: `upload-test-${Date.now()}.txt`,
      body: Buffer.from("hello"),
    });
    expect(uploaded.id).toBeTruthy();
    const engChildren = mockListChildren("drive-project-mock", "proj-engineering");
    expect(engChildren.some((i) => i.id === uploaded.id)).toBe(true);
  });

  it("create folder → listChildren reflects new folder", () => {
    const folder = mockCreateFolder({
      driveId: "drive-project-mock",
      parentItemId: "proj-root",
      name: `TestFolder-${Date.now()}`,
    });
    expect(folder.isFolder).toBe(true);
  });

  it("create folder twice with same name throws conflict", () => {
    const name = `SameName-${Date.now()}`;
    mockCreateFolder({ driveId: "drive-project-mock", parentItemId: "proj-root", name });
    expect(() =>
      mockCreateFolder({ driveId: "drive-project-mock", parentItemId: "proj-root", name }),
    ).toThrow();
  });

  it("rename updates the item's name", () => {
    const target = mockCreateFolder({
      driveId: "drive-project-mock",
      parentItemId: "proj-root",
      name: `RenameMe-${Date.now()}`,
    });
    const newName = `Renamed-${Date.now()}`;
    const renamed = mockRenameItem({
      driveId: "drive-project-mock",
      itemId: target.id,
      newName,
    });
    expect(renamed.name).toBe(newName);
  });

  it("checkout marks checkedOutBy, checkin clears", () => {
    mockCheckout("drive-project-mock", "proj-eng-spec");
    const afterCheckout = mockGetItem("drive-project-mock", "proj-eng-spec");
    expect(afterCheckout?.checkedOutBy).not.toBeNull();
    mockCheckin("drive-project-mock", "proj-eng-spec");
    const afterCheckin = mockGetItem("drive-project-mock", "proj-eng-spec");
    expect(afterCheckin?.checkedOutBy).toBeNull();
  });
});

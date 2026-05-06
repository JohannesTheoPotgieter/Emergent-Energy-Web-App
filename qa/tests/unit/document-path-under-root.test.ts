import { describe, it, expect } from "vitest";
import { pathUnderRoot } from "../../../server/routes/document-management.routes";

/**
 * Pin the drive-relative path stripping behaviour used by the document
 * browser so folder ACL first-segment matching works for BOTH the mock
 * (root sits at drive root → stripPrefix is "") and real Graph (root
 * is a nested project folder → stripPrefix is "Client/ProjectName").
 */
describe("pathUnderRoot — drive-relative stripping", () => {
  it("returns input unchanged when rootDrivePath is empty (mock case)", () => {
    expect(pathUnderRoot("Engineering/spec.pdf", "")).toBe("Engineering/spec.pdf");
  });

  it("strips the project wrapper prefix (real-Graph case)", () => {
    expect(
      pathUnderRoot(
        "Projects/ClientA/ProjectX/Engineering/spec.pdf",
        "Projects/ClientA/ProjectX",
      ),
    ).toBe("Engineering/spec.pdf");
  });

  it("handles leading slashes on both arguments", () => {
    expect(pathUnderRoot("/Engineering/spec.pdf", "/")).toBe("Engineering/spec.pdf");
  });

  it("does not strip a non-matching prefix (safety default)", () => {
    expect(
      pathUnderRoot("Engineering/spec.pdf", "Completely/Different"),
    ).toBe("Engineering/spec.pdf");
  });

  it("strips when rootDrivePath has a trailing slash", () => {
    expect(pathUnderRoot("A/B/C.pdf", "A/B/")).toBe("C.pdf");
  });

  it("returns empty string when path equals the root exactly", () => {
    expect(pathUnderRoot("A/B", "A/B")).toBe("");
  });
});

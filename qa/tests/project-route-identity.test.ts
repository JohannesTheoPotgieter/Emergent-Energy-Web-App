import { describe, expect, it } from "vitest";
import { findProjectById, findProjectByName } from "../../client/src/lib/project-route-identity";

const projects = [
  { project_info_id: 10, project_name: "Alpha/One" },
  { project_info_id: 11, project_name: "Alpha One" },
  { project_info_id: 12, project_name: "Solar & Storage – West" },
  { project_info_id: 13, project_name: "Alpha One" },
];

describe("project route identity resolution", () => {
  it("resolves special-character names for legacy URLs", () => {
    expect(findProjectByName(projects, "Alpha/One")?.project_info_id).toBe(10);
    expect(findProjectByName(projects, "Solar & Storage – West")?.project_info_id).toBe(12);
  });

  it("resolves canonical ID route directly", () => {
    expect(findProjectById(projects, 11)?.project_name).toBe("Alpha One");
    expect(findProjectById(projects, 13)?.project_name).toBe("Alpha One");
  });

  it("keeps duplicate names distinct via ID", () => {
    const byLegacyName = findProjectByName(projects, "Alpha One");
    const byId = findProjectById(projects, 13);
    expect(byLegacyName?.project_info_id).toBe(11);
    expect(byId?.project_info_id).toBe(13);
    expect(byLegacyName?.project_info_id).not.toBe(byId?.project_info_id);
  });
});


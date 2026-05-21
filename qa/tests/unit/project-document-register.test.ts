import { describe, expect, it } from "vitest";
import {
  computeProjectDocumentDefects,
  getProjectDocumentPermissions,
} from "../../../shared/project-document-register";

describe("project document register policy", () => {
  it("marks approved documents without SharePoint link and approval timestamp as red defects", () => {
    const result = computeProjectDocumentDefects({
      domain: "engineering",
      status: "approved",
      reviewStatus: "approved",
      driveId: null,
      itemId: null,
      webUrl: null,
      reviewerUserId: 12,
      approverUserId: 13,
      approvedAt: null,
      currentRevision: true,
      superseded: false,
      dueDate: null,
      closeOutEvidenceRequired: false,
      closeOutEvidenceLinked: false,
      syncConfidence: "high",
    });

    expect(result.flag).toBe("red");
    expect(result.defects.map((d) => d.code)).toEqual([
      "missing_sharepoint_link",
      "missing_approval_timestamp",
    ]);
  });

  it("prevents engineers from approving engineering documents while allowing engineering managers", () => {
    expect(getProjectDocumentPermissions("ENGINEER", "engineering").canApprove).toBe(false);
    expect(getProjectDocumentPermissions("ENGINEERING_MANAGER", "engineering").canApprove).toBe(true);
  });

  it("allows PMs to link but not approve quality documents", () => {
    const permissions = getProjectDocumentPermissions("PROJECT_MANAGER_SITE", "quality");
    expect(permissions.canLink).toBe(true);
    expect(permissions.canApprove).toBe(false);
  });
});

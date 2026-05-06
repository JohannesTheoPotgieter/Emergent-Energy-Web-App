import { describe, expect, it } from "vitest";
import { buildMyWorkSourceLinks } from "../../../server/lib/my-work-source-links";

describe("my-work source links", () => {
  it("routes project-linked Microsoft work into the correct project context", () => {
    const result = buildMyWorkSourceLinks({
      source: "microsoft",
      rawId: 8,
      projectName: "Solar Alpha",
      sourceType: "teams",
      webLink: "https://teams.microsoft.com/l/message/123",
    });

    expect(result.sourceHref).toBe("/project/Solar%20Alpha?mode=execution&section=collaboration&subTab=chat");
    expect(result.projectHref).toBe("/project/Solar%20Alpha");
    expect(result.externalHref).toBe("https://teams.microsoft.com/l/message/123");
    expect(result.sourceTypeLabel).toBe("Microsoft Teams");
  });

  it("routes linked Microsoft tasks into project delivery context", () => {
    const result = buildMyWorkSourceLinks({
      source: "microsoft",
      rawId: 11,
      projectName: "Solar Beta",
      sourceType: "email",
      linkedTaskId: 42,
      linkedTaskType: "operational",
      webLink: "https://outlook.office.com/mail/id/11",
    });

    expect(result.sourceHref).toBe("/project/Solar%20Beta?mode=execution&section=delivery&subTab=task-grid");
    expect(result.sourceContextLabel).toBe("Open linked project task");
    expect(result.sourceTypeLabel).toBe("Microsoft Email");
  });

  it("routes Microsoft items linked to quality-backed tasks into the quality workspace", () => {
    const result = buildMyWorkSourceLinks({
      source: "microsoft",
      rawId: 12,
      projectName: "Solar Gamma",
      sourceType: "email",
      linkedTaskId: 77,
      linkedTaskType: "operational",
      linkedQualityItemInstanceId: 501,
      webLink: "https://outlook.office.com/mail/id/12",
    });

    expect(result.sourceHref).toBe("/project/Solar%20Gamma?mode=execution&section=quality&subTab=quality");
    expect(result.sourceContextLabel).toBe("Open linked quality item");
    expect(result.sourceTypeLabel).toBe("Microsoft Email");
  });

  it("falls back to my-work item links for approvals without project context", () => {
    const result = buildMyWorkSourceLinks({
      source: "approvals",
      rawId: 17,
      itemKey: "approval-gen-17",
      sourceType: "general",
    });

    expect(result.sourceHref).toBe("/my-work/tasks?itemKey=approval-gen-17");
    expect(result.projectHref).toBeNull();
    expect(result.sourceTypeLabel).toBe("General Approval");
  });
});

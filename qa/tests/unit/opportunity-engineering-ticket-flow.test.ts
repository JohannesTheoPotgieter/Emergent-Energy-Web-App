import { describe, expect, it } from "vitest";
import {
  buildCustomComments,
  buildSamePhaseDuplicateWarning,
  buildTemplateTicketDrafts,
} from "../../../server/lib/opportunity-engineering-ticket-flow";

describe("opportunity engineering ticket flow helpers", () => {
  it("builds template ticket drafts from template items", () => {
    const drafts = buildTemplateTicketDrafts({
      templatePhase: "First Assessment",
      templateName: "FA Template",
      templateVersion: 3,
      baseDueDate: "2026-04-20",
      items: [
        { id: 11, title: "Collect utility bills", description: "Gather bills", defaultPriority: "High", offsetDaysFromPhaseStart: 0 },
        { id: 12, title: "Run initial sizing", description: null, defaultPriority: null, offsetDaysFromPhaseStart: 5 },
      ],
    });

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      templateItemId: 11,
      title: "Collect utility bills",
      requestType: "First Assessment",
      dueDate: "2026-04-20",
      priority: "High",
    });
    expect(drafts[1]).toMatchObject({
      templateItemId: 12,
      title: "Run initial sizing",
      requestType: "First Assessment",
      dueDate: "2026-04-25",
      priority: "Medium",
    });
  });

  it("builds custom ticket comments with required output", () => {
    const comments = buildCustomComments({
      title: "Custom FA",
      phase: "First Assessment",
      descriptionScope: "Review client profile",
      dueDate: "2026-04-22",
      priority: "Medium",
      requiredOutput: "Signed assessment memo",
    });

    expect(comments).toContain("Scope: Review client profile");
    expect(comments).toContain("Required Output: Signed assessment memo");
  });

  it("warns on likely same-phase duplicates but does not block", () => {
    expect(buildSamePhaseDuplicateWarning("First Assessment", 0)).toEqual([]);
    expect(buildSamePhaseDuplicateWarning("First Assessment", 2)[0]).toContain("Potential duplicate");
  });
});

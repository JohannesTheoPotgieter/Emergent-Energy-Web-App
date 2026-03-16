import { describe, expect, it } from "vitest";
import { createProjectEvent } from "../../../server/services/project-event-service";

describe("project event service", () => {
  it("writes event payload with idempotency guard", async () => {
    let conflictTarget: any;
    const fakeTx: any = {
      insert() {
        return {
          values(payload: any) {
            expect(payload.projectId).toBe(77);
            expect(payload.eventType).toBe("project.stage_changed");
            expect(payload.idempotencyKey).toBe("phase:77:A:B");
            return {
              onConflictDoNothing(opts: any) {
                conflictTarget = opts.target;
                return {
                  returning: async () => [{ id: 901, ...payload }],
                };
              },
            };
          },
        };
      },
    };

    const event = await createProjectEvent({
      projectId: 77,
      eventType: "project.stage_changed",
      sourceEntityType: "project_info",
      sourceEntityId: "77",
      summary: "Stage changed",
      idempotencyKey: "phase:77:A:B",
    }, fakeTx);

    expect(event?.id).toBe(901);
    expect(conflictTarget).toHaveLength(2);
  });
});

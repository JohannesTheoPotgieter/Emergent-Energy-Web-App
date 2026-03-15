import { describe, expect, it } from "vitest";
import { assertPermission } from "../../../server/api/v2/policies/access-policy";
import { paginationQuerySchema } from "../../../server/api/v2/utils/http";
import { financeVariationCreateSchema, milestoneCreateSchema, procurementPoCreateSchema, projectIdParamSchema, workItemCreateSchema } from "../../../server/api/v2/validators/project-v2-validators";

describe("api v2 policy and validation", () => {
  it("allows roles with wildcard permissions", () => {
    expect(() => assertPermission("COO_ADMIN", "finance.write")).not.toThrow();
  });

  it("blocks missing permissions", () => {
    expect(() => assertPermission("ENGINEER", "finance.write")).toThrowError(/Missing permission/);
  });

  it("validates pagination defaults", () => {
    const parsed = paginationQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.sortDir).toBe("asc");
  });

  it("validates project params and work item payload", () => {
    expect(projectIdParamSchema.parse({ projectId: "5" }).projectId).toBe(5);
    const payload = workItemCreateSchema.parse({ title: "Task", workstream: "ENG" });
    expect(payload.status).toBe("Not Started");
    expect(milestoneCreateSchema.parse({ title: "M" }).isMilestone).toBe(true);
    expect(procurementPoCreateSchema.parse({ title: "PO", poId: 100 }).poId).toBe(100);
    expect(financeVariationCreateSchema.parse({ title: "VO" }).expectedCost).toBe(0);
  });
});

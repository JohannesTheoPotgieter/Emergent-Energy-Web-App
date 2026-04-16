import { describe, expect, it } from "vitest";
import { buildOpportunityMappingPlan } from "../../../server/lib/opportunity-mapping-plan";

describe("buildOpportunityMappingPlan", () => {
  it("validates existing client + existing project", () => {
    const plan = buildOpportunityMappingPlan({
      mode: "existing_existing",
      linkedProjectExists: false,
      existingClientId: 1,
      existingProjectId: 2,
    });
    expect(plan.ok).toBe(true);
    expect(plan.createProjectShell).toBe(false);
  });

  it("validates existing client + new project shell", () => {
    const plan = buildOpportunityMappingPlan({
      mode: "existing_new",
      linkedProjectExists: false,
      existingClientId: 1,
      newProjectName: "Shell Project A",
    });
    expect(plan.ok).toBe(true);
    expect(plan.createProjectShell).toBe(true);
  });

  it("validates new client + new project shell", () => {
    const plan = buildOpportunityMappingPlan({
      mode: "new_new",
      linkedProjectExists: false,
      newClientName: "New Client A",
      newProjectName: "Shell Project B",
    });
    expect(plan.ok).toBe(true);
    expect(plan.createProjectShell).toBe(true);
  });

  it("enforces first-ticket shell creation only once", () => {
    const plan = buildOpportunityMappingPlan({
      mode: "existing_new",
      linkedProjectExists: true,
      existingClientId: 1,
      newProjectName: "Duplicate Shell",
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toContain("already exists");
  });
});


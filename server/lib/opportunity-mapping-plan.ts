export type OpportunityMappingMode = "existing_existing" | "existing_new" | "new_new";

export interface OpportunityMappingPlanInput {
  mode: OpportunityMappingMode;
  linkedProjectExists: boolean;
  existingClientId?: number | null;
  existingProjectId?: number | null;
  newClientName?: string | null;
  newProjectName?: string | null;
}

export interface OpportunityMappingPlan {
  ok: boolean;
  error?: string;
  createProjectShell: boolean;
}

export function buildOpportunityMappingPlan(input: OpportunityMappingPlanInput): OpportunityMappingPlan {
  if (input.mode === "existing_existing") {
    if (!input.existingClientId || !input.existingProjectId) {
      return { ok: false, error: "existingClientId and existingProjectId are required.", createProjectShell: false };
    }
    return { ok: true, createProjectShell: false };
  }

  if (input.linkedProjectExists) {
    return { ok: false, error: "Project shell already exists for this opportunity.", createProjectShell: false };
  }

  if (input.mode === "existing_new") {
    if (!input.existingClientId || !String(input.newProjectName || "").trim()) {
      return { ok: false, error: "existingClientId and newProjectName are required.", createProjectShell: false };
    }
    return { ok: true, createProjectShell: true };
  }

  if (input.mode === "new_new") {
    if (!String(input.newClientName || "").trim() || !String(input.newProjectName || "").trim()) {
      return { ok: false, error: "newClientName and newProjectName are required.", createProjectShell: false };
    }
    return { ok: true, createProjectShell: true };
  }

  return { ok: false, error: "Unsupported mapping mode.", createProjectShell: false };
}


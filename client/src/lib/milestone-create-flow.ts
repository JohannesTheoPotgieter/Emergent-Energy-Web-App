type ApiRequestFn = (method: string, url: string, data?: unknown) => Promise<any>;

export type CreateMilestoneFlowResult =
  | { ok: true; rowNumber: number | null }
  | { ok: false; kind: "validation" | "backend"; message: string };

async function readPayload(response: any): Promise<any> {
  if (response && typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
  return response ?? {};
}

export async function createMilestoneFlow(params: {
  title: string;
  projectName: string;
  request: ApiRequestFn;
  selectedRowNumbers?: number[];
}): Promise<CreateMilestoneFlowResult> {
  const trimmedTitle = params.title.trim();
  if (!trimmedTitle) {
    return { ok: false, kind: "validation", message: "Milestone title is required." };
  }

  try {
    const createRes = await params.request("POST", "/api/project-plan/structure", {
      operation: "createMilestone",
      projectName: params.projectName,
      data: { title: trimmedTitle },
    });

    const createPayload = await readPayload(createRes);
    const rowNumber = typeof createPayload?.rowNumber === "number" ? createPayload.rowNumber : null;

    const selectedRowNumbers = (params.selectedRowNumbers || []).filter((rn) => rn != null);
    if (selectedRowNumbers.length > 0 && rowNumber != null) {
      await params.request("POST", "/api/project-plan/structure", {
        operation: "setParent",
        projectName: params.projectName,
        data: { taskRowNumbers: selectedRowNumbers, parentRowNumber: rowNumber },
      });
    }

    return { ok: true, rowNumber };
  } catch (error: any) {
    return {
      ok: false,
      kind: "backend",
      message: error?.message || "Could not create milestone",
    };
  }
}


export function invalidateMilestoneCreationQueries(
  invalidate: (queryKey: readonly unknown[]) => void,
  projectName: string,
) {
  invalidate(["planning-tasks", projectName]);
  invalidate(["operational-tasks", projectName]);
  invalidate(["/api/projects-summary"]);
}

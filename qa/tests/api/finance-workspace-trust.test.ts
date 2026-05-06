import { describe, expect, it } from "vitest";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

async function apiRequest(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = {};
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body == null ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { status: response.status, data };
}

async function loginAdmin() {
  const login = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(login.status).toBe(200);
  expect(login.data?.token).toBeTruthy();
  return login.data.token as string;
}

async function listProjectCandidates(token: string) {
  const summary = await apiRequest("GET", "/api/projects-summary", undefined, token);
  if (summary.status === 200 && Array.isArray(summary.data)) {
    return summary.data
      .map((project: any) => ({
        projectName: project.project_name || project.projectName || project.name || null,
        projectId: project.project_info_id || project.projectInfoId || project.id || null,
      }))
      .filter((project: { projectName: string | null; projectId: number | null }) => Boolean(project.projectName));
  }

  const projects = await apiRequest("GET", "/api/projects", undefined, token);
  expect(projects.status).toBe(200);

  return (projects.data || [])
    .map((project: any) => ({
      projectName: project.projectName || project.project_name || project.name || null,
      projectId: project.project_info_id || project.projectInfoId || project.id || null,
    }))
    .filter((project: { projectName: string | null; projectId: number | null }) => Boolean(project.projectName));
}

async function findFinanceProject(token: string) {
  const projects = await listProjectCandidates(token);

  for (const project of projects) {
    const projectName = project.projectName;
    const projectId = project.projectId;
    if (!projectName) continue;

    const [revenue, expenditure] = await Promise.all([
      apiRequest("GET", `/api/revenue-tab/${encodeURIComponent(projectName)}`, undefined, token),
      apiRequest("GET", `/api/expenditure-breakdown/${encodeURIComponent(projectName)}`, undefined, token),
    ]);

    if (revenue.status === 200 && expenditure.status === 200) {
      return { projectName, projectId, revenue: revenue.data, expenditure: expenditure.data };
    }
  }

  throw new Error("No finance-backed project was available for finance workspace verification.");
}

describe("API: finance workspace trust", () => {
  it("keeps revenue and expenditure finance payloads project-linked and additive", async () => {
    const token = await loginAdmin();
    const financeProject = await findFinanceProject(token);

    expect(financeProject.revenue).toHaveProperty("milestones");
    expect(financeProject.revenue).toHaveProperty("summary");
    expect(financeProject.revenue).toHaveProperty("highlevel");
    expect(financeProject.revenue).toHaveProperty("reconciliation");
    expect(financeProject.revenue).toHaveProperty("riskSignals");

    expect(Array.isArray(financeProject.revenue.milestones)).toBe(true);
    expect(Array.isArray(financeProject.revenue.reconciliation.recentChanges)).toBe(true);
    expect(typeof financeProject.revenue.reconciliation.source.importedContractValue).toBe("number");
    expect(typeof financeProject.revenue.reconciliation.managed.overriddenFieldCount).toBe("number");
    expect(typeof financeProject.revenue.reconciliation.approvals.pendingCount).toBe("number");
    expect(typeof financeProject.revenue.reconciliation.microsoft.actionRequiredCount).toBe("number");

    if ((financeProject.revenue.milestones || []).length > 0) {
      const milestone = financeProject.revenue.milestones[0];
      expect(milestone).toHaveProperty("trust");
      expect(milestone.trust).toHaveProperty("sourceSheet");
      expect(milestone.trust).toHaveProperty("sourceRow");
      expect(milestone.trust).toHaveProperty("fieldAudits");
    }

    expect(financeProject.revenue.highlevel.costed).toHaveProperty("trust");

    expect(financeProject.expenditure).toHaveProperty("items");
    expect(financeProject.expenditure).toHaveProperty("categories");
    expect(financeProject.expenditure).toHaveProperty("reconciliation");
    expect(financeProject.expenditure).toHaveProperty("riskSignals");

    expect(Array.isArray(financeProject.expenditure.items)).toBe(true);
    expect(Array.isArray(financeProject.expenditure.reconciliation.recentChanges)).toBe(true);
    expect(typeof financeProject.expenditure.reconciliation.source.importedBudget).toBe("number");
    expect(typeof financeProject.expenditure.reconciliation.managed.overriddenFieldCount).toBe("number");
    expect(typeof financeProject.expenditure.reconciliation.variances.committedUnpaidTotal).toBe("number");
    expect(typeof financeProject.expenditure.reconciliation.microsoft.linkedCount).toBe("number");

    if ((financeProject.expenditure.items || []).length > 0) {
      const item = financeProject.expenditure.items[0];
      expect(item).toHaveProperty("trust");
      expect(item.trust).toHaveProperty("sourceSheet");
      expect(item.trust).toHaveProperty("sourceRow");
      expect(item.trust).toHaveProperty("fieldAudits");
    }
  });

  it("resolves Microsoft-linked context for the finance project when a project id exists", async () => {
    const token = await loginAdmin();
    const financeProject = await findFinanceProject(token);

    if (!financeProject.projectId) {
      return;
    }

    const microsoft = await apiRequest("GET", `/api/ms-objects/project/${financeProject.projectId}`, undefined, token);
    expect(microsoft.status).toBe(200);
    expect(Array.isArray(microsoft.data)).toBe(true);
  });
});

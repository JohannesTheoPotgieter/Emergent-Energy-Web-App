import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BASE_URL = process.env.API_URL || "http://localhost:5000";

type ApiResponse = { status: number; data: any };

type WorkflowLogger = {
  step: (name: string, details?: Record<string, unknown>) => void;
  pass: (details?: Record<string, unknown>) => void;
  fail: (point: string, err: unknown) => never;
};

type WorkflowEvidence = {
  workflow: string;
  stepsRun: string[];
  result: "PASS" | "FAIL";
  failurePoint: string | null;
  details?: Record<string, unknown> | null;
  reason?: string | null;
};

const workflowEvidence: WorkflowEvidence[] = [];
const EVIDENCE_PATH = resolve(process.cwd(), "qa/reports/workflow-evidence.json");

function createWorkflowLogger(name: string): WorkflowLogger {
  const steps: string[] = [];
  return {
    step(stepName: string, details?: Record<string, unknown>) {
      steps.push(stepName);
      console.info(`[Workflow:${name}] STEP`, JSON.stringify({ step: stepName, details: details || null }));
    },
    pass(details?: Record<string, unknown>) {
      workflowEvidence.push({
        workflow: name,
        stepsRun: [...steps],
        result: "PASS",
        failurePoint: null,
        details: details || null,
      });
      console.info(`[Workflow:${name}] RESULT`, JSON.stringify({ result: "PASS", steps, details: details || null }));
    },
    fail(point: string, err: unknown): never {
      const reason = err instanceof Error ? err.message : String(err);
      workflowEvidence.push({
        workflow: name,
        stepsRun: [...steps],
        result: "FAIL",
        failurePoint: point,
        reason,
      });
      console.error(`[Workflow:${name}] RESULT`, JSON.stringify({ result: "FAIL", steps, failurePoint: point, reason }));
      throw err;
    },
  };
}

function writeWorkflowEvidenceReport() {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), workflows: workflowEvidence }, null, 2)}\n`,
    "utf8",
  );
}

async function apiRequest(method: string, path: string, body?: any, token?: string): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  let payload: any = undefined;

  if (body instanceof FormData) {
    payload = body;
  } else {
    headers["Content-Type"] = "application/json";
    payload = body ? JSON.stringify(body) : undefined;
  }

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: payload,
    redirect: "manual",
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function loginAdmin() {
  const res = await apiRequest("POST", "/api/auth/login", { username: "johannes", password: "2023" });
  expect(res.status).toBe(200);
  expect(res.data?.token).toBeTruthy();
  return res.data.token as string;
}

async function getProjectIdWithNoEngTasks(token: string): Promise<number | null> {
  const projects = await apiRequest("GET", "/api/projects", undefined, token);
  expect(projects.status).toBe(200);

  for (const p of projects.data || []) {
    const projectId = p.project_info_id || p.id;
    if (!projectId) continue;
    const tasks = await apiRequest("GET", `/api/projects/${projectId}/eng-tasks`, undefined, token);
    if (tasks.status === 200 && Array.isArray(tasks.data?.tasks) && tasks.data.tasks.length === 0) {
      return projectId;
    }
  }

  return null;
}

describe("API: Critical workflow test pack", () => {
  afterAll(() => {
    writeWorkflowEvidenceReport();
  });
  it("Engineering task create -> update -> view -> delete, with invalid update guard", async () => {
    const log = createWorkflowLogger("Engineering CRUD");
    try {
      const token = await loginAdmin();
      log.step("login_admin");

      const projects = await apiRequest("GET", "/api/projects", undefined, token);
      expect(projects.status).toBe(200);
      const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;
      expect(projectId).toBeTruthy();
      log.step("select_project", { projectId });

      const title = `WF Eng CRUD ${Date.now()}`;
      const created = await apiRequest("POST", "/api/eng/tasks", { title, projectId, status: "TO DO", priority: "Med" }, token);
      expect(created.status).toBe(200);
      const taskId = created.data?.workItemId || created.data?.id;
      expect(taskId).toBeTruthy();
      log.step("create_task", { taskId });

      const patched = await apiRequest("PATCH", `/api/eng/tasks/${taskId}`, { status: "IN PROGRESS", priority: "High" }, token);
      expect(patched.status).toBe(200);
      log.step("update_task_status");

      const invalidPatch = await apiRequest("PATCH", `/api/eng/tasks/${taskId}`, { status: "NOT_A_REAL_STATUS" }, token);
      expect(invalidPatch.status).toBe(400);
      log.step("invalid_update_rejected", { status: invalidPatch.status });

      const listing = await apiRequest("GET", `/api/eng/tasks?projectId=${projectId}`, undefined, token);
      expect(listing.status).toBe(200);
      const matches = (listing.data || []).filter((t: any) => (t.workItemId || t.id) === taskId);
      expect(matches.length).toBe(1);
      expect(matches[0].status).toBe("IN PROGRESS");
      log.step("view_task_reflects_update");

      const deleted = await apiRequest("DELETE", `/api/eng/tasks/${taskId}`, undefined, token);
      expect(deleted.status).toBe(200);
      log.step("delete_task");

      const postDelete = await apiRequest("GET", `/api/eng/tasks?projectId=${projectId}`, undefined, token);
      const postMatches = (postDelete.data || []).filter((t: any) => (t.workItemId || t.id) === taskId);
      expect(postMatches.length).toBe(0);
      log.step("deleted_task_not_listed");

      log.pass();
    } catch (err) {
      log.fail("engineering_crud", err);
    }
  });

  it("Project detail engineering task listing stays unique and reflects new tasks", async () => {
    const log = createWorkflowLogger("Project engineering listing");
    try {
      const token = await loginAdmin();
      const projects = await apiRequest("GET", "/api/projects", undefined, token);
      const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;
      expect(projectId).toBeTruthy();
      log.step("select_project", { projectId });

      const title = `WF Project Listing ${Date.now()}`;
      const created = await apiRequest("POST", "/api/eng/tasks", { title, projectId, status: "TO DO", priority: "Med" }, token);
      const taskId = created.data?.workItemId || created.data?.id;
      expect(created.status).toBe(200);
      log.step("create_task", { taskId });

      const detail = await apiRequest("GET", `/api/projects/${projectId}/eng-tasks`, undefined, token);
      expect(detail.status).toBe(200);
      const tasks = detail.data?.tasks || [];
      const ids = tasks.map((t: any) => t.workItemId || t.id).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
      const matches = tasks.filter((t: any) => (t.workItemId || t.id) === taskId);
      expect(matches.length).toBe(1);
      log.step("project_detail_reflects_change_without_duplicates", { listedCount: tasks.length });

      await apiRequest("DELETE", `/api/eng/tasks/${taskId}`, undefined, token);
      log.step("cleanup_task", { taskId });
      log.pass();
    } catch (err) {
      log.fail("project_listing", err);
    }
  });

  it("Generate engineering tasks for project handles create, re-read, duplicate-click protection, invalid project", async () => {
    const log = createWorkflowLogger("Generate engineering tasks");
    try {
      const token = await loginAdmin();
      let projectId = await getProjectIdWithNoEngTasks(token);
      log.step("find_project_without_eng_tasks", { projectId });

      if (!projectId) {
        const createProject = await apiRequest("POST", "/api/projects", {
          projectName: `WF Gen Eng ${Date.now()}`,
          clientName: "Workflow QA",
          initialPhase: "P0_FIRST_ASSESSMENT",
        }, token);
        expect(createProject.status).toBe(200);
        projectId = createProject.data?.project?.id;
        expect(projectId).toBeTruthy();
        log.step("create_fresh_project", { projectId });
      }

      const generated = await apiRequest("POST", `/api/projects/${projectId}/generate-eng-tasks`, {}, token);
      expect(generated.status).toBe(200);
      expect((generated.data?.tasksCreated || 0) > 0).toBe(true);
      log.step("generate_tasks", { tasksCreated: generated.data?.tasksCreated });

      const reRead = await apiRequest("GET", `/api/projects/${projectId}/eng-tasks`, undefined, token);
      expect(reRead.status).toBe(200);
      expect((reRead.data?.tasks || []).length).toBeGreaterThan(0);
      log.step("re_read_persisted_tasks", { listed: reRead.data.tasks.length });

      const duplicateClick = await apiRequest("POST", `/api/projects/${projectId}/generate-eng-tasks`, {}, token);
      expect(duplicateClick.status).toBe(400);
      log.step("duplicate_click_blocked", { status: duplicateClick.status });

      const invalidProject = await apiRequest("POST", "/api/projects/invalid/generate-eng-tasks", {}, token);
      expect(invalidProject.status).toBe(400);
      log.step("invalid_input_rejected", { status: invalidProject.status });

      log.pass();
    } catch (err) {
      log.fail("generate_eng_tasks", err);
    }
  });

  it("PD ticket flow create -> view -> spawn tasks with duplicate-submit protection", async () => {
    const log = createWorkflowLogger("PD to PM handover (ticket task spawn)");
    try {
      const token = await loginAdmin();

      const created = await apiRequest("POST", "/api/pd/tickets", {
        projectSiteName: `WF PD Site ${Date.now()}`,
        requestType: "I&C",
        priority: "Medium",
      }, token);
      expect(created.status).toBe(201);
      const ticketId = created.data?.id;
      expect(ticketId).toBeTruthy();
      log.step("create_pd_ticket", { ticketId });

      const viewed = await apiRequest("GET", `/api/pd/tickets/${ticketId}`, undefined, token);
      expect(viewed.status).toBe(200);
      expect(Array.isArray(viewed.data?.tasks)).toBe(true);
      expect((viewed.data.tasks || []).length).toBeGreaterThan(0);
      log.step("view_ticket_with_spawned_tasks", { taskCount: viewed.data.tasks.length });

      const duplicateSpawn = await apiRequest("POST", `/api/pd/tickets/${ticketId}/spawn-tasks`, {}, token);
      expect(duplicateSpawn.status).toBe(409);
      log.step("duplicate_spawn_blocked", { status: duplicateSpawn.status });

      const invalidCreate = await apiRequest("POST", "/api/pd/tickets", { requestType: "I&C" }, token);
      expect(invalidCreate.status).toBe(400);
      log.step("invalid_input_rejected", { status: invalidCreate.status });

      log.pass();
    } catch (err) {
      log.fail("pd_ticket_flow", err);
    }
  });

  it("Send for approval flow updates status and rejects invalid override", async () => {
    const log = createWorkflowLogger("Approval send flow");
    try {
      const token = await loginAdmin();
      const projects = await apiRequest("GET", "/api/projects", undefined, token);
      const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;
      expect(projectId).toBeTruthy();

      const title = `WF Approval ${Date.now()}`;
      const created = await apiRequest("POST", "/api/eng/tasks", { title, projectId, status: "TO DO", priority: "Med" }, token);
      const taskId = created.data?.workItemId || created.data?.id;
      expect(created.status).toBe(200);
      log.step("create_task", { taskId });

      const invalidForm = new FormData();
      invalidForm.set("note", "invalid override test");
      invalidForm.set("projectSuggestion", "A");
      invalidForm.set("projectFinal", "B");
      const invalidSend = await apiRequest("POST", `/api/eng/tasks/${taskId}/send-for-approval`, invalidForm, token);
      expect(invalidSend.status).toBe(400);
      log.step("invalid_override_rejected", { status: invalidSend.status });

      const validForm = new FormData();
      validForm.set("note", "sending for approval from workflow pack");
      const sent = await apiRequest("POST", `/api/eng/tasks/${taskId}/send-for-approval`, validForm, token);
      expect(sent.status).toBe(200);
      log.step("send_for_approval_success");

      const listing = await apiRequest("GET", `/api/eng/tasks?projectId=${projectId}`, undefined, token);
      const updated = (listing.data || []).find((t: any) => (t.workItemId || t.id) === taskId);
      expect(updated).toBeTruthy();
      expect(updated.status).toBe("NEEDS APPROVAL");
      log.step("status_reflected_on_view");

      await apiRequest("DELETE", `/api/eng/tasks/${taskId}`, undefined, token);
      log.step("cleanup_task");
      log.pass();
    } catch (err) {
      log.fail("send_for_approval", err);
    }
  });

  it("My Work task flow create -> update -> view -> delete with invalid input guard and no duplicate on repeat update", async () => {
    const log = createWorkflowLogger("My Work tasks");
    try {
      const token = await loginAdmin();

      const invalidCreate = await apiRequest("POST", "/api/mytool/tasks", { priority: "high" }, token);
      expect(invalidCreate.status).toBe(400);
      log.step("invalid_create_rejected", { status: invalidCreate.status });

      const title = `WF MyTool ${Date.now()}`;
      const created = await apiRequest("POST", "/api/mytool/tasks", { title, status: "todo", priority: "normal" }, token);
      expect(created.status).toBe(200);
      const taskId = created.data?.id;
      expect(taskId).toBeTruthy();
      log.step("create_task", { taskId });

      const updated = await apiRequest("PATCH", `/api/mytool/tasks/${taskId}`, { status: "in progress" }, token);
      expect(updated.status).toBe(200);
      log.step("update_task");

      const repeatUpdate = await apiRequest("PATCH", `/api/mytool/tasks/${taskId}`, { status: "in progress" }, token);
      expect(repeatUpdate.status).toBe(200);
      log.step("repeat_update_no_extra_record");

      const listing = await apiRequest("GET", "/api/mytool/tasks", undefined, token);
      expect(listing.status).toBe(200);
      const matches = (listing.data || []).filter((t: any) => t.id === taskId);
      expect(matches.length).toBe(1);
      expect(matches[0].status).toBe("in progress");
      log.step("view_reflects_single_record");

      const deleted = await apiRequest("DELETE", `/api/mytool/tasks/${taskId}`, undefined, token);
      expect(deleted.status).toBe(200);
      log.step("delete_task");

      const reRead = await apiRequest("GET", "/api/mytool/tasks", undefined, token);
      const afterDeleteMatches = (reRead.data || []).filter((t: any) => t.id === taskId);
      expect(afterDeleteMatches.length).toBe(0);
      log.step("deleted_not_listed");

      log.pass();
    } catch (err) {
      log.fail("mywork_flow", err);
    }
  });

  it("Procurement item create -> update -> delete persists and prevents invalid transitions", async () => {
    const log = createWorkflowLogger("Procurement CRUD and transition guard");
    try {
      const token = await loginAdmin();
      const projects = await apiRequest("GET", "/api/projects", undefined, token);
      const projectId = projects.data[0]?.project_info_id || projects.data[0]?.id;
      expect(projectId).toBeTruthy();
      log.step("select_project", { projectId });

      const title = `WF Procurement ${Date.now()}`;
      const created = await apiRequest("POST", "/api/procurement", { projectId, title, category: "service", expectedCost: 12500 }, token);
      expect(created.status).toBe(201);
      const itemId = created.data?.id;
      expect(itemId).toBeTruthy();
      log.step("create_procurement_item", { itemId });

      const patched = await apiRequest("PATCH", `/api/procurement/${itemId}`, { status: "approved", notes: "approved from workflow test" }, token);
      expect(patched.status).toBe(200);
      expect(patched.data?.status).toBe("approved");
      log.step("approve_procurement_item");

      const staleMutation = await apiRequest("PATCH", `/api/procurement/${itemId}`, { status: "quoted" }, token);
      expect(staleMutation.status).toBe(400);
      log.step("stale_state_transition_rejected", { status: staleMutation.status });

      const readAfterMutation = await apiRequest("GET", `/api/procurement/${itemId}`, undefined, token);
      expect(readAfterMutation.status).toBe(200);
      expect(readAfterMutation.data?.status).toBe("approved");
      log.step("re_read_reflects_persisted_status");

      const duplicatePatch = await apiRequest("PATCH", `/api/procurement/${itemId}`, { status: "approved" }, token);
      expect(duplicatePatch.status).toBe(200);
      const listing = await apiRequest("GET", `/api/procurement/project/${projectId}`, undefined, token);
      const matches = (listing.data || []).filter((row: any) => row.id === itemId);
      expect(matches.length).toBe(1);
      log.step("duplicate_submit_no_duplicate_record", { listedMatches: matches.length });

      const deleted = await apiRequest("DELETE", `/api/procurement/${itemId}`, undefined, token);
      expect(deleted.status).toBe(200);
      log.step("delete_procurement_item");

      const postDelete = await apiRequest("GET", `/api/procurement/project/${projectId}`, undefined, token);
      const deletedMatches = (postDelete.data || []).filter((row: any) => row.id === itemId);
      expect(deletedMatches.length).toBe(0);
      log.step("reload_confirms_deleted");

      log.pass();
    } catch (err) {
      log.fail("procurement_flow", err);
    }
  });

  it("Permission mismatch defense: non-admin is blocked from admin-only actions while admin succeeds", async () => {
    const log = createWorkflowLogger("Permission mismatch between UI intent and API guard");
    try {
      const adminToken = await loginAdmin();
      const pmLogin = await apiRequest("POST", "/api/auth/login", { username: "eon", password: "2035" });
      expect(pmLogin.status).toBe(200);
      const pmToken = pmLogin.data?.token as string;
      expect(pmToken).toBeTruthy();
      log.step("login_admin_and_non_admin");

      const nonAdminCreate = await apiRequest("POST", "/api/mytool/tasks", { title: `WF Perm ${Date.now()}`, status: "todo", priority: "normal" }, pmToken);
      expect([401, 403]).toContain(nonAdminCreate.status);
      log.step("non_admin_mutation_rejected", { status: nonAdminCreate.status });

      const adminCreate = await apiRequest("POST", "/api/mytool/tasks", { title: `WF Admin ${Date.now()}`, status: "todo", priority: "normal" }, adminToken);
      expect(adminCreate.status).toBe(200);
      const taskId = adminCreate.data?.id;
      expect(taskId).toBeTruthy();
      log.step("admin_mutation_allowed", { taskId });

      const nonAdminDelete = await apiRequest("DELETE", `/api/mytool/tasks/${taskId}`, undefined, pmToken);
      expect([401, 403]).toContain(nonAdminDelete.status);
      log.step("non_admin_delete_rejected", { status: nonAdminDelete.status });

      const adminDelete = await apiRequest("DELETE", `/api/mytool/tasks/${taskId}`, undefined, adminToken);
      expect(adminDelete.status).toBe(200);
      log.step("admin_cleanup_delete");

      log.pass();
    } catch (err) {
      log.fail("permission_mismatch", err);
    }
  });
});

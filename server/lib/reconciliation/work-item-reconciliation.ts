import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { operationalTasks, projectInfo, users, workItems } from "@shared/schema";

type ReconciliationStatus = "pass" | "warning" | "fail";
type TaskRecord = { id: number; projectId: number | null; projectName: string; title: string; dueDate: string | null; owner: string | null; legacyTable: string | null; legacyId: number | null; externalRef: string | null; };
type ProjectReport = { project_id: number | null; project_name: string; legacy_count: number; canonical_count: number; matched_by_linkage: number; matched_by_business_identity: number; unmatched_legacy_ids: number[]; unmatched_canonical_ids: number[]; duplicate_business_identity_keys: string[]; status: ReconciliationStatus; reasons: string[]; };

export type WorkItemReconciliationReport = { generated_at: string; scope: "engineering" | "all-work-items"; totals: { projects: number; pass: number; warning: number; fail: number; legacy_count: number; canonical_count: number; matched_by_linkage: number; matched_by_business_identity: number; }; status: ReconciliationStatus; projects: ProjectReport[]; };

const normalizeText = (value: string | null | undefined) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");
function normalizeDate(value: string | null | undefined): string {
  if (!value) return "";
  const isoMatch = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.trim().toLowerCase() : parsed.toISOString().slice(0, 10);
}

function buildBusinessIdentityKey(item: TaskRecord): string {
  return [item.projectId ?? "", normalizeText(item.title), normalizeDate(item.dueDate), normalizeText(item.owner), normalizeText(item.externalRef), normalizeText(item.legacyTable), item.legacyId ?? ""].join("|");
}
const worstStatus = (statuses: ReconciliationStatus[]): ReconciliationStatus => statuses.some((s) => s === "fail") ? "fail" : statuses.some((s) => s === "warning") ? "warning" : "pass";
const statusRank = (status: ReconciliationStatus) => (status === "fail" ? 2 : status === "warning" ? 1 : 0);

export async function generateWorkItemReconciliationReport(workstream?: "ENG"): Promise<WorkItemReconciliationReport> {
  const legacyRows = await db
    .select({
      id: operationalTasks.id,
      project_id: operationalTasks.projectId,
      project_name: projectInfo.projectName,
      title: operationalTasks.title,
      due_date: operationalTasks.dueDate,
      owner: users.name,
      external_ref: operationalTasks.externalTaskId,
    })
    .from(operationalTasks)
    .leftJoin(users, eq(users.id, operationalTasks.ownerUserId))
    .leftJoin(projectInfo, eq(projectInfo.id, operationalTasks.projectId))
    .where(isNull(operationalTasks.deletedAt));

  const canonicalRows = await db
    .select({
      id: workItems.id,
      project_id: workItems.projectId,
      project_name: projectInfo.projectName,
      title: workItems.title,
      due_date: workItems.endDate,
      owner_name: workItems.ownerName,
      owner_user_name: users.name,
      external_ref: workItems.externalRef,
      legacy_table: workItems.legacyTable,
      legacy_id: workItems.legacyId,
    })
    .from(workItems)
    .leftJoin(users, eq(users.id, workItems.ownerUserId))
    .leftJoin(projectInfo, eq(projectInfo.id, workItems.projectId))
    .where(workstream
      ? and(isNull(workItems.deletedAt), eq(workItems.workstream, workstream))
      : isNull(workItems.deletedAt));

  const legacyByProject = new Map<number | null, TaskRecord[]>();
  const canonicalByProject = new Map<number | null, TaskRecord[]>();

  for (const row of legacyRows as any[]) {
    const task: TaskRecord = {
      id: Number(row.id),
      projectId: row.project_id != null ? Number(row.project_id) : null,
      projectName: String(row.project_name || "Unknown"),
      title: String(row.title || ""),
      dueDate: row.due_date ? String(row.due_date) : null,
      owner: row.owner ? String(row.owner) : null,
      legacyTable: "operational_tasks",
      legacyId: row.id != null ? Number(row.id) : null,
      externalRef: row.external_ref ? String(row.external_ref) : null,
    };
    legacyByProject.set(task.projectId, [...(legacyByProject.get(task.projectId) || []), task]);
  }

  for (const row of canonicalRows as any[]) {
    const task: TaskRecord = {
      id: Number(row.id),
      projectId: row.project_id != null ? Number(row.project_id) : null,
      projectName: String(row.project_name || "Unknown"),
      title: String(row.title || ""),
      dueDate: row.due_date ? String(row.due_date) : null,
      owner: row.owner_name ? String(row.owner_name) : row.owner_user_name ? String(row.owner_user_name) : null,
      legacyTable: row.legacy_table ? String(row.legacy_table) : null,
      legacyId: row.legacy_id != null ? Number(row.legacy_id) : null,
      externalRef: row.external_ref ? String(row.external_ref) : null,
    };
    canonicalByProject.set(task.projectId, [...(canonicalByProject.get(task.projectId) || []), task]);
  }

  const projects: ProjectReport[] = [];
  const projectIds = new Set([...legacyByProject.keys(), ...canonicalByProject.keys()]);
  for (const projectId of projectIds) {
    const legacy = [...(legacyByProject.get(projectId) || [])];
    const canonical = [...(canonicalByProject.get(projectId) || [])];
    const unmatchedLegacy = [...legacy];
    const unmatchedCanonical = [...canonical];
    let matchedByLinkage = 0;
    let matchedByBusinessIdentity = 0;

    for (let i = unmatchedLegacy.length - 1; i >= 0; i -= 1) {
      const legacyTask = unmatchedLegacy[i];
      const canonicalIndex = unmatchedCanonical.findIndex((item) => (
        normalizeText(item.legacyTable) === "operational_tasks" && item.legacyId === legacyTask.id
      ) || normalizeText(item.externalRef) === `operational_tasks:${legacyTask.id}`);
      if (canonicalIndex >= 0) {
        unmatchedLegacy.splice(i, 1);
        unmatchedCanonical.splice(canonicalIndex, 1);
        matchedByLinkage += 1;
      }
    }

    for (let i = unmatchedLegacy.length - 1; i >= 0; i -= 1) {
      const legacyTask = unmatchedLegacy[i];
      const legacyKey = buildBusinessIdentityKey(legacyTask);
      const canonicalIndex = unmatchedCanonical.findIndex((item) => buildBusinessIdentityKey(item) === legacyKey);
      if (canonicalIndex >= 0) {
        unmatchedLegacy.splice(i, 1);
        unmatchedCanonical.splice(canonicalIndex, 1);
        matchedByBusinessIdentity += 1;
      }
    }

    const duplicateCounter = new Map<string, number>();
    for (const item of canonical) {
      const key = buildBusinessIdentityKey(item);
      duplicateCounter.set(key, (duplicateCounter.get(key) || 0) + 1);
    }
    const duplicateBusinessIdentityKeys = [...duplicateCounter.entries()].filter(([, count]) => count > 1).map(([key]) => key);

    const reasons: string[] = [];
    let status: ReconciliationStatus = "pass";
    if (unmatchedLegacy.length > 0) {
      status = "fail";
      reasons.push(`Missing canonical counterparts for ${unmatchedLegacy.length} legacy tasks.`);
    }
    if (duplicateBusinessIdentityKeys.length > 0) {
      status = "fail";
      reasons.push(`Duplicate canonical business identities detected (${duplicateBusinessIdentityKeys.length}).`);
    }
    if (status !== "fail" && unmatchedCanonical.length > 0) {
      status = "warning";
      reasons.push(`Canonical contains ${unmatchedCanonical.length} extra task(s) not linked to legacy.`);
    }
    if (status !== "fail" && matchedByBusinessIdentity > 0) {
      status = "warning";
      reasons.push(`Matched ${matchedByBusinessIdentity} task(s) by business identity without strict linkage proof.`);
    }
    if (reasons.length === 0) reasons.push("All tasks reconciled with strict legacy linkage.");

    projects.push({
      project_id: projectId as number | null,
      project_name: legacy[0]?.projectName || canonical[0]?.projectName || "Unknown",
      legacy_count: legacy.length,
      canonical_count: canonical.length,
      matched_by_linkage: matchedByLinkage,
      matched_by_business_identity: matchedByBusinessIdentity,
      unmatched_legacy_ids: unmatchedLegacy.map((item) => item.id).sort((a, b) => a - b),
      unmatched_canonical_ids: unmatchedCanonical.map((item) => item.id).sort((a, b) => a - b),
      duplicate_business_identity_keys: duplicateBusinessIdentityKeys,
      status,
      reasons,
    });
  }

  projects.sort((a, b) => {
    const severity = statusRank(b.status) - statusRank(a.status);
    return severity !== 0 ? severity : a.project_name.localeCompare(b.project_name);
  });

  return {
    generated_at: new Date().toISOString(),
    scope: workstream ? "engineering" : "all-work-items",
    totals: {
      projects: projects.length,
      pass: projects.filter((project) => project.status === "pass").length,
      warning: projects.filter((project) => project.status === "warning").length,
      fail: projects.filter((project) => project.status === "fail").length,
      legacy_count: projects.reduce((sum, project) => sum + project.legacy_count, 0),
      canonical_count: projects.reduce((sum, project) => sum + project.canonical_count, 0),
      matched_by_linkage: projects.reduce((sum, project) => sum + project.matched_by_linkage, 0),
      matched_by_business_identity: projects.reduce((sum, project) => sum + project.matched_by_business_identity, 0),
    },
    status: worstStatus(projects.map((project) => project.status)),
    projects,
  };
}

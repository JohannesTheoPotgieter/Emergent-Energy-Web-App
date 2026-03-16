import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { formatDistanceToNowStrict } from "date-fns";
import { Package, ExternalLink, FolderOpen, FileCheck, ShieldCheck, RefreshCw, AlertTriangle, Link2, Clock } from "lucide-react";
import type { PlatformProjectSummaryContract } from "@shared/platform-contracts";
import CaptureDeliverable from "@/components/CaptureDeliverable";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";

type DeliverableRow = {
  id: number;
  title: string;
  deliverable_type: string | null;
  status: string;
  created_at: string;
  original_file_name?: string | null;
  linked_work_item_title?: string | null;
  linked_cost_description?: string | null;
  linked_revenue_milestone?: string | null;
  primaryAssignment?: {
    displayName?: string | null;
  } | null;
};

type ApprovalItem = {
  id: string;
  type: "engineering" | "quality" | "deliverable" | "general";
  title: string;
  projectName: string;
  projectId: number | null;
  status: string;
};

type MsLinkedItem = {
  id: number;
  type: string;
  subjectOrTitle?: string | null;
  preview?: string | null;
  webLink?: string | null;
  linkedTaskId?: number | null;
  actionRequired?: boolean | null;
  receivedOrStartDatetime?: string | null;
};

type ProjectListRow = {
  project_info_id: number | null;
  project_name: string;
  latest_update: string | null;
  latest_update_at: string | null;
  latest_update_by: string | null;
  has_tracker_import: boolean;
  last_import_at?: string | null;
  task_status_counts: Record<string, number>;
  shared_summary?: PlatformProjectSummaryContract | null;
  is_active: boolean;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(), credentials: "include" });
  if (!res.ok) {
    throw new Error(`Request failed: ${url}`);
  }
  return res.json();
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Not available";
  try {
    return new Date(value).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function getRelativeTime(value?: string | null): string | null {
  if (!value) return null;
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return null;
  }
}

function getKpiValue(summary: PlatformProjectSummaryContract | null | undefined, id: string): number {
  return summary?.kpis.find((kpi) => kpi.id === id)?.value || 0;
}

function getDeliverableLinkLabel(row: DeliverableRow): string {
  return row.linked_work_item_title || row.linked_cost_description || row.linked_revenue_milestone || "Unlinked";
}

export default function PMDeliverablesPage() {
  const [, navigate] = useLocation();
  const [selectedProjectName, setSelectedProjectName] = useState("");

  const { data: allProjects = [], isLoading: loadingProjects } = useQuery<ProjectListRow[]>({
    queryKey: ["/api/projects-summary", "pm-deliverables"],
    queryFn: () => fetchJson<ProjectListRow[]>("/api/projects-summary"),
    staleTime: 30_000,
  });

  const projects = useMemo(
    () => allProjects.filter((project) => project.is_active && project.has_tracker_import && project.project_info_id != null),
    [allProjects],
  );

  useEffect(() => {
    if (!selectedProjectName && projects.length > 0) {
      setSelectedProjectName(projects[0].project_name);
    }
  }, [projects, selectedProjectName]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.project_name === selectedProjectName) || null,
    [projects, selectedProjectName],
  );

  const selectedProjectId = selectedProject?.project_info_id ?? null;

  const { data: deliverables = [], isLoading: loadingDeliverables } = useQuery<DeliverableRow[]>({
    queryKey: ["deliverable-capture-list", selectedProjectId],
    queryFn: () => fetchJson<DeliverableRow[]>(`/api/deliverable-capture/list/${selectedProjectId}`),
    enabled: !!selectedProjectId,
    staleTime: 15_000,
  });

  const { data: approvalsData, isLoading: loadingApprovals } = useQuery<{ items: ApprovalItem[] }>({
    queryKey: ["/api/approvals/pending", "deliverables", selectedProjectName],
    queryFn: () => fetchJson<{ items: ApprovalItem[] }>("/api/approvals/pending?showAll=true"),
    enabled: !!selectedProjectName,
    staleTime: 15_000,
  });

  const { data: microsoftItems = [], isLoading: loadingMicrosoft } = useQuery<MsLinkedItem[]>({
    queryKey: ["pm-deliverables-ms-items", selectedProjectId],
    queryFn: () => fetchJson<MsLinkedItem[]>(`/api/ms-objects/project/${selectedProjectId}`),
    enabled: !!selectedProjectId,
    staleTime: 15_000,
  });

  const deliverableApprovals = useMemo(
    () =>
      (approvalsData?.items || []).filter((item) =>
        item.type === "deliverable" &&
        (item.projectId === selectedProjectId || item.projectName === selectedProjectName),
      ),
    [approvalsData?.items, selectedProjectId, selectedProjectName],
  );

  const overdueCount = getKpiValue(selectedProject?.shared_summary, "tasks_overdue");
  const blockedCount = (selectedProject?.task_status_counts?.Blocked || 0) + (selectedProject?.task_status_counts?.BLOCKED || 0);
  const latestUpdateAge = getRelativeTime(selectedProject?.latest_update_at);
  const lastImportAge = getRelativeTime(selectedProject?.last_import_at);
  const microsoftActionItems = microsoftItems.filter((item) => item.actionRequired);

  return (
    <PageShell className="p-4 md:p-6" data-testid="pm-deliverables-page">
      <SectionHeader
        icon={<Package className="h-5 w-5" />}
        title="Deliverables"
        description="Execution deliverable hub for post-handover projects. Deliverable-required work must use the deliverable flow only."
        actions={
          <div className="flex items-center gap-2">
            {selectedProjectId ? (
              <CaptureDeliverable
                projectId={selectedProjectId}
                projectName={selectedProjectName}
                trigger={
                  <Button size="sm" data-testid="btn-capture-deliverable-pm">
                    <Package className="mr-1.5 h-4 w-4" />
                    Capture Deliverable
                  </Button>
                }
              />
            ) : null}
            {selectedProject ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/project/${encodeURIComponent(selectedProject.project_name)}?tab=task-grid`)}
                data-testid="btn-open-project-detail"
              >
                Open Project
              </Button>
            ) : null}
          </div>
        }
      />

      <Card className="border-border/70 bg-muted/20">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-foreground">Tracker-linked execution truth</p>
            <p className="text-xs text-muted-foreground">
              Dates, finance, and execution visibility stay tracker-fed where applicable. Latest Update remains the canonical text-only app update with history retained.
            </p>
          </div>
          <div className="w-full max-w-md">
            <SearchableSelect
              value={selectedProjectName}
              onValueChange={setSelectedProjectName}
              placeholder={loadingProjects ? "Loading projects..." : "Select a project"}
              data-testid="select-pm-deliverable-project"
              options={projects.map((project) => ({
                value: project.project_name,
                label: project.project_name,
              }))}
            />
          </div>
        </CardContent>
      </Card>

      {selectedProject ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Pending approvals
                </div>
                <p className="text-2xl font-semibold" data-testid="stat-deliverable-approvals">
                  {loadingApprovals ? "..." : deliverableApprovals.length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <FileCheck className="h-3.5 w-3.5" />
                  Captured deliverables
                </div>
                <p className="text-2xl font-semibold" data-testid="stat-deliverables-count">
                  {loadingDeliverables ? "..." : deliverables.length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Blocked / overdue
                </div>
                <p className="text-2xl font-semibold" data-testid="stat-execution-attention">
                  {blockedCount + overdueCount}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {blockedCount} blocked, {overdueCount} overdue
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5" />
                  Microsoft-linked items
                </div>
                <p className="text-2xl font-semibold" data-testid="stat-ms-links">
                  {loadingMicrosoft ? "..." : microsoftItems.length}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {microsoftActionItems.length} need action
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Latest Update</p>
                <p className="mt-1 text-sm text-foreground">{selectedProject.latest_update || "No latest update yet."}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {selectedProject.latest_update_by || "Unknown"}{latestUpdateAge ? `, ${latestUpdateAge}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Tracker status</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant={selectedProject.has_tracker_import ? "default" : "secondary"}>
                    {selectedProject.has_tracker_import ? "Tracker-linked" : "App-only"}
                  </Badge>
                  {selectedProject.last_import_at ? (
                    <span className="text-[11px] text-muted-foreground">
                      Last import {lastImportAge || formatDateTime(selectedProject.last_import_at)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No import timestamp available</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Workflow summary</p>
                <p className="mt-1 text-sm text-foreground">
                  {selectedProject.shared_summary?.workflow.deliverables.completed || 0} completed deliverables,
                  {" "}
                  {selectedProject.shared_summary?.workflow.approvals.pending || 0} pending approvals
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardContent className="p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Project deliverables</h2>
                    <p className="text-xs text-muted-foreground">
                      Captured deliverables remain linked back to the right project and execution item where available.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/projects")}
                    data-testid="btn-open-project-list"
                  >
                    <FolderOpen className="mr-1.5 h-4 w-4" />
                    Project List
                  </Button>
                </div>

                <div className="space-y-2">
                  {loadingDeliverables ? (
                    <p className="text-sm text-muted-foreground">Loading deliverables...</p>
                  ) : deliverables.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No captured deliverables for this project yet.
                    </div>
                  ) : (
                    deliverables.map((row) => (
                      <div key={row.id} className="rounded-lg border p-3" data-testid={`deliverable-row-${row.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                              <Badge variant="outline">{row.status}</Badge>
                              {row.deliverable_type ? (
                                <Badge variant="secondary" className="text-[10px] uppercase">
                                  {row.deliverable_type.replace(/_/g, " ")}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Linked to {getDeliverableLinkLabel(row)}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Owner: {row.primaryAssignment?.displayName || "Unassigned"} | Captured {formatDateTime(row.created_at)}
                            </p>
                          </div>
                          <a
                            href={`/api/deliverable-capture/download/${row.id}`}
                            className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-foreground hover:bg-muted"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Download
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold">Deliverable approvals</h2>
                      <p className="text-xs text-muted-foreground">Approval-required items must be handled via Send for Approval.</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => navigate("/pm/approvals")} data-testid="btn-open-pm-approvals">
                      Open approvals
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {loadingApprovals ? (
                      <p className="text-sm text-muted-foreground">Loading approvals...</p>
                    ) : deliverableApprovals.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No deliverable approvals pending for this project.</p>
                    ) : (
                      deliverableApprovals.map((item) => (
                        <div key={item.id} className="rounded-lg border p-3" data-testid={`deliverable-approval-${item.id}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                              <p className="text-[11px] text-muted-foreground">{item.status}</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => navigate("/pm/approvals")}>
                              Review
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="mb-3">
                    <h2 className="text-base font-semibold">Microsoft-linked execution items</h2>
                    <p className="text-xs text-muted-foreground">
                      Linked communication and follow-ups stay tied back to the project and can open the original Microsoft item.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {loadingMicrosoft ? (
                      <p className="text-sm text-muted-foreground">Loading Microsoft links...</p>
                    ) : microsoftItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No Microsoft-linked execution items for this project.</p>
                    ) : (
                      microsoftItems.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-lg border p-3" data-testid={`ms-linked-item-${item.id}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {item.subjectOrTitle || "Untitled Microsoft item"}
                                </p>
                                {item.actionRequired ? <Badge variant="destructive">Action required</Badge> : null}
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {item.type} {item.receivedOrStartDatetime ? `| ${formatDateTime(item.receivedOrStartDatetime)}` : ""}
                              </p>
                              {item.preview ? (
                                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.preview}</p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/project/${encodeURIComponent(selectedProject.project_name)}?tab=task-grid`)}
                              >
                                <Clock className="mr-1.5 h-3.5 w-3.5" />
                                Project
                              </Button>
                              {item.webLink ? (
                                <a
                                  href={item.webLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-foreground hover:bg-muted"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Open
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Select a tracker-linked execution project to review deliverables, approvals, and Microsoft-linked items.
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

/**
 * Quality Task Board — compact, work-item-driven surface.
 *
 * Mirrors the Engineering delivery redesign (PageShell + SectionHeader, a KPI
 * strip, one compact filter bar, a per-project rollup, and a slim table). The
 * board is driven entirely by work items flagged as quality tasks against a
 * project: it reads GET /api/quality/tasks, which derives quality + NCR work
 * items from the work-item spine (server/lib/quality-task-filters.ts) and
 * returns ownership, source and counts server-side.
 *
 * Quality tasks ARE engineering-lane work items, so the single workflow
 * chokepoint that actions them lives in the Engineering Task Manager. Opening a
 * row deep-links there; this board is the quality-scoped triage view.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ListChecks,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  CalendarClock,
  UserX,
  ListTodo,
  Search,
  ExternalLink,
  Building2,
} from "lucide-react";
import { PageShell, SectionHeader, KPIStrip, WorkspaceNotice } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { getUniversalStatusLabel, getUniversalStatusBadgeClass, isTaskComplete } from "@shared/task-status";
import { useAuth } from "@/hooks/use-auth";
import { fetchQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface QualityTask {
  id: number;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  source?: string | null;
  discipline?: string | null;
  dueDate?: string | Date | null;
  projectId?: number | null;
  projectName?: string | null;
  assigneeId?: number | null;
  assigneeName?: string | null;
  linkedQualityItemInstanceId?: number | null;
  taskTypeTag?: string | null;
}

interface QualityTaskCounts {
  total: number;
  overdue: number;
  unassigned: number;
  byStatus: Record<string, number>;
}

interface QualityTaskResponse {
  tasks?: QualityTask[];
  items?: QualityTask[];
  counts?: QualityTaskCounts;
}

// Source vocabulary returned by the server (deriveQualitySource).
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  ncr: { label: "NCR", cls: "bg-red-50 text-red-700 border-red-200" },
  evidence: { label: "Evidence", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  qa: { label: "QA / QC", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  quality: { label: "Quality", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

function sourceMeta(source?: string | null) {
  const key = String(source || "quality").toLowerCase();
  return SOURCE_META[key] ?? { label: source || "Quality", cls: "bg-muted text-muted-foreground border-border" };
}

function dueMs(d?: string | Date | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

function isTaskOverdue(task: QualityTask, todayStart: number): boolean {
  if (isTaskComplete(String(task.status || ""))) return false;
  const ms = dueMs(task.dueDate);
  return ms != null && ms < todayStart;
}

// ----- Persisted filter selection (per user) --------------------------------

interface QualityTaskFilterState {
  projectId: string;
  ownerId: string;
  status: string;
  source: string;
  hideCompleted: boolean;
}

const DEFAULT_FILTERS: QualityTaskFilterState = {
  projectId: "",
  ownerId: "",
  status: "",
  source: "",
  hideCompleted: true,
};

function filterKey(userId?: number): string {
  return `quality_task_filters_${userId ?? "default"}`;
}

function loadFilters(userId?: number): QualityTaskFilterState {
  try {
    const raw = localStorage.getItem(filterKey(userId));
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<QualityTaskFilterState> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_FILTERS;
    return {
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : "",
      status: typeof parsed.status === "string" ? parsed.status : "",
      source: typeof parsed.source === "string" ? parsed.source : "",
      hideCompleted: typeof parsed.hideCompleted === "boolean" ? parsed.hideCompleted : true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(state: QualityTaskFilterState, userId?: number) {
  try {
    localStorage.setItem(filterKey(userId), JSON.stringify(state));
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

function MetricCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "danger" | "warning";
}) {
  const active = value > 0 && tone;
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            active && tone === "danger"
              ? "bg-red-100 text-red-600"
              : active && tone === "warning"
                ? "bg-amber-100 text-amber-700"
                : "bg-primary/8 text-primary",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4" data-testid="quality-tasks-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export default function QualityTasksPage() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<QualityTaskResponse>({
    queryKey: ["/api/quality/tasks"],
    queryFn: fetchQueryFn<QualityTaskResponse>("/api/quality/tasks"),
  });

  const allTasks = useMemo(() => data?.tasks ?? data?.items ?? [], [data]);

  const [filters, setFilters] = useState<QualityTaskFilterState>(() => loadFilters(userId));
  const [search, setSearch] = useState("");

  // Re-hydrate from the per-user key once the authed user resolves.
  useEffect(() => {
    setFilters(loadFilters(userId));
  }, [userId]);

  const setAndPersist = (next: QualityTaskFilterState) => {
    setFilters(next);
    saveFilters(next, userId);
  };

  // Filter option lists derive from the full task set (stable regardless of
  // which filters are active), mirroring the Engineering pattern.
  const projectOptions: SearchableSelectOption[] = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of allTasks) {
      if (typeof t.projectId === "number" && t.projectName) map.set(t.projectId, t.projectName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ value: String(id), label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allTasks]);

  const ownerOptions: SearchableSelectOption[] = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of allTasks) {
      if (typeof t.assigneeId === "number" && t.assigneeName) map.set(t.assigneeId, t.assigneeName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ value: String(id), label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allTasks]);

  const statusOptions: SearchableSelectOption[] = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) if (t.status) set.add(String(t.status));
    return [...set]
      .map((s) => ({ value: s, label: getUniversalStatusLabel(s) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allTasks]);

  const sourceOptions: SearchableSelectOption[] = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) set.add(String(t.source || "quality").toLowerCase());
    return [...set]
      .map((s) => ({ value: s, label: sourceMeta(s).label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allTasks]);

  // `scoped` = everything except the hide-completed toggle and the search box.
  // The KPI strip and per-project rollup read this so they stay stable when the
  // user hides completed work; the table applies hide-completed + search on top.
  const scoped = useMemo(() => {
    return allTasks.filter((t) => {
      if (filters.projectId && String(t.projectId ?? "") !== filters.projectId) return false;
      if (filters.ownerId && String(t.assigneeId ?? "") !== filters.ownerId) return false;
      if (filters.status && String(t.status ?? "") !== filters.status) return false;
      if (filters.source && String(t.source || "quality").toLowerCase() !== filters.source) return false;
      return true;
    });
  }, [allTasks, filters.projectId, filters.ownerId, filters.status, filters.source]);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const metrics = useMemo(() => {
    let open = 0;
    let overdue = 0;
    let unassigned = 0;
    let done = 0;
    for (const t of scoped) {
      const complete = isTaskComplete(String(t.status || ""));
      if (complete) {
        done += 1;
        continue;
      }
      open += 1;
      if (isTaskOverdue(t, todayStart)) overdue += 1;
      if (!t.assigneeId) unassigned += 1;
    }
    return { open, overdue, unassigned, done };
  }, [scoped, todayStart]);

  const projectRollup = useMemo(() => {
    const map = new Map<string, { projectName: string; open: number; overdue: number; done: number; total: number }>();
    for (const t of scoped) {
      const name = t.projectName ?? "No project";
      const row = map.get(name) ?? { projectName: name, open: 0, overdue: 0, done: 0, total: 0 };
      row.total += 1;
      if (isTaskComplete(String(t.status || ""))) row.done += 1;
      else {
        row.open += 1;
        if (isTaskOverdue(t, todayStart)) row.overdue += 1;
      }
      map.set(name, row);
    }
    return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.projectName.localeCompare(b.projectName));
  }, [scoped, todayStart]);

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((t) => {
      if (filters.hideCompleted && isTaskComplete(String(t.status || ""))) return false;
      if (q) {
        const hay = [t.title, t.description, t.projectName, t.assigneeName, t.status, t.taskTypeTag]
          .filter((v): v is string => typeof v === "string")
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scoped, filters.hideCompleted, search]);

  const filtersActive =
    !!filters.projectId || !!filters.ownerId || !!filters.status || !!filters.source || !filters.hideCompleted || !!search;

  const resetFilters = () => {
    setAndPersist(DEFAULT_FILTERS);
    setSearch("");
  };

  return (
    <PageShell data-testid="quality-tasks-page">
      <SectionHeader
        icon={<ListChecks className="h-5 w-5" />}
        eyebrow="Quality"
        title="Task Board"
        description="Work items flagged as quality tasks across every project — NCRs, evidence, and QA/QC checks."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="quality-tasks-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {/* Filter bar — slice by project, owner, status, source + hide completed. */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
        data-testid="quality-tasks-filters"
      >
        <div className="relative min-w-0 flex-1 sm:flex-none sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title, project, assignee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8"
            data-testid="quality-tasks-search"
          />
        </div>

        <SearchableSelect
          options={projectOptions}
          value={filters.projectId}
          onValueChange={(v) => setAndPersist({ ...filters, projectId: v })}
          placeholder="All projects"
          searchPlaceholder="Search projects…"
          emptyText="No projects with quality tasks."
          triggerClassName="h-9 w-48"
          className="w-48"
          data-testid="quality-tasks-project-filter"
        />

        <SearchableSelect
          options={ownerOptions}
          value={filters.ownerId}
          onValueChange={(v) => setAndPersist({ ...filters, ownerId: v })}
          placeholder="All owners"
          searchPlaceholder="Search owners…"
          emptyText="No owners with quality tasks."
          triggerClassName="h-9 w-44"
          className="w-44"
          data-testid="quality-tasks-owner-filter"
        />

        <SearchableSelect
          options={statusOptions}
          value={filters.status}
          onValueChange={(v) => setAndPersist({ ...filters, status: v })}
          placeholder="All statuses"
          triggerClassName="h-9 w-40"
          className="w-40"
          data-testid="quality-tasks-status-filter"
        />

        <SearchableSelect
          options={sourceOptions}
          value={filters.source}
          onValueChange={(v) => setAndPersist({ ...filters, source: v })}
          placeholder="All sources"
          triggerClassName="h-9 w-40"
          className="w-40"
          data-testid="quality-tasks-source-filter"
        />

        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="quality-hide-completed"
            checked={filters.hideCompleted}
            onCheckedChange={(checked) => setAndPersist({ ...filters, hideCompleted: checked })}
            data-testid="quality-tasks-hide-completed"
          />
          <Label htmlFor="quality-hide-completed" className="cursor-pointer text-xs text-muted-foreground">
            Hide completed
          </Label>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-muted-foreground"
              onClick={resetFilters}
              data-testid="quality-tasks-filters-reset"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <BoardSkeleton />
      ) : isError ? (
        <WorkspaceNotice
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Couldn't load quality tasks"
          description={error instanceof Error ? error.message : "Please try again."}
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          }
        />
      ) : (
        <div className="space-y-5" data-testid="quality-tasks-content">
          <KPIStrip className="grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Open tasks" value={metrics.open} icon={<ListTodo className="h-4 w-4" />} />
            <MetricCard label="Overdue" value={metrics.overdue} icon={<CalendarClock className="h-4 w-4" />} tone="danger" />
            <MetricCard label="Unassigned" value={metrics.unassigned} icon={<UserX className="h-4 w-4" />} tone="warning" />
            <MetricCard label="Completed" value={metrics.done} icon={<CheckCircle2 className="h-4 w-4" />} />
          </KPIStrip>

          {/* Per-project rollup — quality tasks against each project. */}
          <Card className="border-border bg-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Quality work by project
                </h2>
                <span className="text-xs text-muted-foreground">{projectRollup.length} projects</span>
              </div>
              {projectRollup.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {filtersActive ? "No quality tasks match the current filters." : "No quality tasks on any project yet."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Project</th>
                        <th className="px-4 py-2 text-right font-medium">Open</th>
                        <th className="px-4 py-2 text-right font-medium">Overdue</th>
                        <th className="px-4 py-2 text-right font-medium">Done</th>
                        <th className="px-4 py-2 text-right font-medium">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectRollup.map((row) => {
                        const progress = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
                        const projectIdForRow = projectOptions.find((o) => o.label === row.projectName)?.value;
                        const clickable = !!projectIdForRow;
                        return (
                          <tr
                            key={row.projectName}
                            className={cn(
                              "border-b border-border/40 last:border-0",
                              clickable && "cursor-pointer hover:bg-muted/40",
                            )}
                            onClick={clickable ? () => setAndPersist({ ...filters, projectId: projectIdForRow! }) : undefined}
                            data-testid={`quality-project-row-${row.projectName}`}
                          >
                            <td className="px-4 py-2.5 font-medium text-foreground">{row.projectName}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{row.open}</td>
                            <td className={cn("px-4 py-2.5 text-right tabular-nums", row.overdue > 0 && "font-semibold text-red-600")}>
                              {row.overdue}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{row.done}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                                </div>
                                <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Task list. Quality tasks are actioned in the Engineering Task
              Manager (single workflow chokepoint) — opening a row deep-links there. */}
          <Card className="border-border bg-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Tasks</h2>
                <span className="text-xs text-muted-foreground">
                  {visibleTasks.length} of {scoped.length} shown
                </span>
              </div>
              {visibleTasks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <ShieldCheck className="h-6 w-6 text-emerald-500" />
                  <p className="text-sm text-muted-foreground">
                    {allTasks.length === 0
                      ? "No quality or NCR work items yet. New items appear here as quality checklists and NCRs raise tasks."
                      : "No quality tasks match the current filters."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Task</th>
                        <th className="hidden px-4 py-2 font-medium md:table-cell">Project</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="hidden px-4 py-2 font-medium sm:table-cell">Source</th>
                        <th className="hidden px-4 py-2 font-medium lg:table-cell">Assignee</th>
                        <th className="hidden px-4 py-2 text-right font-medium md:table-cell">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTasks.map((t) => {
                        const overdue = isTaskOverdue(t, todayStart);
                        const src = sourceMeta(t.source);
                        const due = dueMs(t.dueDate);
                        return (
                          <tr
                            key={t.id}
                            className="border-b border-border/40 last:border-0 hover:bg-muted/40"
                            data-testid={`quality-task-row-${t.id}`}
                          >
                            <td className="px-4 py-2.5">
                              <Link
                                href={`/engineering/tasks?task=${t.id}`}
                                className="inline-flex items-center gap-1.5 font-medium hover:underline"
                                aria-label={`Open task "${t.title || `Task #${t.id}`}" in the Engineering task surface`}
                                data-testid={`quality-task-link-${t.id}`}
                              >
                                <span className="truncate">{t.title || `Task #${t.id}`}</span>
                                <Badge
                                  variant="outline"
                                  className="shrink-0 gap-0.5 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                                >
                                  Engineering
                                  <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                                </Badge>
                              </Link>
                              {/* On mobile, surface project + due inline under the title. */}
                              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground md:hidden">
                                {t.projectName && <span>{t.projectName}</span>}
                                {due != null && <span>· Due {new Date(due).toLocaleDateString()}</span>}
                              </div>
                            </td>
                            <td className="hidden px-4 py-2.5 md:table-cell">{t.projectName ?? "—"}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="secondary" className={cn("font-normal", getUniversalStatusBadgeClass(t.status))}>
                                {getUniversalStatusLabel(t.status)}
                              </Badge>
                            </td>
                            <td className="hidden px-4 py-2.5 sm:table-cell">
                              <Badge variant="outline" className={cn("text-[10px] font-normal", src.cls)}>
                                {src.label}
                              </Badge>
                            </td>
                            <td className="hidden px-4 py-2.5 lg:table-cell">{t.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                            <td className="hidden px-4 py-2.5 text-right md:table-cell">
                              {due != null ? (
                                <span className={cn("tabular-nums", overdue && "font-semibold text-red-600")}>
                                  {new Date(due).toLocaleDateString()}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

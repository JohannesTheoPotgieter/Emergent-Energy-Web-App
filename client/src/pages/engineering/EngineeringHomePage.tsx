import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Building2,
  ListTodo,
  CalendarClock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  ChevronsUpDown,
  Check,
  ListFilter,
  Users,
} from "lucide-react";
import { PageShell, SectionHeader, KPIStrip, WorkspaceNotice } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { getUniversalStatusLabel, getUniversalStatusBadgeClass } from "@shared/task-status";
import { useEngineeringProjectOptions } from "@/hooks/use-engineering-project-options";
import { useAuth } from "@/hooks/use-auth";
import { fetchQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/**
 * Engineering Home (delivery-scope rebuild, Phase 2 — filterable dashboard).
 *
 * Spine-based landing for the Engineering function — reads
 * GET /api/engineering/home (work_items workstream=ENG + read-only phase),
 * sliced by site (project), engineer (owner), and hide-completed (default on).
 * Replaces the legacy engineering-dashboard.tsx (standup/registers dropped).
 */

type DueBucket = "overdue" | "today" | "this_week" | "later" | "none";

interface HomeMetrics {
  activeProjects: number;
  openTasks: number;
  dueThisWeek: number;
  overdue: number;
}

interface PortfolioRow {
  projectId: number;
  projectName: string;
  phaseCode: string | null;
  phaseLabel: string;
  open: number;
  overdue: number;
  progress: number;
}

interface MyWorkRow {
  id: number;
  title: string;
  projectId: number | null;
  projectName: string | null;
  status: string;
  endDate: string | null;
  due: DueBucket;
}

interface OwnerOption {
  id: number;
  name: string;
}

interface EngineeringHomeSummary {
  metrics: HomeMetrics;
  portfolio: PortfolioRow[];
  myWork: MyWorkRow[];
  owners: OwnerOption[];
}

const DUE_META: Record<DueBucket, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-700" },
  today: { label: "Today", cls: "bg-amber-100 text-amber-700" },
  this_week: { label: "This week", cls: "bg-blue-100 text-blue-700" },
  later: { label: "Later", cls: "bg-muted text-foreground" },
  none: { label: "No date", cls: "bg-muted text-muted-foreground" },
};

// ----- Persisted filter selection (mirrors task-filter-config helpers) -------

interface EngHomeFilterState {
  projectIds: number[];
  ownerUserId: number | null;
  hideCompleted: boolean;
}

const DEFAULT_FILTERS: EngHomeFilterState = {
  projectIds: [],
  ownerUserId: null,
  hideCompleted: true, // Hide completed is ON by default.
};

function homeFilterKey(userId?: number): string {
  return `eng_home_filters_${userId ?? "default"}`;
}

function loadHomeFilters(userId?: number): EngHomeFilterState {
  try {
    const raw = localStorage.getItem(homeFilterKey(userId));
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<EngHomeFilterState> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_FILTERS;
    return {
      projectIds: Array.isArray(parsed.projectIds)
        ? parsed.projectIds.filter((n): n is number => typeof n === "number")
        : [],
      ownerUserId: typeof parsed.ownerUserId === "number" ? parsed.ownerUserId : null,
      hideCompleted: typeof parsed.hideCompleted === "boolean" ? parsed.hideCompleted : true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveHomeFilters(state: EngHomeFilterState, userId?: number) {
  try {
    localStorage.setItem(homeFilterKey(userId), JSON.stringify(state));
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

// ----- Site (project) multiselect — modelled on PhaseMultiSelect -------------

function SiteMultiSelect({
  options,
  selected,
  onChange,
  disabled,
}: {
  options: { id: number; name: string }[];
  selected: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const matches = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const selectedName =
    selected.length === 1 ? options.find((o) => o.id === selected[0])?.name : undefined;
  const label =
    selected.length === 0
      ? "All sites"
      : selected.length === 1
        ? (selectedName ?? "1 site")
        : `${selected.length} sites`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-48 justify-between font-normal"
          disabled={disabled}
          data-testid="engineering-home-site-filter"
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <ListFilter className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">{label}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            {selected.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {selected.length}
              </Badge>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="border-b p-2">
          <Input
            className="h-8 text-xs"
            placeholder="Search sites…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="engineering-home-site-search"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/60"
            onClick={() => onChange([])}
            data-testid="engineering-home-site-all"
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded border",
                selected.length === 0 ? "border-emerald-600 bg-emerald-600 text-white" : "border-input",
              )}
            >
              {selected.length === 0 && <Check className="h-3 w-3" />}
            </span>
            All sites
          </button>
          {matches.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                type="button"
                key={o.id}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                onClick={() => toggle(o.id)}
                data-testid={`engineering-home-site-opt-${o.id}`}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-emerald-600 bg-emerald-600 text-white" : "border-input",
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{o.name}</span>
              </button>
            );
          })}
          {matches.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No sites found</p>
          )}
        </div>
        {selected.length > 0 && (
          <div className="border-t p-1">
            <button
              type="button"
              className="w-full rounded py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              onClick={() => onChange([])}
              data-testid="engineering-home-site-clear"
            >
              Clear selection
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MetricCard({
  label,
  value,
  icon,
  danger,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            danger && value > 0 ? "bg-red-100 text-red-600" : "bg-primary/8 text-primary",
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

function HomeSkeleton() {
  return (
    <div className="space-y-4" data-testid="engineering-home-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export default function EngineeringHomePage() {
  const { user } = useAuth();
  const userId = user?.id;

  const { options: siteOptions, isLoading: sitesLoading } = useEngineeringProjectOptions();

  const [filters, setFilters] = useState<EngHomeFilterState>(() => loadHomeFilters(userId));

  // Re-hydrate from the per-user key once the authed user resolves.
  useEffect(() => {
    setFilters(loadHomeFilters(userId));
  }, [userId]);

  const setAndPersist = (next: EngHomeFilterState) => {
    setFilters(next);
    saveHomeFilters(next, userId);
  };

  // Build the request URL + a structured query key (cache identity).
  const includeCompleted = !filters.hideCompleted;
  const sortedProjectIds = useMemo(() => [...filters.projectIds].sort((a, b) => a - b), [filters.projectIds]);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (sortedProjectIds.length > 0) params.set("projectIds", sortedProjectIds.join(","));
    if (filters.ownerUserId != null) params.set("ownerUserId", String(filters.ownerUserId));
    if (includeCompleted) params.set("includeCompleted", "true");
    const qs = params.toString();
    return qs ? `/api/engineering/home?${qs}` : "/api/engineering/home";
  }, [sortedProjectIds, filters.ownerUserId, includeCompleted]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<EngineeringHomeSummary>({
    queryKey: [
      "/api/engineering/home",
      { projectIds: sortedProjectIds, ownerUserId: filters.ownerUserId, includeCompleted },
    ],
    queryFn: fetchQueryFn<EngineeringHomeSummary>(requestUrl),
  });

  const ownerSelectOptions: SearchableSelectOption[] = useMemo(
    () => (data?.owners ?? []).map((o) => ({ value: String(o.id), label: o.name })),
    [data?.owners],
  );

  const filtersActive =
    filters.projectIds.length > 0 || filters.ownerUserId != null || !filters.hideCompleted;

  return (
    <PageShell>
      <SectionHeader
        icon={<Home className="h-5 w-5" />}
        eyebrow="Engineering"
        title="Home"
        description="Delivery work across the engineering discipline, from financial close to handover."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="engineering-home-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {/* Filter bar — slice by site, engineer, and hide completed. */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
        data-testid="engineering-home-filters"
      >
        <SiteMultiSelect
          options={siteOptions}
          selected={filters.projectIds}
          onChange={(projectIds) => setAndPersist({ ...filters, projectIds })}
          disabled={sitesLoading}
        />

        <SearchableSelect
          options={ownerSelectOptions}
          value={filters.ownerUserId != null ? String(filters.ownerUserId) : ""}
          onValueChange={(v) =>
            setAndPersist({ ...filters, ownerUserId: v ? Number(v) : null })
          }
          placeholder="All engineers"
          searchPlaceholder="Search engineers…"
          emptyText="No engineers with tasks."
          triggerClassName="h-9 w-52"
          className="w-52"
          data-testid="engineering-home-engineer-filter"
        />

        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="eng-home-hide-completed"
            checked={filters.hideCompleted}
            onCheckedChange={(checked) => setAndPersist({ ...filters, hideCompleted: checked })}
            data-testid="engineering-home-hide-completed"
          />
          <Label htmlFor="eng-home-hide-completed" className="cursor-pointer text-xs text-muted-foreground">
            Hide completed
          </Label>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-muted-foreground"
              onClick={() => setAndPersist(DEFAULT_FILTERS)}
              data-testid="engineering-home-filters-reset"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <HomeSkeleton />
      ) : isError ? (
        <WorkspaceNotice
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Couldn't load the engineering home"
          description={error instanceof Error ? error.message : "Please try again."}
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          }
        />
      ) : data ? (
        <div className="space-y-5" data-testid="engineering-home-content">
          <KPIStrip className="grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Active projects" value={data.metrics.activeProjects} icon={<Building2 className="h-4 w-4" />} />
            <MetricCard label="Open tasks" value={data.metrics.openTasks} icon={<ListTodo className="h-4 w-4" />} />
            <MetricCard label="Due this week" value={data.metrics.dueThisWeek} icon={<CalendarClock className="h-4 w-4" />} />
            <MetricCard label="Overdue" value={data.metrics.overdue} icon={<AlertTriangle className="h-4 w-4" />} danger />
          </KPIStrip>

          {/* Portfolio — where are we */}
          <Card className="border-border bg-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Where are we</h2>
                <span className="text-xs text-muted-foreground">{data.portfolio.length} projects</span>
              </div>
              {data.portfolio.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {filtersActive
                    ? "No engineering work matches the current filters."
                    : "No engineering work on any project yet."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Project</th>
                        <th className="px-4 py-2 font-medium">Phase</th>
                        <th className="px-4 py-2 text-right font-medium">Open</th>
                        <th className="px-4 py-2 text-right font-medium">Overdue</th>
                        <th className="px-4 py-2 text-right font-medium">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.portfolio.map((row) => (
                        <tr key={row.projectId} className="border-b border-border/40 last:border-0" data-testid={`portfolio-row-${row.projectId}`}>
                          <td className="px-4 py-2.5 font-medium text-foreground">{row.projectName}</td>
                          <td className="px-4 py-2.5">
                            {/* Phase is read-only in Engineering (single source: lifecycle). */}
                            <Badge variant="outline" className="font-normal">{row.phaseLabel}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{row.open}</td>
                          <td className={cn("px-4 py-2.5 text-right tabular-nums", row.overdue > 0 && "font-semibold text-red-600")}>{row.overdue}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${row.progress}%` }} />
                              </div>
                              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{row.progress}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* My work today */}
          <Card className="border-border bg-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight">My work</h2>
                <span className="text-xs text-muted-foreground">{data.myWork.length} open</span>
              </div>
              {data.myWork.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <p className="text-sm text-muted-foreground">
                    {filters.ownerUserId != null && filters.ownerUserId !== userId ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        Filtered to another engineer — nothing open assigned to you in scope.
                      </span>
                    ) : (
                      "Nothing open assigned to you. Nice."
                    )}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {data.myWork.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-2.5" data-testid={`my-work-${task.id}`}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{task.projectName ?? "No project"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary" className={cn("font-normal", getUniversalStatusBadgeClass(task.status))}>
                          {getUniversalStatusLabel(task.status)}
                        </Badge>
                        <Badge variant="secondary" className={cn("font-normal", DUE_META[task.due].cls)}>
                          {DUE_META[task.due].label}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
}

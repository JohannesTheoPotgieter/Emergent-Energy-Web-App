import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import type { DoNextItem } from "@shared/schema/home";
import { useLensContext } from "@/hooks/use-lens-context";
import { getHomeProjectHref } from "@/lib/home-links";
import {
  CheckCircle2,
  Clock,
  Flame,
  ChevronDown,
  Calendar,
  BellOff,
  Sparkles,
} from "lucide-react";

interface DoNextResponse {
  role: string;
  generatedAt: string;
  items: DoNextItem[];
  totalBeforeCap: number;
}

export default function HomePage() {
  const { user } = useAuth();

  const { data: dashData, isLoading: dashLoading, isError: dashIsError, error: dashError, dataUpdatedAt: dashUpdatedAt } = useQuery<any>({
    queryKey: ["/api/lifecycle-board/execution-dashboard"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/lifecycle-board/execution-dashboard");
      return res.json();
    },
  });

  const { data: companyPrioritiesRaw, isLoading: prioritiesLoading, isError: prioritiesIsError, error: prioritiesError, dataUpdatedAt: prioritiesUpdatedAt } = useQuery<any[]>({
    queryKey: ["/api/priorities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/priorities");
      return res.json();
    },
  });
  const companyPriorities = companyPrioritiesRaw?.filter((p: any) => p.status !== "complete" && p.status !== "completed");

  const { isLoading: myWorkLoading, isError: myWorkIsError, error: myWorkError, dataUpdatedAt: myWorkUpdatedAt } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/my-work/all-tasks");
      return res.json();
    },
  });

  // Do Next - central, role-aware action strip. Single source of truth replaces
  // the older Attention Needed section. Snooze/dismiss state is server-side so
  // it follows the user across devices.
  const queryClient = useQueryClient();
  const { data: doNextData, isLoading: doNextLoading, dataUpdatedAt: doNextUpdatedAt } = useQuery<DoNextResponse>({
    queryKey: ["/api/home/do-next"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/home/do-next");
      return res.json();
    },
    staleTime: 60_000,
  });
  const doNextItems = doNextData?.items ?? [];

  const snoozeMutation = useMutation({
    mutationFn: async ({ key, hours }: { key: string; hours: number }) => {
      await apiRequest("POST", `/api/home/do-next/${encodeURIComponent(key)}/snooze`, { hours });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/home/do-next"] }),
  });
  const dismissMutation = useMutation({
    mutationFn: async ({ key }: { key: string }) => {
      await apiRequest("POST", `/api/home/do-next/${encodeURIComponent(key)}/dismiss`, {});
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/home/do-next"] }),
  });

  const lens = useLensContext();
  const roleLabel = lens.activeLensLabel;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const displayName =
    (user as any)?.name ||
    (user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "User");

  return (
    <PageShell data-testid="home-page">
      {(dashIsError || prioritiesIsError || myWorkIsError) && (
        <div className="mb-4 space-y-2">
          {dashIsError && <QueryErrorBanner error={dashError} />}
          {prioritiesIsError && <QueryErrorBanner error={prioritiesError} />}
          {myWorkIsError && <QueryErrorBanner error={myWorkError} />}
        </div>
      )}

      {/* 1. Greeting */}
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground" data-testid="text-greeting">
          {greeting}, {displayName}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-role-badge">{roleLabel}</p>
      </div>

      {/* 2+3. Focus Panel - Company Priorities (left) + Do Next (right) merged */}
      <FocusPanel
        priorities={companyPriorities ?? []}
        prioritiesLoading={prioritiesLoading && !companyPriorities}
        doNextItems={doNextItems}
        doNextLoading={doNextLoading}
        onSnooze={(key, hours) => snoozeMutation.mutate({ key, hours })}
        onDismiss={(key) => dismissMutation.mutate({ key })}
      />

      <DataHealthStrip
        items={[
          { label: "Imports", updatedAt: dashUpdatedAt, loading: dashLoading },
          { label: "Priorities", updatedAt: prioritiesUpdatedAt, loading: prioritiesLoading },
          { label: "Tasks", updatedAt: myWorkUpdatedAt, loading: myWorkLoading },
          { label: "Do Next", updatedAt: doNextUpdatedAt, loading: doNextLoading },
        ]}
      />
      <UpcomingEventsStrip />

    </PageShell>
  );
}

interface FreshnessItem {
  label: string;
  updatedAt?: string | number | Date | null;
  loading?: boolean;
}

function formatFreshness(value: FreshnessItem["updatedAt"], loading?: boolean): string {
  if (loading) return "Loading";
  if (!value) return "Not refreshed";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not refreshed";
  return date.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function DataHealthStrip({ items }: { items: FreshnessItem[] }) {
  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      data-testid="home-data-health-strip"
    >
      {items.map((item) => (
        <div key={item.label} className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{item.label}</span>
          <span>{formatFreshness(item.updatedAt, item.loading)}</span>
        </div>
      ))}
    </div>
  );
}

function PriorityCard({ priority, index }: { priority: any; index: number }) {
  const healthDot = priority.effectiveHealth === "critical" ? "bg-red-500" : priority.effectiveHealth === "at_risk" ? "bg-amber-500" : "bg-emerald-500";
  const healthBorder = priority.effectiveHealth === "critical" ? "border-l-red-500" : priority.effectiveHealth === "at_risk" ? "border-l-amber-500" : "border-l-emerald-500";
  const sevBadge = priority.severity === "critical" ? "bg-red-100 text-red-700" : priority.severity === "important" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
  const sevLabel = priority.severity === "critical" ? "Critical" : priority.severity === "important" ? "High" : "Normal";
  const days = priority.dueDate ? Math.ceil((new Date(priority.dueDate).getTime() - Date.now()) / 86400000) : null;

  return (
    <Card className={`border-l-4 ${healthBorder} hover:shadow-sm transition-all`}>
      <CardContent className="p-3" data-testid={`text-priority-${index}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`w-2 h-2 rounded-full ${healthDot} shrink-0`} />
          <Link href={`/priorities/${priority.id}`}>
            <span className="text-sm text-foreground font-medium leading-snug truncate hover:text-primary hover:underline cursor-pointer">{priority.title}</span>
          </Link>
          <Badge variant="secondary" className={`text-[10px] ml-auto shrink-0 ${sevBadge}`}>{sevLabel}</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
          {priority.owner && <span>{priority.owner.name}</span>}
          {priority.assignedTo && !priority.owner && <span>{priority.assignedTo}</span>}
          {days != null && (
            <span className={days <= 7 ? "text-red-600 font-medium" : days <= 14 ? "text-amber-600" : ""}>
              {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
            </span>
          )}
          {priority.blockerCount > 0 && <span className="text-red-600 font-medium">{priority.blockerCount} blocker{priority.blockerCount > 1 ? "s" : ""}</span>}
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden mb-1">
          <div className={`h-full rounded-full ${priority.effectiveHealth === "critical" ? "bg-red-500" : priority.effectiveHealth === "at_risk" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(priority.effectiveProgress || 0, 100)}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{priority.effectiveProgress || 0}%{!priority.hasProjects && " (manual)"}</span>
          <span>{priority.hasProjects ? `${priority.projectCount} project${priority.projectCount !== 1 ? "s" : ""}` : "Standalone"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Do Next strip
// ============================================================
//
// A horizontally-scrolling row of action chips. Each chip is a verb-led label
// linking to a resolution screen, with a quiet snooze/dismiss menu so users
// can tune what shows up tomorrow. Empty state celebrates a clear queue.

const KIND_CHIP_TONE: Record<string, string> = {
  approval: "bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100",
  rag: "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100",
  hse_incident: "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100",
  qb_sync_failed: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  import_drift: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  blocked_priority: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  overdue_task: "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100",
  behind_plan: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  eng_blocker: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
  quality_issue: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
};

function chipTone(kind: string): string {
  return KIND_CHIP_TONE[kind] || "bg-muted border-border text-foreground hover:bg-muted/70";
}

function FocusPanel({
  priorities,
  prioritiesLoading,
  doNextItems,
  doNextLoading,
  onSnooze,
  onDismiss,
}: {
  priorities: any[];
  prioritiesLoading: boolean;
  doNextItems: DoNextItem[];
  doNextLoading: boolean;
  onSnooze: (key: string, hours: number) => void;
  onDismiss: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPriorities = priorities.length > 0 || prioritiesLoading;
  const hasActions = doNextItems.length > 0 || doNextLoading;

  if (!hasPriorities && !hasActions) return null;

  const visiblePriorities = priorities.slice(0, 3);
  const hiddenPriorities = priorities.slice(3);

  return (
    <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="section-focus-panel">
      {/* Company Priorities */}
      {hasPriorities && (
        <Card className="border-border/60" data-testid="card-company-priorities">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 text-primary" />
                <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Company Priorities</h2>
              </div>
              <Link href="/priorities">
                <span className="text-xs text-primary hover:underline font-medium cursor-pointer">View all</span>
              </Link>
            </div>
            {prioritiesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
              </div>
            ) : (
              <Collapsible open={expanded} onOpenChange={setExpanded}>
                <div className="space-y-2">
                  {visiblePriorities.map((priority: any, i: number) => (
                    <PriorityCard key={priority.id || i} priority={priority} index={i} />
                  ))}
                </div>
                {hiddenPriorities.length > 0 && (
                  <>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2">
                        {hiddenPriorities.map((priority: any, i: number) => (
                          <PriorityCard key={priority.id || (i + 3)} priority={priority} index={i + 3} />
                        ))}
                      </div>
                    </CollapsibleContent>
                    <CollapsibleTrigger asChild>
                      <button className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline font-medium mx-auto">
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        {expanded ? "Show less" : `Show ${hiddenPriorities.length} more`}
                      </button>
                    </CollapsibleTrigger>
                  </>
                )}
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}

      {/* Do Next */}
      <Card className={`border-border/60 ${!hasPriorities ? "lg:col-span-2" : ""}`} data-testid="card-do-next">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">Do Next</h2>
            </div>
            {!doNextLoading && doNextItems.length > 0 && (
              <span className="text-[11px] text-muted-foreground hidden sm:block">Ranked - snooze or dismiss</span>
            )}
          </div>
          {doNextLoading ? (
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-40 rounded-lg" />
              ))}
            </div>
          ) : doNextItems.length === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <p className="text-sm text-emerald-900">You're clear - no actions need you right now.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {doNextItems.slice(0, 5).map((item) => (
                <DoNextChip key={item.key} item={item} onSnooze={onSnooze} onDismiss={onDismiss} />
              ))}
              {doNextItems.length > 5 && (
                <span className="inline-flex items-center px-3 py-2 text-sm text-muted-foreground">
                  +{doNextItems.length - 5} more in Approvals
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DoNextChip({
  item,
  onSnooze,
  onDismiss,
}: {
  item: DoNextItem;
  onSnooze: (key: string, hours: number) => void;
  onDismiss: (key: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tone = chipTone(item.kind);

  return (
    <div
      className={`group inline-flex items-stretch rounded-lg border overflow-hidden ${tone}`}
      data-testid={`chip-do-next-${item.kind}`}
    >
      <Link href={item.href}>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-left max-w-[320px]"
          aria-label={`Open: ${item.title}`}
        >
          <span className="truncate">{item.title}</span>
          {item.subtitle && (
            <span className="text-xs opacity-70 truncate hidden sm:inline">- {item.subtitle}</span>
          )}
        </button>
      </Link>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="px-2 border-l border-current/20 opacity-60 hover:opacity-100"
            aria-label="Snooze or dismiss"
            data-testid={`btn-do-next-menu-${item.kind}`}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1">
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Snooze</div>
          <button
            type="button"
            onClick={() => { onSnooze(item.key, 4); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
          >
            <Clock className="w-3.5 h-3.5" /> 4 hours
          </button>
          <button
            type="button"
            onClick={() => { onSnooze(item.key, 24); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
          >
            <Clock className="w-3.5 h-3.5" /> Tomorrow
          </button>
          <button
            type="button"
            onClick={() => { onSnooze(item.key, 24 * 7); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
          >
            <Clock className="w-3.5 h-3.5" /> Next week
          </button>
          <div className="my-1 border-t" />
          <button
            type="button"
            onClick={() => { onDismiss(item.key); setMenuOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2 text-rose-700"
          >
            <BellOff className="w-3.5 h-3.5" /> Dismiss
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================================================
// Upcoming Events strip
// ============================================================

interface UpcomingEvent {
  type: string;
  date: string;
  projectName: string;
  projectId: number | null;
  detail: string;
  amount?: string;
}

const EVENT_LABEL: Record<string, string> = {
  construction_start: "Construction Start",
  commissioning: "Commissioning",
  handover_om: "O&M Handover",
  handover_client: "Client Handover",
  practical_completion: "Practical Completion",
  pd_handover: "PD Handover",
  payment_in: "Inflow",
  payment_out: "Payment Due",
};

const EVENT_TONE: Record<string, string> = {
  construction_start: "bg-emerald-50 border-emerald-200 text-emerald-900",
  commissioning: "bg-blue-50 border-blue-200 text-blue-900",
  handover_om: "bg-violet-50 border-violet-200 text-violet-900",
  handover_client: "bg-violet-50 border-violet-200 text-violet-900",
  practical_completion: "bg-blue-50 border-blue-200 text-blue-900",
  pd_handover: "bg-amber-50 border-amber-200 text-amber-900",
  payment_in: "bg-emerald-50 border-emerald-200 text-emerald-900",
  payment_out: "bg-rose-50 border-rose-200 text-rose-900",
};

const EVENT_DOT: Record<string, string> = {
  construction_start: "bg-emerald-500",
  site_establishment: "bg-emerald-500",
  commissioning: "bg-blue-500",
  handover_om: "bg-violet-500",
  handover_client: "bg-violet-500",
  practical_completion: "bg-blue-500",
  pd_handover: "bg-amber-500",
  payment_in: "bg-emerald-500",
  payment_out: "bg-rose-500",
};

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function UpcomingEventsStrip() {
  const { data, isLoading } = useQuery<{ rangeStart: string; rangeEnd: string; events: UpcomingEvent[] }>({
    queryKey: ["/api/upcoming-events"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/upcoming-events");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const { weeks, todayIso, rangeStartDate, rangeEndDate } = useMemo(() => {
    const start = data?.rangeStart ? new Date(data.rangeStart + "T00:00:00") : (() => {
      const d = new Date(today);
      const dow = d.getDay();
      d.setDate(d.getDate() - ((dow + 6) % 7));
      return d;
    })();
    const days: Date[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    const w: Date[][] = [];
    for (let i = 0; i < 4; i++) w.push(days.slice(i * 7, i * 7 + 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 27);
    return { weeks: w, todayIso: isoDate(today), rangeStartDate: start, rangeEndDate: end };
  }, [data?.rangeStart, today]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, UpcomingEvent[]>();
    for (const ev of data?.events ?? []) {
      const arr = map.get(ev.date) ?? [];
      arr.push(ev);
      map.set(ev.date, arr);
    }
    return map;
  }, [data?.events]);

  const totalEvents = data?.events?.length ?? 0;
  const dayHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  if (isLoading) {
    return (
      <div className="mb-5" data-testid="section-upcoming-events">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">4-Week Look Ahead</h2>
        </div>
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="mb-5" data-testid="section-upcoming-events">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">4-Week Look Ahead</h2>
          <span className="text-[11px] text-muted-foreground" data-testid="text-calendar-range">
            {formatDateLabel(rangeStartDate)} – {formatDateLabel(rangeEndDate)}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground" data-testid="text-calendar-event-count">
          {totalEvents} {totalEvents === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/40 border-b border-border">
          {dayHeaders.map((h) => (
            <div key={h} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
              {h}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 grid-rows-4">
          {weeks.flat().map((d, idx) => {
            const iso = isoDate(d);
            const dayEvents = eventsByDate.get(iso) ?? [];
            const isToday = iso === todayIso;
            const isPast = iso < todayIso;
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const isLastRow = idx >= 21;
            const isLastCol = (idx % 7) === 6;
            const visible = dayEvents.slice(0, 3);
            const overflow = dayEvents.length - visible.length;
            return (
              <div
                key={iso}
                data-testid={`cell-day-${iso}`}
                className={`min-h-[96px] p-1.5 flex flex-col gap-1 ${!isLastCol ? "border-r" : ""} ${!isLastRow ? "border-b" : ""} border-border ${isPast ? "bg-muted/20" : isWeekend ? "bg-muted/10" : "bg-card"}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-semibold ${isToday ? "text-primary" : isPast ? "text-muted-foreground/60" : "text-foreground"}`}>
                    {d.getDate()}
                  </span>
                  {isToday && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      Today
                    </span>
                  )}
                  {!isToday && d.getDate() === 1 && (
                    <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      {d.toLocaleDateString("en-ZA", { month: "short" })}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 min-h-0">
                  {visible.map((ev, i) => (
                    <Link key={i} href={getHomeProjectHref(ev.projectId)}>
                      <div
                        role="button"
                        aria-label={`${d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })} — ${EVENT_LABEL[ev.type] ?? ev.detail} at ${ev.projectName}${ev.amount ? ` for R ${Number(ev.amount).toLocaleString()}` : ""}`}
                        data-testid={`chip-event-${iso}-${i}`}
                        title={`${ev.projectName} · ${EVENT_LABEL[ev.type] ?? ev.detail}${ev.amount ? ` · R ${Number(ev.amount).toLocaleString()}` : ""}`}
                        className={`group flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] leading-tight cursor-pointer hover:shadow-sm transition-all ${EVENT_TONE[ev.type] ?? "bg-muted border-border text-foreground"}`}
                      >
                        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full shrink-0 ${EVENT_DOT[ev.type] ?? "bg-muted-foreground"}`} />
                        <span className="font-medium truncate">{ev.projectName}</span>
                        <span className="sr-only">— {EVENT_LABEL[ev.type] ?? ev.detail}</span>
                      </div>
                    </Link>
                  ))}
                  {overflow > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          data-testid={`button-more-${iso}`}
                          className="text-[10px] text-muted-foreground hover:text-foreground font-medium text-left px-1.5"
                        >
                          +{overflow} more
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2" align="start">
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          {d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short" })}
                        </div>
                        <div className="flex flex-col gap-1">
                          {dayEvents.map((ev, i) => (
                            <Link key={i} href={getHomeProjectHref(ev.projectId)}>
                              <div className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer hover:opacity-80 ${EVENT_TONE[ev.type] ?? "bg-muted border-border"}`}>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${EVENT_DOT[ev.type] ?? "bg-muted-foreground"}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium truncate">{ev.projectName}</div>
                                  <div className="text-[10px] opacity-70 truncate">
                                    {EVENT_LABEL[ev.type] ?? ev.detail}
                                    {ev.amount && ` · R ${Number(ev.amount).toLocaleString()}`}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {totalEvents > 0 && (
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
          <span className="font-semibold uppercase tracking-wider">Legend</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Construction / Inflow</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Commissioning / PC</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Handover</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> PD Handover</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Payment Due</span>
        </div>
      )}
    </div>
  );
}

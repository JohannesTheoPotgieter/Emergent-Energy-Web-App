import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Activity,
  Handshake,
  Link2Off,
  ListChecks,
  Users as UsersIcon,
  Briefcase,
  Hourglass,
  ShieldAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { OpportunityDrawer } from "@/components/opportunities/OpportunityDrawer";

type ActionReason = "overdue" | "on_hold" | "stale_30d" | "high_priority_quiet" | "";

type PdDashboard = {
  generatedAt: string;
  summary: {
    activeTickets: number;
    overdueTickets: number;
    stale30Tickets: number;
    blockedTickets: number;
    inApprovalTickets: number;
    completedTickets: number;
    activeKwp: number;
    openWorkItems: number;
    overdueWorkItems: number;
    dueThisWeekWorkItems: number;
    completed14dWorkItems: number;
  };
  byPhase: Array<{ code: string; label: string; ticketCount: number; openWorkItems: number; overdueWorkItems: number }>;
  byOwner: Array<{ ownerUserId: number | null; owner: string; active: number; overdue: number; stale30: number; dueThisWeek: number; activeKwp: number }>;
  handoverReady: { total: number; items: Array<{ id: number; projectName: string | null; phase: string | null; phaseLabel: string | null; ragStatus: string | null }> };
  actionQueue: Array<{
    workItemId: number;
    title: string | null;
    ticketId: number | null;
    ticketName: string | null;
    phase: string | null;
    phaseLabel: string | null;
    priority: string | null;
    endDate: string | null;
    owner: string | null;
    reason: ActionReason;
  }>;
  recentlyCompleted: Array<{
    ticketId: number | null;
    ticketName: string | null;
    items: Array<{ workItemId: number; title: string | null; completedAt: string | null; owner: string | null }>;
  }>;
  upcomingThisWeek: Array<{ workItemId: number; title: string | null; ticketId: number | null; ticketName: string | null; endDate: string | null; priority: string | null; owner: string | null }>;
  atRiskTickets: Array<{ ticketId: number; ticketName: string | null; owner: string | null; redWorkItemCount: number; openCriticalRaidCount: number }>;
  linkageGaps: { total: number; items: Array<{ kind: string; id: number; label: string | null }> };
};

const REASON_LABEL: Record<ActionReason, { label: string; tone: "rose" | "amber" | "slate" }> = {
  overdue: { label: "Overdue", tone: "rose" },
  on_hold: { label: "On hold", tone: "rose" },
  stale_30d: { label: "Stale >30d", tone: "amber" },
  high_priority_quiet: { label: "High-priority quiet", tone: "amber" },
  "": { label: "—", tone: "slate" },
};

const LINKAGE_LABEL: Record<string, string> = {
  unlinked_ticket: "Ticket with no project or opportunity",
  completed_no_project: "Completed ticket — no project linked",
  won_no_project: "Won opportunity — no project record",
  project_no_tickets: "Active project — no engineering tickets",
};

function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-ZA");
}

function formatKwp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)} MWp`;
  return `${n.toFixed(0)} kWp`;
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return "—";
  }
}

function ageInDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 86_400_000);
}

function ExceptionTile({
  label,
  count,
  sub,
  href,
  icon: Icon,
  tone = "default",
  testId,
}: {
  label: string;
  count: number;
  sub: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "emerald" | "amber" | "rose" | "slate";
  testId: string;
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
    slate: "text-slate-700",
  }[tone];
  const iconBg = {
    default: "bg-muted",
    emerald: "bg-emerald-50",
    amber: "bg-amber-50",
    rose: "bg-rose-50",
    slate: "bg-slate-50",
  }[tone];

  const inner = (
    <Card data-testid={testId} className={`border-border/60 ${href ? "transition-colors hover:border-emerald-300 hover:bg-[hsl(var(--surface-tint))] cursor-pointer" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{count}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{sub}</p>
          </div>
          <div className={`shrink-0 rounded-lg p-2 ${iconBg}`}>
            <Icon className={`h-4 w-4 ${toneClass}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!href) return inner;
  if (href.startsWith("#")) return <a href={href}>{inner}</a>;
  return <Link href={href}>{inner}</Link>;
}

function ReasonChip({ reason }: { reason: ActionReason }) {
  const { label, tone } = REASON_LABEL[reason] ?? REASON_LABEL[""];
  const toneClass = tone === "rose"
    ? "border-rose-300 bg-rose-50 text-rose-700"
    : tone === "amber"
    ? "border-amber-300 bg-amber-50 text-amber-800"
    : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneClass}`} data-testid={`reason-${reason}`}>
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline-by-phase + sign-date calendar (task #77, 2026-04-24)
//   Reads /api/pd/dashboard/pipeline-by-phase. Active opportunities only
//   (deleted / soft-deleted-client / won / lost are excluded server-side).
//   Both sections share one fetch — calendar rows are derived from the
//   same payload so phase totals and event dots stay in sync.
// ──────────────────────────────────────────────────────────────────────────

type PipelineByPhase = {
  generatedAt: string;
  totals: { count: number; totalKwp: number; totalValue: number };
  byPhase: Array<{
    code: string;
    label: string;
    displayNumber: number;
    count: number;
    totalKwp: number;
    totalValue: number;
    sharePct: number;
  }>;
  rows: Array<{
    id: number;
    dealName: string;
    clientName: string | null;
    stage: string | null;
    pipedriveDealId: string | null;
    phaseCode: string | null;
    phaseLabel: string;
    estimatedKwp: number | null;
    estimatedValue: number | null;
    expectedCloseDate: string | null;
    nextActivityDate: string | null;
  }>;
};

function formatZARShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  if (Math.abs(n) >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${n.toFixed(0)}`;
}

function PipelinePhaseRow({
  row,
}: {
  row: { code: string; label: string; count: number; totalKwp: number; totalValue: number; sharePct: number };
}) {
  // The bar encodes literal share-of-total kWp (matches the % readout to
  // its right and the card's "share of total kWp" label).
  return (
    <div className="space-y-1.5" data-testid={`pipeline-phase-${row.code}`}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-emerald-800 truncate">{row.label}</span>
          <Badge variant="outline" className="text-[10px] shrink-0" data-testid={`pipeline-phase-count-${row.code}`}>
            {row.count} opp{row.count === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0 text-muted-foreground">
          <span className="tabular-nums" data-testid={`pipeline-phase-kwp-${row.code}`}>{formatKwp(row.totalKwp)}</span>
          <span className="tabular-nums" data-testid={`pipeline-phase-value-${row.code}`}>{formatZARShort(row.totalValue)}</span>
          <span className="tabular-nums w-12 text-right">{row.sharePct.toFixed(0)}%</span>
        </div>
      </div>
      <Progress value={row.sharePct} className="h-2" />
    </div>
  );
}

// Dashboard-specific sign-date calendar.
//
// Differs from OpportunitiesCalendar (used on /opportunities) on purpose:
//   - exactly ONE event per opportunity, anchored at expected_close_date
//     (next_activity_date is intentionally ignored for this section);
//   - the "No close date set" tray is rendered ABOVE the grid and is
//     populated by `expected_close_date IS NULL` only;
//   - each event chip displays the deal name, kWp and a short phase code
//     (e.g. `S02`) so the reader can scan the whole pipeline calendar
//     without opening rows. The undated tray uses the same data contract
//     with amber styling to flag unscheduled opportunities.
const SD_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SD_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function SignEventChip({
  row,
  onClick,
}: {
  row: PipelineByPhase["rows"][number];
  onClick: () => void;
}) {
  // Compress the canonical phase code (e.g. `S02_DESIGN_COST_PROPOSAL`) down
  // to its short S-code prefix (`S02`) so the deal name has room to breathe
  // inside narrow day cells. `_UNSCOPED` continues to render as an em-dash.
  const phaseCode = row.phaseCode ?? "_UNSCOPED";
  const phaseChip = phaseCode === "_UNSCOPED"
    ? "—"
    : (phaseCode.split("_")[0] || phaseCode);
  // Always label the chip by the deal — server already COALESCEs deal_name →
  // client name → "Opportunity #<id>", so this is never empty.
  const primary = row.dealName;
  const kwpLabel = row.estimatedKwp != null ? formatKwp(row.estimatedKwp) : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 hover:bg-emerald-200 truncate flex items-center gap-1"
      title={`${row.dealName} — ${row.clientName ?? "No client"} — ${kwpLabel || "kWp n/a"} — ${row.phaseLabel}`}
      data-testid={`sd-event-${row.id}`}
    >
      <span className="font-medium truncate flex-1 min-w-0">{primary}</span>
      {kwpLabel && <span className="tabular-nums shrink-0 text-[9px] text-emerald-800">{kwpLabel}</span>}
      <span className="shrink-0 text-[9px] px-1 rounded bg-emerald-200/80 font-semibold tracking-wide">{phaseChip}</span>
    </button>
  );
}

function SignDateCalendar({
  rows,
  onEventClick,
}: {
  rows: PipelineByPhase["rows"];
  onEventClick: (id: number) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const eventsByDay = useMemo(() => {
    const map = new Map<string, PipelineByPhase["rows"]>();
    for (const r of rows) {
      if (!r.expectedCloseDate) continue;
      const key = String(r.expectedCloseDate).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [rows]);

  const undated = useMemo(
    () => rows.filter((r) => !r.expectedCloseDate),
    [rows],
  );

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    // Mon=0 ... Sun=6
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(start.getDate() - offset);
    const total = Math.ceil((offset + last.getDate()) / 7) * 7;
    const cells: Date[] = [];
    for (let i = 0; i < total; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  const today = new Date();
  const monthLabel = `${SD_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  return (
    <div className="space-y-3" data-testid="sign-date-calendar">
      {/* Tray ABOVE the grid: any opp with no expected close date is
          surfaced here so it doesn't silently disappear from the view. */}
      {undated.length > 0 && (
        <div className="border rounded-md bg-amber-50/40 border-amber-200 p-3" data-testid="sign-date-undated">
          <p className="text-xs font-semibold text-amber-800 mb-2">
            No close date set ({undated.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {undated.slice(0, 30).map((r) => {
              // Mirror SignEventChip's data contract: deal name as the primary
              // label, full phase code compressed to its short S-code prefix,
              // `_UNSCOPED` rendered as an em-dash. Tray styling stays amber
              // so unscheduled opportunities remain visually distinct from
              // dated chips inside the calendar grid.
              const phaseCode = r.phaseCode ?? "_UNSCOPED";
              const phaseChip = phaseCode === "_UNSCOPED"
                ? "—"
                : (phaseCode.split("_")[0] || phaseCode);
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => onEventClick(r.id)}
                  className="text-[10px] px-2 py-0.5 rounded bg-white border border-amber-200 hover:border-amber-400 max-w-[260px] flex items-center gap-1"
                  title={`${r.dealName} — ${r.clientName ?? "No client"} — ${r.estimatedKwp != null ? formatKwp(r.estimatedKwp) : "kWp n/a"} — ${r.phaseLabel}`}
                  data-testid={`sd-undated-${r.id}`}
                >
                  <span className="font-medium text-slate-700 truncate min-w-0">{r.dealName}</span>
                  {r.estimatedKwp != null && (
                    <span className="tabular-nums text-[9px] text-amber-800 shrink-0">{formatKwp(r.estimatedKwp)}</span>
                  )}
                  <span className="shrink-0 text-[9px] px-1 rounded bg-amber-200/80 font-semibold tracking-wide">
                    {phaseChip}
                  </span>
                </button>
              );
            })}
            {undated.length > 30 && (
              <span className="text-[10px] text-amber-700 self-center">+{undated.length - 30} more</span>
            )}
          </div>
        </div>
      )}

      {/* Month nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-emerald-600" />
          <span className="text-xs text-slate-600">Each event = expected sign date</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} aria-label="Previous month" data-testid="btn-sd-prev">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }} data-testid="btn-sd-today">Today</Button>
          <span className="text-sm font-medium text-slate-700 mx-2 min-w-[140px] text-center" data-testid="sd-month-label">{monthLabel}</span>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} aria-label="Next month" data-testid="btn-sd-next">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-t-md overflow-hidden text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {SD_WEEKDAYS.map((d) => (
          <div key={d} className="bg-emerald-50/50 px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 border-t-0 rounded-b-md overflow-hidden -mt-3">
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = d.toDateString() === today.toDateString();
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const events = eventsByDay.get(key) || [];
          return (
            <div
              key={d.toISOString()}
              className={`min-h-[88px] p-1.5 ${inMonth ? "bg-white" : "bg-slate-50/60"} ${isToday ? "ring-2 ring-emerald-500 ring-inset" : ""}`}
            >
              <div className={`text-[11px] font-semibold mb-1 ${inMonth ? "text-slate-700" : "text-slate-400"} ${isToday ? "text-emerald-700" : ""}`}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {events.slice(0, 3).map((r) => (
                  <SignEventChip key={r.id} row={r} onClick={() => onEventClick(r.id)} />
                ))}
                {events.length > 3 && (
                  <p className="text-[9px] text-slate-500 px-1">+{events.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Won deals (this FY) tile (task #94, 2026-04-24)
//   Reads /api/pd/dashboard/won-deals. FY-scoped (Sep–Aug, fixed window).
//   Click a row → opens shared OpportunityDrawer (same as the
//   PipelineByPhaseSection above). projectLinkState badges:
//     linked → green, deep-links to /project/<projectName>
//     stub   → amber, drawer open (so the gap can be closed)
//     none   → red,   drawer open (Convert-to-Project CTA visible)
// ──────────────────────────────────────────────────────────────────────────

type WonDeals = {
  generatedAt: string;
  fy: number;
  fyLabel: string;
  fyStart: string;
  fyEnd: string;
  kpis: {
    count: number;
    totalValue: number;
    totalKwp: number;
    currency: string;
  };
  rows: Array<{
    id: number;
    dealName: string;
    clientName: string | null;
    pipedriveDealId: string | null;
    estimatedValue: number | null;
    estimatedKwp: number | null;
    signedDate: string | null;
    dealOwnerName: string | null;
    updatedAt: string | null;
    projectId: number | null;
    projectName: string | null;
    projectPhase: string | null;
    projectLinkState: "linked" | "stub" | "none";
  }>;
};

type WonSortKey = "signedDate" | "estimatedValue" | "estimatedKwp" | "daysSinceSign";

function daysSince(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const t = new Date(dateIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function formatRelativeDays(d: number | null): string {
  if (d == null) return "—";
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  return `${d}d ago`;
}

function ProjectLinkBadge({ row }: { row: WonDeals["rows"][number] }) {
  if (row.projectLinkState === "linked") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px]"
        data-testid={`won-link-state-linked-${row.id}`}
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Project linked
      </Badge>
    );
  }
  if (row.projectLinkState === "stub") {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-50 text-amber-800 text-[10px]"
        data-testid={`won-link-state-stub-${row.id}`}
      >
        <AlertTriangle className="h-3 w-3 mr-1" />
        Stub project
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-rose-300 bg-rose-50 text-rose-800 text-[10px]"
      data-testid={`won-link-state-none-${row.id}`}
    >
      <Link2Off className="h-3 w-3 mr-1" />
      No project yet
    </Badge>
  );
}

function WonDealsTile() {
  const [openOppId, setOpenOppId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<WonSortKey>("signedDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, isError, error, refetch } = useQuery<WonDeals>({
    queryKey: ["/api/pd/dashboard/won-deals"],
  });

  const sortedRows = useMemo(() => {
    const rows = data?.rows ? [...data.rows] : [];
    const dir = sortDir === "asc" ? 1 : -1;
    const sortVal = (r: WonDeals["rows"][number]): number => {
      if (sortKey === "estimatedValue") return r.estimatedValue ?? -Infinity;
      if (sortKey === "estimatedKwp") return r.estimatedKwp ?? -Infinity;
      if (sortKey === "daysSinceSign") return daysSince(r.signedDate) ?? -Infinity;
      // signedDate (default)
      return r.signedDate ? new Date(r.signedDate).getTime() : -Infinity;
    };
    rows.sort((a, b) => {
      const va = sortVal(a);
      const vb = sortVal(b);
      if (va === vb) {
        // tie-break on updatedAt desc, matching server default order.
        const ua = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const ub = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return ub - ua;
      }
      return va < vb ? -1 * dir : 1 * dir;
    });
    return rows;
  }, [data?.rows, sortKey, sortDir]);

  const toggleSort = (key: WonSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Default direction per column. For value/kWp/sign-date the
      // most useful first view is "biggest / most-recent first";
      // for "days since sign" the natural default is "freshest first"
      // (smallest = today).
      setSortDir(key === "daysSinceSign" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, k, align = "left", testId }: { label: string; k: WonSortKey; align?: "left" | "right"; testId: string }) => {
    const active = sortKey === k;
    // ARIA: a sortable column header should advertise its sort state via
    // aria-sort. We say "ascending" / "descending" only for the active
    // column and "none" for the others, per WAI-ARIA grid pattern.
    const ariaSort: "ascending" | "descending" | "none" = active
      ? sortDir === "asc"
        ? "ascending"
        : "descending"
      : "none";
    const nextDir = active && sortDir === "desc" ? "ascending" : "descending";
    return (
      <th
        className={`py-2 px-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}
        aria-sort={ariaSort}
        scope="col"
      >
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-emerald-700 ${active ? "text-emerald-700" : "text-muted-foreground"}`}
          aria-label={`Sort by ${label.toLowerCase()} ${nextDir}`}
          data-testid={testId}
        >
          <span className="uppercase tracking-wide text-xs">{label}</span>
          {active && <span aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>}
        </button>
      </th>
    );
  };

  const fyLabel = data?.fyLabel ?? "current FY";

  return (
    <>
      <CollapsibleCard
        id="won-deals-tile"
        testId="card-won-deals"
        header={
          <>
            <CardTitle className="flex items-center gap-2 text-base">
              <Handshake className="h-4 w-4 text-emerald-600" />
              Won deals this FY · Pipedrive
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Pipedrive opportunities marked won with a sign date in {fyLabel}.
              Click a row for the full CRM context. Project-link state shows
              whether the deal has been picked up for delivery.
            </p>
          </>
        }
      >
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : isError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" data-testid="won-deals-error">
              <p className="font-medium">Could not load won deals.</p>
              <p className="text-xs text-rose-700 mt-0.5">{(error as Error)?.message ?? "Request failed"}</p>
              <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => refetch()} data-testid="won-deals-retry">
                Retry
              </Button>
            </div>
          ) : (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="won-deals-kpis">
                <div className="rounded-md border bg-emerald-50/40 border-emerald-200 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">{fyLabel} · Won deals</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-800 tabular-nums" data-testid="won-deals-kpi-count">{data?.kpis.count ?? 0}</p>
                </div>
                <div className="rounded-md border bg-emerald-50/40 border-emerald-200 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">{fyLabel} · Total kWp</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-800 tabular-nums" data-testid="won-deals-kpi-kwp">{formatKwp(data?.kpis.totalKwp ?? 0)}</p>
                </div>
                <div className="rounded-md border bg-emerald-50/40 border-emerald-200 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">{fyLabel} · Total value</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-800 tabular-nums" data-testid="won-deals-kpi-value">{formatZARShort(data?.kpis.totalValue ?? 0)}</p>
                </div>
              </div>

              {/* Rows */}
              {sortedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground italic" data-testid="won-deals-empty">
                  No deals won in {fyLabel} yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="won-deals-table">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 px-3 font-medium">Deal</th>
                        <th className="py-2 px-3 font-medium">Client</th>
                        <SortHeader label="Sign date" k="signedDate" testId="won-sort-sign-date" />
                        <SortHeader label="Days" k="daysSinceSign" align="right" testId="won-sort-days" />
                        <SortHeader label="Value" k="estimatedValue" align="right" testId="won-sort-value" />
                        <SortHeader label="kWp" k="estimatedKwp" align="right" testId="won-sort-kwp" />
                        <th className="py-2 px-3 font-medium">Owner</th>
                        <th className="py-2 px-3 font-medium">Project</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => {
                        const days = daysSince(row.signedDate);
                        return (
                          <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`won-row-${row.id}`}>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setOpenOppId(row.id)}
                                  className="font-medium text-emerald-800 hover:text-emerald-900 hover:underline truncate text-left"
                                  title={row.dealName}
                                  data-testid={`won-deal-name-${row.id}`}
                                >
                                  {row.dealName}
                                </button>
                                {row.pipedriveDealId && (
                                  <code
                                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 shrink-0"
                                    title={`Pipedrive deal #${row.pipedriveDealId}`}
                                    data-testid={`won-deal-pd-id-${row.id}`}
                                  >
                                    PD #{row.pipedriveDealId}
                                  </code>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-muted-foreground truncate" title={row.clientName ?? ""}>
                              {row.clientName ?? "—"}
                            </td>
                            <td className="py-2 px-3 tabular-nums" data-testid={`won-sign-date-${row.id}`}>
                              {formatDate(row.signedDate)}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                              {formatRelativeDays(days)}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums" data-testid={`won-value-${row.id}`}>
                              {formatZARShort(row.estimatedValue)}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums" data-testid={`won-kwp-${row.id}`}>
                              {formatKwp(row.estimatedKwp)}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground truncate" title={row.dealOwnerName ?? ""}>
                              {row.dealOwnerName ?? "—"}
                            </td>
                            <td className="py-2 px-3">
                              {row.projectLinkState === "linked" && row.projectName ? (
                                <Link
                                  href={`/project/${encodeURIComponent(row.projectName)}`}
                                  className="inline-block"
                                  data-testid={`won-project-link-${row.id}`}
                                >
                                  <ProjectLinkBadge row={row} />
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setOpenOppId(row.id)}
                                  className="inline-block"
                                  data-testid={`won-project-open-${row.id}`}
                                >
                                  <ProjectLinkBadge row={row} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </CollapsibleCard>

      <OpportunityDrawer
        opportunityId={openOppId}
        open={openOppId != null}
        onClose={() => setOpenOppId(null)}
      />
    </>
  );
}

function PipelineByPhaseSection() {
  const [openOppId, setOpenOppId] = useState<number | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery<PipelineByPhase>({
    queryKey: ["/api/pd/dashboard/pipeline-by-phase"],
  });

  return (
    <>
      <CollapsibleCard
        id="pipeline-by-phase-opportunities"
        testId="card-pipeline-by-phase-opps"
        header={
          <>
            <CardTitle className="text-base">Pipeline by phase</CardTitle>
            <p className="text-xs text-muted-foreground">
              Active opportunities grouped by canonical lifecycle phase. Excludes won/lost and soft-deleted rows. Bar width = share of total kWp.
            </p>
          </>
        }
      >
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : isError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" data-testid="pipeline-phase-error">
              <p className="font-medium">Could not load pipeline by phase.</p>
              <p className="text-xs text-rose-700 mt-0.5">{(error as Error)?.message ?? "Request failed"}</p>
              <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => refetch()} data-testid="pipeline-phase-retry">
                Retry
              </Button>
            </div>
          ) : !data || data.byPhase.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="pipeline-phase-empty">
              No active opportunities in the pipeline.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
                <span>{data.totals.count} active opportunit{data.totals.count === 1 ? "y" : "ies"}</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatKwp(data.totals.totalKwp)}</span>
                  <span className="tabular-nums">{formatZARShort(data.totals.totalValue)}</span>
                </div>
              </div>
              {data.byPhase.map((p) => (
                <PipelinePhaseRow key={p.code} row={p} />
              ))}
            </>
          )}
        </CardContent>
      </CollapsibleCard>

      <CollapsibleCard
        id="pipeline-sign-date-calendar"
        testId="card-sign-date-calendar"
        defaultOpen={true}
        header={
          <>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-emerald-700" />
              Expected sign dates
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Active opportunities at their expected close date. Click an event to open the deal. Opportunities with no close date are listed in the tray below.
            </p>
          </>
        }
      >
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : isError ? (
            <p className="text-sm text-rose-700" data-testid="pipeline-calendar-error">
              Could not load expected sign dates.
            </p>
          ) : (
            <SignDateCalendar rows={data?.rows ?? []} onEventClick={(id) => setOpenOppId(id)} />
          )}
        </CardContent>
      </CollapsibleCard>

      <OpportunityDrawer
        opportunityId={openOppId}
        open={openOppId != null}
        onClose={() => setOpenOppId(null)}
      />
    </>
  );
}

function PhaseRow({ row, maxOpen }: { row: { code: string; label: string; ticketCount: number; openWorkItems: number; overdueWorkItems: number }; maxOpen: number }) {
  const pct = maxOpen > 0 ? (row.openWorkItems / maxOpen) * 100 : 0;
  return (
    <div className="space-y-1.5" data-testid={`phase-row-${row.code}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-emerald-800 truncate">{row.label}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">{row.ticketCount} tickets</Badge>
          {row.overdueWorkItems > 0 && (
            <Badge variant="outline" className="text-[10px] shrink-0 border-rose-300 text-rose-700">
              {row.overdueWorkItems} overdue
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          <span className="text-muted-foreground">{row.openWorkItems} open work items</span>
        </div>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

function DisclosurePanel({
  testId,
  title,
  count,
  tone = "default",
  emptyText = "Nothing here right now.",
  children,
}: {
  testId: string;
  title: string;
  count: number;
  tone?: "default" | "emerald" | "amber" | "rose";
  emptyText?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-800",
  }[tone];
  return (
    <div className="rounded-md border border-border/60" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/40"
        data-testid={`${testId}-toggle`}
      >
        <span className="flex items-center gap-2 font-medium">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {title}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs ${toneClass}`} data-testid={`${testId}-count`}>{count}</span>
      </button>
      {open && (
        <div className="border-t border-border/60 p-3 text-sm" data-testid={`${testId}-body`}>
          {count === 0 ? <p className="text-xs text-muted-foreground">{emptyText}</p> : children}
        </div>
      )}
    </div>
  );
}

type CollapsibleCardProps = {
  id: string;
  testId?: string;
  defaultOpen?: boolean;
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyId?: string;
};

function CollapsibleCard({
  id,
  testId,
  defaultOpen = true,
  header,
  children,
  className,
  bodyId,
}: CollapsibleCardProps) {
  const storageKey = `pd-dashboard:section:${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return defaultOpen;
      return stored === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore quota / privacy mode errors */
      }
      return next;
    });
  };
  const contentId = bodyId ?? `${id}-body`;
  const toggleTestId = testId ? `${testId}-toggle` : `${id}-toggle`;
  return (
    <Card data-testid={testId} className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full text-left rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        data-testid={toggleTestId}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{header}</div>
            <span className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          </div>
        </CardHeader>
      </button>
      {open && <div id={contentId}>{children}</div>}
    </Card>
  );
}

// Drilldown helper: link to the engineering ticket if known, else fall back
// to /engineering/tasks. We never link back to /opportunities here — the PD
// dashboard is now a view onto app-internal engineering & project work.
function ticketHref(ticketId: number | null | undefined, ticketName: string | null | undefined): string {
  if (ticketName) return `/engineering/tickets?open=${encodeURIComponent(ticketName)}`;
  if (ticketId != null) return `/engineering/tickets?id=${ticketId}`;
  return `/engineering/tickets`;
}

export default function PdDashboardPage() {
  const { data, isLoading, error } = useQuery<PdDashboard>({
    queryKey: ["/api/pd/dashboard"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6" data-testid="pd-dashboard-loading">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6" data-testid="pd-dashboard-error">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-rose-700">Failed to load Project Development dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, byPhase, byOwner, handoverReady, linkageGaps, actionQueue, recentlyCompleted, upcomingThisWeek, atRiskTickets } = data;
  const phaseRows = (byPhase ?? []).filter((p) => p.ticketCount > 0 || p.openWorkItems > 0);
  const maxPhaseOpen = Math.max(...phaseRows.map((p) => p.openWorkItems), 1);

  return (
    <PageLayout
      data-testid="pd-dashboard"
      header={
        <PageHeader
          title="Project Development"
          subtitle="Operational control tower — engineering tickets and work items needing PD action right now, sourced from app-internal data."
          actions={
            <Link href="/engineering/tickets">
              <Button variant="outline" size="sm" className="gap-2" data-testid="link-engineering-tickets">
                Open engineering tickets
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          }
        />
      }
    >
      {/* 1. TOP STRIP — exception-first, drilldown-only. All counts come from
            engineering_tickets and work_items — no Pipedrive metrics. */}
      <section data-testid="section-top-strip" aria-labelledby="top-strip-heading">
        <h2 id="top-strip-heading" className="sr-only">Exceptions and immediate actions</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
          <ExceptionTile
            label="Active tickets"
            count={summary.activeTickets}
            sub={`${formatKwp(summary.activeKwp)} of design work`}
            href="/engineering/tickets"
            icon={Briefcase}
            tone="emerald"
            testId="kpi-active-tickets"
          />
          <ExceptionTile
            label="Overdue tickets"
            count={summary.overdueTickets}
            sub="Past due_date, still open"
            href="/engineering/tickets?filter=overdue"
            icon={AlertTriangle}
            tone={summary.overdueTickets > 0 ? "rose" : "default"}
            testId="kpi-overdue-tickets"
          />
          <ExceptionTile
            label="Stale > 30d"
            count={summary.stale30Tickets}
            sub="No update in 30+ days"
            href="/engineering/tickets?filter=stale-30"
            icon={Hourglass}
            tone={summary.stale30Tickets > 0 ? "amber" : "default"}
            testId="kpi-stale-tickets"
          />
          <ExceptionTile
            label="Blocked tickets"
            count={summary.blockedTickets}
            sub={summary.blockedTickets > 0 ? "Have a work item on hold" : "No internal blockers"}
            href={summary.blockedTickets > 0 ? "/engineering/tickets?filter=blocked" : undefined}
            icon={ShieldAlert}
            tone={summary.blockedTickets > 0 ? "rose" : "default"}
            testId="kpi-blocked-tickets"
          />
          <ExceptionTile
            label="In approval"
            count={summary.inApprovalTickets}
            sub={summary.inApprovalTickets > 0 ? "Awaiting QC / sign-off" : "Nothing waiting on review"}
            href={summary.inApprovalTickets > 0 ? "/engineering/tickets?filter=in-approval" : undefined}
            icon={ShieldAlert}
            tone={summary.inApprovalTickets > 0 ? "amber" : "default"}
            testId="kpi-in-approval-tickets"
          />
          <ExceptionTile
            label="Handover-ready"
            count={handoverReady.total}
            sub={handoverReady.total > 0 ? "Projects in S08–S10 band" : "No projects at handover stage"}
            href={handoverReady.total > 0 ? "/projects?filter=handover-ready" : undefined}
            icon={Handshake}
            tone={handoverReady.total > 0 ? "emerald" : "default"}
            testId="kpi-handover-ready"
          />
          <ExceptionTile
            label="Linkage / data gaps"
            count={linkageGaps.total}
            sub={linkageGaps.total > 0 ? "Spine breaks across tickets/projects" : "Spine clean"}
            href={linkageGaps.total > 0 ? "/engineering/tickets?filter=linkage-gaps" : undefined}
            icon={Link2Off}
            tone={linkageGaps.total > 0 ? "rose" : "default"}
            testId="kpi-linkage-gaps"
          />
        </div>
      </section>

      {/* 2. ACTION QUEUE — what to do right now. Source: open work_items
            joined to engineering_tickets, ranked by reason. */}
      <CollapsibleCard
        id="action-queue"
        testId="card-action-queue"
        header={
          <>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-emerald-700" />
              Action queue
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Top {actionQueue.length} open work items ranked by overdue → on-hold → stale &gt;30d → high-priority quiet.
            </p>
          </>
        }
      >
        <CardContent>
          {actionQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="action-queue-empty">No work items need PD action right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="action-queue-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Reason</th>
                    <th className="py-2 pr-3 font-medium">Work item</th>
                    <th className="py-2 pr-3 font-medium">Ticket</th>
                    <th className="py-2 pr-3 font-medium">Phase</th>
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium">Due</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {actionQueue.map((item) => {
                    const dueAge = ageInDays(item.endDate);
                    return (
                      <tr key={item.workItemId} className="border-b last:border-0 hover:bg-muted/30" data-testid={`action-row-${item.workItemId}`}>
                        <td className="py-2 pr-3"><ReasonChip reason={item.reason} /></td>
                        <td className="py-2 pr-3 font-medium text-foreground">
                          <Link href={`/engineering/tasks?open=${item.workItemId}`} className="hover:text-emerald-700" data-testid={`action-wi-${item.workItemId}`}>
                            {item.title || `Work item #${item.workItemId}`}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {item.ticketName ? (
                            <Link href={ticketHref(item.ticketId, item.ticketName)} className="hover:text-emerald-700">
                              {item.ticketName}
                            </Link>
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{item.phaseLabel || "—"}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{item.owner || "Unassigned"}</td>
                        <td className="py-2 pr-3 text-xs">
                          {item.endDate == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : dueAge != null && dueAge > 0 ? (
                            <span className="text-rose-700">{dueAge}d overdue</span>
                          ) : (
                            <span className="text-muted-foreground">{formatDate(item.endDate)}</span>
                          )}
                        </td>
                        <td className="py-2">
                          <Link href={`/engineering/tasks?open=${item.workItemId}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid={`action-open-${item.workItemId}`}>
                              Open
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </CollapsibleCard>

      {/* 2b. PIPELINE BY PHASE + EXPECTED SIGN DATES (task #77).
            Sales-side counterpart to the engineering operating board below;
            placed adjacent so the two read as a pair. */}
      <PipelineByPhaseSection />

      {/* 2c. WON DEALS THIS FY (task #94).
            Shows what has just been won in CRM (Pipedrive) within the
            current financial year, plus whether each deal has been
            picked up for delivery (linked / stub / none). FY-scoped,
            shares the FY helper with /api/pd/reports. */}
      <WonDealsTile />

      {/* 3. PD OPERATING BOARD — engineering activity by canonical lifecycle phase */}
      <CollapsibleCard
        id="pipeline-by-phase"
        testId="card-pipeline-by-phase"
        header={
          <>
            <CardTitle className="text-base">PD operating board · by lifecycle phase</CardTitle>
            <p className="text-xs text-muted-foreground">
              Engineering tickets and work items grouped by the company's 10-stage canonical phase cycle (shared/phases.ts). Bar width = open work items.
            </p>
          </>
        }
      >
        <CardContent className="space-y-4">
          {phaseRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No engineering activity yet.</p>
          ) : (
            phaseRows.map((p) => (
              <PhaseRow key={p.code} row={p} maxOpen={maxPhaseOpen} />
            ))
          )}
        </CardContent>
      </CollapsibleCard>

      {/* 4. CROSS-COMPANY INTERACTION — workspace rollup */}
      <MeetingViewSection />

      {/* 5. OWNERSHIP VIEW — by PD developer */}
      <CollapsibleCard
        id="by-owner"
        testId="card-by-owner"
        header={
          <>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="h-4 w-4 text-muted-foreground" />
              Ownership · per PD developer
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Source: <code className="rounded bg-muted px-1">engineering_tickets.project_developer_user_id</code> joined to <code className="rounded bg-muted px-1">users</code>. Counts only active tickets.
            </p>
          </>
        }
      >
        <CardContent>
          {byOwner.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active engineering tickets.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="by-owner-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium text-right">Active</th>
                    <th className="py-2 pr-3 font-medium text-right">Overdue</th>
                    <th className="py-2 pr-3 font-medium text-right">Stale 30d</th>
                    <th className="py-2 pr-3 font-medium text-right">Due this week</th>
                    <th className="py-2 pr-3 font-medium text-right">Active capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {byOwner.map((row) => (
                    <tr key={`${row.ownerUserId ?? 'na'}-${row.owner}`} className="border-b last:border-0 hover:bg-muted/30" data-testid={`owner-row-${row.owner}`}>
                      <td className="py-2 pr-3 font-medium">{row.owner}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.active}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.overdue > 0 ? "text-rose-700 font-medium" : "text-muted-foreground"}`}>{row.overdue}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.stale30 > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{row.stale30}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.dueThisWeek}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatKwp(row.activeKwp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </CollapsibleCard>

      {/* Handover-ready / linkage-gap inline lists */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DisclosurePanel
          testId="disclosure-handover-ready"
          title="Handover-ready projects"
          count={handoverReady.total}
          tone="emerald"
          emptyText="No projects currently sit in the post-construction handover band (canonical phases S08, S09, S9B, S10)."
        >
          <ul className="space-y-2">
            {handoverReady.items.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-3 text-sm" data-testid={`handover-item-${it.id}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/project/${encodeURIComponent(it.projectName ?? String(it.id))}`} className="font-medium hover:text-emerald-700">
                    {it.projectName || `Project #${it.id}`}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {it.phaseLabel ?? "—"}
                    {it.ragStatus ? ` · RAG ${it.ragStatus}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </DisclosurePanel>

        <DisclosurePanel
          testId="disclosure-linkage-gaps"
          title="Linkage / data gaps"
          count={linkageGaps.total}
          tone="rose"
          emptyText="Spine is clean — every active project has tickets and every ticket has a project or opportunity link."
        >
          <ul className="space-y-2">
            {linkageGaps.items.map((it, idx) => (
              <li key={`${it.kind}-${it.id}-${idx}`} className="flex items-start justify-between gap-3 text-sm" data-testid={`linkage-item-${it.kind}-${it.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{it.label || `#${it.id}`}</p>
                  <p className="text-xs text-muted-foreground">{LINKAGE_LABEL[it.kind] ?? it.kind}</p>
                </div>
              </li>
            ))}
          </ul>
          {linkageGaps.total > linkageGaps.items.length && (
            <p className="mt-2 text-[11px] text-muted-foreground">Showing top {linkageGaps.items.length} of {linkageGaps.total}.</p>
          )}
        </DisclosurePanel>
      </div>

      {/* 6. ACTIVITY PULSE — recently completed and what's due this week */}
      <CollapsibleCard
        id="activity-pulse"
        testId="card-activity-pulse"
        defaultOpen={false}
        header={
          <>
            <CardTitle className="text-base">Activity pulse</CardTitle>
            <p className="text-xs text-muted-foreground">
              {summary.completed14dWorkItems} work items completed in the last 14 days · {summary.dueThisWeekWorkItems} due in the next 7.
            </p>
          </>
        }
      >
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div data-testid="recently-completed">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                Recently completed (14d)
              </h3>
              {recentlyCompleted.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing completed in the last 14 days.</p>
              ) : (
                <ul className="space-y-3">
                  {recentlyCompleted.map((g) => (
                    <li key={g.ticketId ?? "orphan"} data-testid={`completed-ticket-${g.ticketId ?? "orphan"}`}>
                      <Link
                        href={g.ticketId != null ? `/engineering/tickets?open=${g.ticketId}` : "/engineering/tickets"}
                        className="text-xs font-semibold hover:text-emerald-700"
                      >
                        {g.ticketName ?? (g.ticketId != null ? `Ticket #${g.ticketId}` : "Unlinked")}
                      </Link>
                      <ul className="mt-1 ml-3 space-y-1 border-l border-emerald-100 pl-3">
                        {g.items.map((w) => (
                          <li key={w.workItemId} className="text-xs" data-testid={`completed-${w.workItemId}`}>
                            <Link href={`/engineering/tasks?open=${w.workItemId}`} className="hover:text-emerald-700">
                              {w.title || `Work item #${w.workItemId}`}
                            </Link>
                            <span className="text-muted-foreground">
                              {w.owner ? ` · ${w.owner}` : ""}
                              {w.completedAt ? ` · ${formatDate(w.completedAt)}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div data-testid="upcoming-this-week">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5 text-emerald-700" />
                Due in the next 7 days
              </h3>
              {upcomingThisWeek.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing due this week.</p>
              ) : (
                <ul className="space-y-2">
                  {upcomingThisWeek.map((w) => (
                    <li key={w.workItemId} className="text-xs" data-testid={`upcoming-${w.workItemId}`}>
                      <Link href={`/engineering/tasks?open=${w.workItemId}`} className="font-medium hover:text-emerald-700">
                        {w.title || `Work item #${w.workItemId}`}
                      </Link>
                      <p className="text-muted-foreground">
                        {w.owner ? `${w.owner} · ` : ""}
                        {w.ticketName ?? "—"}
                        {w.endDate ? ` · due ${formatDate(w.endDate)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {atRiskTickets.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-4" data-testid="at-risk-tickets">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <XCircle className="h-3.5 w-3.5 text-rose-700" />
                At-risk tickets
              </h3>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {atRiskTickets.map((t) => (
                  <li key={t.ticketId} className="text-xs" data-testid={`at-risk-${t.ticketId}`}>
                    <Link href={ticketHref(t.ticketId, t.ticketName)} className="font-medium hover:text-rose-700">
                      {t.ticketName || `Ticket #${t.ticketId}`}
                    </Link>
                    <p className="text-muted-foreground">
                      {t.owner ? `${t.owner} · ` : ""}
                      {t.redWorkItemCount > 0 ? `${t.redWorkItemCount} red work items` : ""}
                      {t.redWorkItemCount > 0 && t.openCriticalRaidCount > 0 ? " · " : ""}
                      {t.openCriticalRaidCount > 0 ? `${t.openCriticalRaidCount} critical RAID` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </CollapsibleCard>

      <p className="text-[10px] text-muted-foreground" data-testid="generated-at">
        Snapshot generated {new Date(data.generatedAt).toLocaleString()} · {formatNumber(summary.activeTickets)} active tickets · {formatNumber(summary.openWorkItems)} open work items
      </p>
    </PageLayout>
  );
}


type WorkspaceRollupResponse = {
  generatedAt: string;
  asOf?: string;
  totals: {
    opportunities?: number;
    linkedProjects?: number;
    linkedWorkItems?: number;
    projects: number;
    spineGap: number;
    cascadeAnomalies: number;
    /** @deprecated use `openEngineeringTickets` (task #61) */
    openPdTickets?: number;
    /** @deprecated use `overdueEngineeringTickets` (task #61) */
    overduePdTickets?: number;
    openEngineeringTickets: number;
    overdueEngineeringTickets: number;
    openWorkItems: number;
    blockedWorkItems: number;
    overdueWorkItems: number;
    openRaid: number;
    ticketsDueThisWeek?: number;
    tasksDueThisWeek?: number;
    projectsWithoutTickets?: number;
    ticketsWithoutValidLinkage?: number;
    workItemsWithInvalidLinkage?: number;
  };
  lists?: {
    projectsWithoutTickets: Array<{ id: number; projectName: string }>;
    ticketsWithoutValidLinkage: Array<{ id: number; projectSiteName: string; projectId: number | null; opportunityId: number | null }>;
    workItemsWithInvalidLinkage: Array<{ id: number; title: string; projectId: number | null }>;
    ticketsDueThisWeek: Array<{ id: number; projectSiteName: string; dueDate: string | null; projectId: number | null }>;
    tasksDueThisWeek: Array<{ id: number; title: string; endDate: string | null; projectId: number | null }>;
  };
  rows: Array<{
    projectId: number;
    projectName: string;
    phase: string | null;
    opportunityStage: string | null;
    /** @deprecated use `engineeringTickets` (task #61) */
    pdTickets?: { total: number; open: number; completed: number; overdue: number; oldestOpenAt: string | null };
    engineeringTickets: { total: number; open: number; completed: number; overdue: number; oldestOpenAt: string | null };
    workItems: { total: number; open: number; completed: number; blocked: number; overdue: number };
    raid: { open: number };
    ragStatus: string | null;
    spineGap: boolean;
    lastActivityAt: string | null;
  }>;
};

function MeetingViewSection() {
  const { data, isLoading, error } = useQuery<WorkspaceRollupResponse>({
    queryKey: ["/api/project-development/workspace/rollup"],
  });

  const sortedRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const aSpan = a.workItems.overdue + a.engineeringTickets.overdue + a.workItems.blocked + (a.spineGap ? 100 : 0);
      const bSpan = b.workItems.overdue + b.engineeringTickets.overdue + b.workItems.blocked + (b.spineGap ? 100 : 0);
      return bSpan - aSpan;
    });
  }, [data]);

  if (isLoading) {
    return (
      <Card data-testid="meeting-view-loading">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Cross-company interaction</CardTitle>
          <p className="text-xs text-muted-foreground">PD tickets, work-item blockers, and workspace-rollup gaps across active pre-handover projects (before Planning).</p>
        </CardHeader>
        <CardContent><Skeleton className="h-48" /></CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card data-testid="meeting-view-error">
        <CardContent className="p-6">
          <p className="text-sm text-rose-700">Failed to load cross-company rollup.</p>
        </CardContent>
      </Card>
    );
  }

  const topRows = sortedRows.slice(0, 8);
  const hiddenRows = Math.max(sortedRows.length - topRows.length, 0);

  return (
    <CollapsibleCard
      id="cross-company"
      testId="meeting-view"
      className="scroll-mt-20"
      header={
        <>
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Cross-company interaction</CardTitle>
          <p className="text-xs text-muted-foreground">
            Source: <code className="rounded bg-muted px-1">/api/project-development/workspace/rollup</code> across {data.totals.projects} active pre-handover projects (before Planning).
            Generated {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </>
      }
    >
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
          <div data-testid="rollup-total-open-pd-tickets" className="rounded-md bg-muted/40 p-2">
            <p className="text-muted-foreground">Open PD tickets</p>
            <p className="text-lg font-semibold">{data.totals.openEngineeringTickets}</p>
            <p className="text-[10px] text-amber-700">{data.totals.overdueEngineeringTickets} overdue</p>
          </div>
          <div data-testid="rollup-total-work-items" className="rounded-md bg-muted/40 p-2">
            <p className="text-muted-foreground">Open work items</p>
            <p className="text-lg font-semibold">{data.totals.openWorkItems}</p>
            <p className="text-[10px] text-amber-700">{data.totals.overdueWorkItems} overdue · {data.totals.blockedWorkItems} blocked</p>
          </div>
          <div data-testid="rollup-total-raid" className="rounded-md bg-muted/40 p-2">
            <p className="text-muted-foreground">Open RAID</p>
            <p className="text-lg font-semibold">{data.totals.openRaid}</p>
          </div>
          <div data-testid="rollup-spine-gap" className={`rounded-md p-2 ${data.totals.spineGap > 0 ? "bg-rose-50" : "bg-muted/40"}`}>
            <p className="text-muted-foreground">Spine gaps</p>
            <p className={`text-lg font-semibold ${data.totals.spineGap > 0 ? "text-rose-700" : ""}`}>{data.totals.spineGap}</p>
            <p className="text-[10px] text-muted-foreground">work_items but no PD ticket</p>
            <Link
              href="/admin/work-item-linkage"
              className="text-[10px] text-emerald-700 underline hover:no-underline"
              data-testid="link-spine-gap-repair"
            >
              Open linkage repair →
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="meeting-view-table">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Project</th>
                <th className="py-2 pr-3">Phase</th>
                <th className="py-2 pr-3 text-right">PD tickets</th>
                <th className="py-2 pr-3 text-right">Work items</th>
                <th className="py-2 pr-3 text-right">RAID</th>
                <th className="py-2 pr-3">Flags</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((r) => (
                <tr key={r.projectId} className="border-b hover:bg-muted/30" data-testid={`row-project-${r.projectId}`}>
                  <td className="py-2 pr-3 font-medium">
                    <Link href={`/project/${encodeURIComponent(r.projectName || String(r.projectId))}`} className="hover:text-emerald-700">
                      {r.projectName || `#${r.projectId}`}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.phase || "—"}</td>
                  <td className="py-2 pr-3 text-right">
                    <span data-testid={`text-pd-open-${r.projectId}`}>{r.engineeringTickets.open}</span>
                    {r.engineeringTickets.overdue > 0 && (
                      <span className="ml-1 text-amber-700" data-testid={`text-pd-overdue-${r.projectId}`}>({r.engineeringTickets.overdue} od)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span data-testid={`text-wi-open-${r.projectId}`}>{r.workItems.open}</span>
                    {r.workItems.overdue > 0 && (
                      <span className="ml-1 text-amber-700">({r.workItems.overdue} od)</span>
                    )}
                    {r.workItems.blocked > 0 && (
                      <span className="ml-1 text-rose-700">({r.workItems.blocked} blk)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{r.raid.open}</td>
                  <td className="py-2 pr-3">
                    {r.spineGap && (
                      <Badge variant="destructive" className="text-[10px]" data-testid={`badge-spine-gap-${r.projectId}`}>spine gap</Badge>
                    )}
                    {r.ragStatus && (
                      <Badge variant="outline" className="text-[10px] ml-1">{r.ragStatus}</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {topRows.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No active projects.</td></tr>
              )}
            </tbody>
          </table>
          {hiddenRows > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">Showing top {topRows.length} most-stressed of {sortedRows.length} active projects.</p>
          )}
        </div>
        {data.lists && (
          <div className="mt-6 space-y-3">
            <RiskList
              testId="risk-projects-without-tickets"
              title="Projects without PD tickets"
              count={data.lists.projectsWithoutTickets.length}
              items={data.lists.projectsWithoutTickets.map((p) => ({ id: p.id, label: p.projectName || `#${p.id}` }))}
            />
            <RiskList
              testId="risk-tickets-invalid-linkage"
              title="PD tickets with invalid linkage"
              count={data.lists.ticketsWithoutValidLinkage.length}
              items={data.lists.ticketsWithoutValidLinkage.map((t) => ({
                id: t.id,
                label: `${t.projectSiteName || `Ticket #${t.id}`} — project=${t.projectId ?? "—"}, opp=${t.opportunityId ?? "—"}`,
              }))}
            />
            <RiskList
              testId="risk-work-items-invalid-linkage"
              title="Work items with invalid linkage"
              count={data.lists.workItemsWithInvalidLinkage.length}
              items={data.lists.workItemsWithInvalidLinkage.map((w) => ({ id: w.id, label: w.title || `Work item #${w.id}` }))}
            />
            <RiskList
              testId="risk-tickets-due-this-week"
              title="PD tickets due this week"
              count={data.lists.ticketsDueThisWeek.length}
              items={data.lists.ticketsDueThisWeek.map((t) => ({
                id: t.id,
                label: `${t.projectSiteName || `Ticket #${t.id}`}${t.dueDate ? ` (due ${t.dueDate})` : ""}`,
              }))}
            />
            <RiskList
              testId="risk-tasks-due-this-week"
              title="Work items due this week"
              count={data.lists.tasksDueThisWeek.length}
              items={data.lists.tasksDueThisWeek.map((w) => ({
                id: w.id,
                label: `${w.title || `Work item #${w.id}`}${w.endDate ? ` (due ${w.endDate})` : ""}`,
              }))}
            />
          </div>
        )}
      </CardContent>
    </CollapsibleCard>
  );
}

function RiskList({ testId, title, count, items }: { testId: string; title: string; count: number; items: Array<{ id: number; label: string }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/40"
        data-testid={`${testId}-toggle`}
      >
        <span>{title}</span>
        <span className={`px-2 py-0.5 rounded ${count > 0 ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`} data-testid={`${testId}-count`}>
          {count}
        </span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-xs" data-testid={`${testId}-body`}>
          {items.length === 0 ? (
            <p className="text-muted-foreground" data-testid={`${testId}-empty`}>None.</p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} data-testid={`${testId}-item-${it.id}`} className="text-muted-foreground">{it.label}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

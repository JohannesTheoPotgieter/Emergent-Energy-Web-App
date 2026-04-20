import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { pdStageLifecycleLabel } from "@/lib/pdStageLifecycle";

export interface OpportunityCardRow {
  id: number;
  dealName: string;
  pipedriveDealId: string | null;
  orgClientName: string | null;
  projectDeveloper: string | null;
  stage: string | null;
  province: string | null;
  estimatedValue: number | null;
  estimatedKwp: number | null;
  expectedCloseDate?: string | null;
  nextActivityDate: string | null;
  openEngineeringTaskCount: number;
}

const STAGE_ORDER = [
  "prospect",
  "qualification",
  "proposal",
  "negotiation",
  "contracting",
] as const;

const STAGE_LABELS: Record<string, string> = {
  prospect: "Prospect",
  qualification: "Qualification",
  proposal: "Proposal",
  negotiation: "Negotiation",
  contracting: "Contracting",
};

const STAGE_THEME: Record<string, { col: string; chip: string }> = {
  prospect:      { col: "bg-slate-50/70 border-slate-200",   chip: "bg-slate-100 text-slate-700" },
  qualification: { col: "bg-sky-50/60 border-sky-200",       chip: "bg-sky-100 text-sky-700" },
  proposal:      { col: "bg-indigo-50/60 border-indigo-200", chip: "bg-indigo-100 text-indigo-700" },
  negotiation:   { col: "bg-amber-50/60 border-amber-200",   chip: "bg-amber-100 text-amber-800" },
  contracting:   { col: "bg-emerald-50/70 border-emerald-200", chip: "bg-emerald-100 text-emerald-800" },
};

function formatZAR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${n.toFixed(0)}`;
}

function formatKwp(k: number | null | undefined): string {
  if (k == null || !Number.isFinite(k)) return "";
  if (k >= 1000) return `${(k / 1000).toFixed(2)} MWp`;
  return `${k.toFixed(0)} kWp`;
}

function bucketStage(stage: string | null): typeof STAGE_ORDER[number] {
  const s = (stage || "").trim().toLowerCase();
  for (const key of STAGE_ORDER) if (s.includes(key)) return key;
  return "prospect";
}

// ────────────────────────────────────────────────────────────────────────────
// Kanban
// ────────────────────────────────────────────────────────────────────────────

export function OpportunitiesKanban({
  rows,
  onCardClick,
}: {
  rows: OpportunityCardRow[];
  onCardClick: (id: number) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, OpportunityCardRow[]>();
    STAGE_ORDER.forEach((s) => map.set(s, []));
    for (const row of rows) map.get(bucketStage(row.stage))!.push(row);
    return map;
  }, [rows]);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-max" data-testid="opportunities-kanban">
        {STAGE_ORDER.map((stage) => {
          const items = grouped.get(stage) || [];
          const totalValue = items.reduce((sum, r) => sum + (r.estimatedValue || 0), 0);
          const theme = STAGE_THEME[stage];
          return (
            <div
              key={stage}
              className={`w-[280px] shrink-0 rounded-lg border ${theme.col} flex flex-col max-h-[calc(100vh-340px)]`}
              data-testid={`kanban-col-${stage}`}
            >
              <div className="px-3 py-2 border-b border-current/10 sticky top-0 bg-inherit rounded-t-lg space-y-0.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-semibold text-emerald-800"
                      data-testid={`kanban-col-lifecycle-${stage}`}
                      title={pdStageLifecycleLabel(stage) ? `Company lifecycle phase` : `Pipedrive stage`}
                    >
                      {pdStageLifecycleLabel(stage) || STAGE_LABELS[stage]}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${theme.chip}`}>{items.length}</span>
                  </div>
                  <span className="text-[11px] text-slate-600 tabular-nums font-medium">{formatZAR(totalValue)}</span>
                </div>
                {pdStageLifecycleLabel(stage) && (
                  <div
                    className="text-[10px] lowercase text-slate-500 leading-tight"
                    title={`Pipedrive stage: ${STAGE_LABELS[stage]}`}
                  >
                    {String(STAGE_LABELS[stage]).toLowerCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {items.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center py-4">No deals</p>
                ) : (
                  items.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => onCardClick(r.id)}
                      className="w-full text-left bg-white rounded-md border border-slate-200 hover:border-emerald-400 hover:shadow-sm transition-all p-2.5 group"
                      data-testid={`kanban-card-${r.id}`}
                    >
                      <p className="text-[10px] text-slate-500 truncate">{r.orgClientName || "Unlinked"}</p>
                      <p className="text-xs font-semibold text-slate-900 truncate leading-snug" title={r.dealName}>
                        {r.dealName || `Deal #${r.id}`}
                      </p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] tabular-nums font-semibold text-slate-700">{formatZAR(r.estimatedValue)}</span>
                        {r.estimatedKwp != null && (
                          <span className="text-[10px] tabular-nums text-slate-500">{formatKwp(r.estimatedKwp)}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1 gap-1">
                        <span className="text-[10px] text-slate-500 truncate" title={r.projectDeveloper || ""}>
                          {r.projectDeveloper || "Unassigned"}
                        </span>
                        {r.openEngineeringTaskCount > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-emerald-600 text-white rounded-full font-semibold tabular-nums">
                            {r.openEngineeringTaskCount} eng
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Calendar (month view, anchored on expectedCloseDate)
// ────────────────────────────────────────────────────────────────────────────

const MONTH_LABEL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function isoDay(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

export function OpportunitiesCalendar({
  rows,
  onEventClick,
}: {
  rows: OpportunityCardRow[];
  onEventClick: (id: number) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  // Bucket events by yyyy-mm-dd of expectedCloseDate
  const eventsByDay = useMemo(() => {
    const map = new Map<string, OpportunityCardRow[]>();
    for (const r of rows) {
      if (!r.expectedCloseDate) continue;
      const key = String(r.expectedCloseDate).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [rows]);

  // Build the grid: 6 weeks max, starting from the Monday of the week containing day 1
  const days = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    // Convert JS Sun=0 .. Sat=6 to Mon=0 .. Sun=6
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(start.getDate() - offset);
    const cells: Date[] = [];
    const totalCells = Math.ceil((offset + last.getDate()) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  const undated = useMemo(() => rows.filter((r) => !r.expectedCloseDate), [rows]);
  const today = new Date();
  const monthLabel = `${MONTH_LABEL[cursor.getMonth()]} ${cursor.getFullYear()}`;

  return (
    <div className="space-y-3" data-testid="opportunities-calendar">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-800">Est. Signature Calendar</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2" aria-label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))} data-testid="btn-cal-prev">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setCursor(startOfMonth(new Date()))} data-testid="btn-cal-today">
            Today
          </Button>
          <span className="text-sm font-medium text-slate-700 mx-2 min-w-[140px] text-center" data-testid="cal-month-label">{monthLabel}</span>
          <Button size="sm" variant="outline" className="h-7 px-2" aria-label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))} data-testid="btn-cal-next">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-t-md overflow-hidden text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-emerald-50/50 px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 border-t-0 rounded-b-md overflow-hidden -mt-3">
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const events = eventsByDay.get(isoDay(d)) || [];
          return (
            <div
              key={d.toISOString()}
              className={`min-h-[88px] p-1.5 ${inMonth ? "bg-white" : "bg-slate-50/60"} ${isToday ? "ring-2 ring-emerald-500 ring-inset" : ""}`}
            >
              <div className={`text-[11px] font-semibold mb-1 ${inMonth ? "text-slate-700" : "text-slate-400"} ${isToday ? "text-emerald-700" : ""}`}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {events.slice(0, 3).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onEventClick(e.id)}
                    className="w-full text-left text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 truncate font-medium"
                    title={`${e.dealName} — ${formatZAR(e.estimatedValue)}`}
                    data-testid={`cal-event-${e.id}`}
                  >
                    {e.dealName || `Deal #${e.id}`}
                  </button>
                ))}
                {events.length > 3 && (
                  <p className="text-[9px] text-slate-500 px-1">+{events.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Undated bucket */}
      {undated.length > 0 && (
        <div className="border rounded-md bg-amber-50/40 border-amber-200 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1.5">No expected close date ({undated.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {undated.slice(0, 30).map((r) => (
              <button
                key={r.id}
                onClick={() => onEventClick(r.id)}
                className="text-[10px] px-2 py-0.5 rounded bg-white border border-amber-200 hover:border-amber-400 truncate max-w-[180px]"
                data-testid={`cal-undated-${r.id}`}
              >
                {r.dealName || `Deal #${r.id}`}
              </button>
            ))}
            {undated.length > 30 && <span className="text-[10px] text-amber-700 self-center">+{undated.length - 30} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}

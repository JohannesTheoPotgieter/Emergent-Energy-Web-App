import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Download, Pencil } from "lucide-react";
import { useApiMutation } from "@/hooks/use-api-mutation";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell,
} from "recharts";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RagBadge } from "@/components/ui/status-badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { CANONICAL_LIFECYCLE_PHASES, TERMINAL_LIFECYCLE_PHASES } from "@shared/schema";
import { EditProjectInfoModal } from "@/components/execution/edit-project-info-modal";
import type { BoardResult, BoardRow, Rag, EngineeringSummary, QualitySummary } from "@/lib/execution-types";
import { fmtPct, fmtDate } from "@/lib/execution-types";

interface Filters {
  search: string;
  phase: string;
  rag: string;
  pm: string;
  hasFlags: boolean;
}
const DEFAULT_FILTERS: Filters = { search: "", phase: "all", rag: "all", pm: "all", hasFlags: false };
const LS_KEY = "execution-board-filters";
const LS_GROUP = "execution-board-group-by-pm";

const RAG_COLORS: Record<string, string> = { green: "#16A34A", amber: "#F59E0B", red: "#DC2626", none: "#CBD5E1" };

type PmUser = { id: number; name: string };

// Canonical lifecycle phases — the SAME list the company lifecycle board uses.
// Editing a phase here writes the canonical project_execution_state.phase via
// /api/lifecycle-board/projects/:id/phase, so the phase correlates through
// every lens (board, lifecycle board, project detail).
const LIFECYCLE_PHASES: string[] = [...CANONICAL_LIFECYCLE_PHASES, ...TERMINAL_LIFECYCLE_PHASES];

// Canonical lifecycle RAG status (GREEN / AMBER / RED) — the same ragStatus the
// company lifecycle board sets (a comment is required for the audit trail).
const RAG_STATUS_OPTIONS = ["GREEN", "AMBER", "RED"] as const;
const RAG_STATUS_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  GREEN: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  AMBER: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
  RED: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50 border-red-200" },
};

function PhaseCell({
  row, isAdmin, onSetPhase,
}: { row: BoardRow; isAdmin: boolean; onSetPhase: (row: BoardRow, phase: string) => void }) {
  const current = row.phase ?? "";
  if (!isAdmin) return <span className="text-muted-foreground">{current || "—"}</span>;
  // Include a legacy value not in the canonical list so the select still shows it.
  const options = !current || LIFECYCLE_PHASES.includes(current) ? LIFECYCLE_PHASES : [current, ...LIFECYCLE_PHASES];
  return (
    <span data-interactive="true" onClick={(e) => e.stopPropagation()}>
      <SearchableSelect
        value={current}
        onValueChange={(v) => { if (v && v !== current) onSetPhase(row, v); }}
        placeholder="Set phase"
        triggerClassName="h-7 w-[150px] text-xs border-0 bg-transparent hover:bg-muted px-1 shadow-none"
        data-testid={`select-phase-${row.projectId}`}
        options={options.map((p) => ({ value: p, label: p }))}
      />
    </span>
  );
}

function RagStatusCell({
  row, isAdmin, onSetRag,
}: { row: BoardRow; isAdmin: boolean; onSetRag: (row: BoardRow, rag: string, comment: string) => void }) {
  const [open, setOpen] = useState(false);
  const [rag, setRag] = useState("");
  const [comment, setComment] = useState("");
  const current = row.ragStatus ? row.ragStatus.toUpperCase() : null;
  const style = current ? RAG_STATUS_STYLE[current] : null;

  const badge = current && style ? (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${style.bg} ${style.text}`}>
      <span className={`w-2 h-2 rounded-full ${style.dot}`} />{current}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-[11px]">
      <span className="w-2 h-2 rounded-full bg-slate-300" />Not set
    </span>
  );

  if (!isAdmin) return badge;

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) { setRag(current ?? ""); setComment(""); } }}>
      <PopoverTrigger asChild>
        <button data-interactive="true" onClick={(e) => e.stopPropagation()} className="hover:opacity-80" data-testid={`btn-rag-${row.projectId}`}>{badge}</button>
      </PopoverTrigger>
      <PopoverContent data-interactive="true" onClick={(e) => e.stopPropagation()} className="w-64 p-3 space-y-2" align="start">
        <div className="text-xs font-semibold">Set RAG status</div>
        <div className="flex gap-1.5">
          {RAG_STATUS_OPTIONS.map((r) => {
            const s = RAG_STATUS_STYLE[r];
            return (
              <button
                key={r}
                onClick={() => setRag(r)}
                className={`flex-1 inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold ${rag === r ? `${s.bg} ${s.text} ring-1 ring-emerald-400` : "bg-card text-muted-foreground border-border"}`}
                data-testid={`rag-opt-${r}-${row.projectId}`}
              >
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />{r}
              </button>
            );
          })}
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Reason (required, min 5 chars)…"
          className="w-full h-16 text-xs border rounded p-1.5 resize-none"
          data-testid={`input-rag-comment-${row.projectId}`}
        />
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!rag || comment.trim().length < 5}
            onClick={() => { onSetRag(row, rag, comment.trim()); setOpen(false); }}
            data-testid={`btn-save-rag-${row.projectId}`}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Kpi({ label, value, tone, onClick, active }: { label: string; value: string | number; tone?: string; onClick?: () => void; active?: boolean }) {
  return (
    <Card
      className={`${onClick ? "cursor-pointer hover:border-emerald-400" : ""} ${active ? "border-emerald-500 ring-1 ring-emerald-500" : ""}`}
      onClick={onClick}
      data-testid={`execution-kpi-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ScheduleCell({ row }: { row: BoardRow }) {
  if (!row.schedule.hasPlan) {
    return <span className="text-muted-foreground" title="No imported program plan">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <RagBadge rag={row.schedule.rag} dotOnly showLabel={false} />
      <span className="tabular-nums">{fmtPct(row.schedule.actualPct)}/{fmtPct(row.schedule.expectedPct)}</span>
    </span>
  );
}

function MiniRag({ rag, value }: { rag: Rag; value: string }) {
  if (!rag) return <span className="text-muted-foreground" aria-label="no data">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`${rag} ${value}`} title={rag}>
      <RagBadge rag={rag} dotOnly showLabel={false} />
      <span className="text-xs tabular-nums">{value}</span>
    </span>
  );
}
const engValue = (e: EngineeringSummary): string => (e.blocked > 0 ? `${e.blocked} blkd` : `${e.complete}/${e.total}`);
const qaValue = (q: QualitySummary): string => (q.critical > 0 ? `${q.critical} crit` : `${q.openTotal}`);

interface RowProps {
  row: BoardRow;
  onOpen: (id: number) => void;
  isAdmin: boolean;
  pmUsers: PmUser[];
  onAssignPm: (row: BoardRow, name: string | null) => void;
  onSetPhase: (row: BoardRow, phase: string) => void;
  onSetRag: (row: BoardRow, rag: string, comment: string) => void;
  onEdit: (row: BoardRow) => void;
}

// Only navigate to detail when the click/keypress is on the row itself — never
// when it lands on an inline editor (PM, phase, RAG, edit, or any form control).
const INTERACTIVE = '[data-interactive="true"], button, a, input, select, textarea, [role="combobox"], [role="option"], [role="dialog"]';

function Row({ row, onOpen, isAdmin, pmUsers, onAssignPm, onSetPhase, onSetRag, onEdit }: RowProps) {
  return (
    <tr
      className="border-b hover:bg-muted/40 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      onClick={(e) => { if ((e.target as HTMLElement).closest(INTERACTIVE)) return; onOpen(row.projectId); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onOpen(row.projectId); } }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${row.projectName}`}
      data-testid={`execution-row-${row.projectId}`}
    >
      <td className="py-2 pr-3 font-medium">{row.projectName}</td>
      <td className="py-2 pr-3"><PhaseCell row={row} isAdmin={isAdmin} onSetPhase={onSetPhase} /></td>
      <td className="py-2 pr-3"><ScheduleCell row={row} /></td>
      <td className="py-2 pr-3">
        {row.nextTask ? <span className="whitespace-nowrap">{row.nextTask.taskName} · {fmtDate(row.nextTask.date)}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-3">
        {row.nextDelivery ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <RagBadge rag={row.nextDelivery.rag} dotOnly showLabel={false} />{row.nextDelivery.label} · {fmtDate(row.nextDelivery.date)}
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-3">
        {row.installers.count > 0 ? (
          <span title={row.installers.list.map((i) => i.name).join(", ")}>{row.installers.primary}{row.installers.count > 1 ? ` +${row.installers.count - 1}` : ""}</span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-3">
        {isAdmin ? (
          <span data-interactive="true" onClick={(e) => e.stopPropagation()}>
            <SearchableSelect
              value={row.pmName || "__unassigned"}
              onValueChange={(val) => onAssignPm(row, val === "__unassigned" ? null : val)}
              placeholder="No PM"
              triggerClassName={`h-7 w-[130px] text-xs border-0 bg-transparent hover:bg-muted px-1 shadow-none ${!row.pmName ? "text-red-500 font-medium" : ""}`}
              data-testid={`select-pm-${row.projectId}`}
              options={[{ value: "__unassigned", label: "Unassigned" }, ...pmUsers.map((u) => ({ value: u.name, label: u.name }))]}
            />
          </span>
        ) : (row.pmName ?? <span className="text-muted-foreground">—</span>)}
      </td>
      <td className="py-2 pr-3"><RagStatusCell row={row} isAdmin={isAdmin} onSetRag={onSetRag} /></td>
      <td className="py-2 pr-3"><MiniRag rag={row.engineering.rag} value={engValue(row.engineering)} /></td>
      <td className="py-2 pr-3"><MiniRag rag={row.quality.rag} value={qaValue(row.quality)} /></td>
      <td className="py-2 pr-1 tabular-nums">{row.flags.open + row.flags.flagged}/{row.flags.actioned}</td>
      {isAdmin && (
        <td className="py-2 pr-1" data-interactive="true" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(row)} aria-label={`Edit ${row.projectName}`} data-testid={`btn-edit-project-${row.projectId}`}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </td>
      )}
    </tr>
  );
}

const BASE_HEAD = ["Site", "Phase", "Sched", "Next task ·14d", "Next delivery", "Installer", "PM", "RAG", "Eng", "QA", "Flags"];

export default function ExecutionReviewBoard() {
  const [, navigate] = useLocation();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<BoardResult>({ queryKey: ["/api/execution-review/board"] });

  // Assignable PMs + inline editors (migrated from /projects, #12/#13/#15) —
  // admin only, mirroring the retired page's gating.
  const { data: pmUsers = [] } = useQuery<PmUser[]>({
    queryKey: ["/api/pm-assignable-users"],
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const [editProject, setEditProject] = useState<BoardRow | null>(null);

  const invalidateBoard = () => qc.invalidateQueries({ queryKey: ["/api/execution-review/board"] });

  const assignPm = useApiMutation({
    mutationFn: async ({ projectId, name }: { projectId: number; name: string | null }) => {
      const matched = pmUsers.find((u) => u.name === name);
      await apiRequest("PATCH", `/api/project-info/${projectId}/assign-pm`, {
        pm: name ?? "",
        pmUserId: matched?.id ?? null,
      });
    },
    errorToast: "Could not reassign PM",
    onSuccess: invalidateBoard,
  });

  // Phase + RAG write the CANONICAL lifecycle fields via the same endpoints the
  // company lifecycle board uses, so they correlate through every lens. The
  // phase endpoint enforces stage gates (it 409s on a blocked transition — the
  // error toast surfaces the reason; overrides live on the lifecycle board).
  const setPhase = useApiMutation({
    mutationFn: async ({ projectId, phase }: { projectId: number; phase: string }) => {
      await apiRequest("PATCH", `/api/lifecycle-board/projects/${projectId}/phase`, { phase });
    },
    successToast: "Phase updated",
    errorToast: "Could not change phase",
    onSuccess: invalidateBoard,
  });

  const setRag = useApiMutation({
    mutationFn: async ({ projectId, rag, comment }: { projectId: number; rag: string; comment: string }) => {
      await apiRequest("POST", `/api/lifecycle-board/projects/${projectId}/rag`, { rag, comment });
    },
    successToast: "RAG status updated",
    errorToast: "Could not update RAG status",
    onSuccess: invalidateBoard,
  });

  const handleExport = () => { window.location.href = "/api/export/projects-summary"; };

  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? { ...DEFAULT_FILTERS, ...JSON.parse(raw) } : DEFAULT_FILTERS;
    } catch { return DEFAULT_FILTERS; }
  });
  const [groupByPm, setGroupByPm] = useState<boolean>(() => localStorage.getItem(LS_GROUP) === "1");
  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(filters)); }, [filters]);
  useEffect(() => { localStorage.setItem(LS_GROUP, groupByPm ? "1" : "0"); }, [groupByPm]);

  const head = useMemo(() => (isAdmin ? [...BASE_HEAD, ""] : BASE_HEAD), [isAdmin]);
  const rowProps = {
    isAdmin,
    pmUsers,
    onAssignPm: (row: BoardRow, name: string | null) => assignPm.mutate({ projectId: row.projectId, name }),
    onSetPhase: (row: BoardRow, phase: string) => setPhase.mutate({ projectId: row.projectId, phase }),
    onSetRag: (row: BoardRow, rag: string, comment: string) => setRag.mutate({ projectId: row.projectId, rag, comment }),
    onEdit: (row: BoardRow) => setEditProject(row),
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const phases = useMemo(() => [...new Set(rows.map((r) => r.phase).filter(Boolean))] as string[], [rows]);
  const pms = useMemo(() => [...new Set(rows.map((r) => r.pmName).filter(Boolean))] as string[], [rows]);

  // ── dashboard aggregates ──
  const byPhaseData = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = r.phase ?? "—"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([phase, count]) => ({ phase, count })).sort((a, b) => b.count - a.count);
  }, [rows]);
  const ragData = useMemo(() => {
    const h = data?.header;
    const green = h?.ragGreen ?? 0, amber = h?.ragAmber ?? 0, red = h?.ragRed ?? 0;
    const none = Math.max((h?.activeCount ?? rows.length) - green - amber - red, 0);
    return [
      { key: "green", name: "On / ahead", value: green },
      { key: "amber", name: "Slipping", value: amber },
      { key: "red", name: "Behind", value: red },
      { key: "none", name: "No plan", value: none },
    ];
  }, [data, rows.length]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filters.search && !r.projectName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.phase !== "all" && r.phase !== filters.phase) return false;
    if (filters.rag !== "all" && r.schedule.rag !== filters.rag) return false;
    if (filters.pm !== "all" && r.pmName !== filters.pm) return false;
    if (filters.hasFlags && r.flags.open + r.flags.flagged === 0) return false;
    return true;
  }), [rows, filters]);

  const byPm = useMemo(() => {
    const m = new Map<string, BoardRow[]>();
    for (const r of filtered) { const k = r.pmName ?? "Unassigned"; const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const open = (id: number) => navigate(`/execution/site/${id}`);
  const h = data?.header;

  return (
    <PageShell className="max-w-7xl p-4 md:p-6" data-testid="execution-board-page">
      <PageHeader title="Execution" subtitle="Program-wide delivery control tower · schedule read verbatim from the latest imported program plan" />

      {/* KPI strip — clickable tiles cross-filter the table */}
      {h && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <Kpi label="Active sites" value={h.activeCount} onClick={() => setFilters({ ...DEFAULT_FILTERS })} />
          <Kpi label="Behind (red)" value={h.ragRed} tone={h.ragRed > 0 ? "text-red-600" : ""} active={filters.rag === "red"}
            onClick={() => setFilters((f) => ({ ...f, rag: f.rag === "red" ? "all" : "red" }))} />
          <Kpi label="Overdue deliveries" value={h.overdueDeliveries} tone={h.overdueDeliveries > 0 ? "text-amber-600" : ""}
            onClick={() => navigate("/execution/deliveries")} />
          <Kpi label="Open flags" value={h.openFlags} active={filters.hasFlags}
            onClick={() => setFilters((f) => ({ ...f, hasFlags: !f.hasFlags }))} />
          <Kpi label="Prog actual/exp" value={`${fmtPct(h.weightedActual)}/${fmtPct(h.weightedExpected)}`} />
        </div>
      )}

      {/* Dashboard: charts + needs-attention */}
      {!isLoading && !isError && rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-sm">Sites by phase</CardTitle></CardHeader>
            <CardContent className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byPhaseData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="phase" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                  <Bar dataKey="count" name="Sites" fill="#16A34A" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-sm">Schedule RAG</CardTitle></CardHeader>
            <CardContent className="h-[200px] flex items-center">
              <ResponsiveContainer width="60%" height="100%">
                <PieChart>
                  <Pie data={ragData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                    {ragData.map((d) => <Cell key={d.key} fill={RAG_COLORS[d.key]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <ul className="text-xs space-y-1 flex-1">
                {ragData.map((d) => (
                  <li key={d.key} className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: RAG_COLORS[d.key] }} />
                    {d.name} <span className="ml-auto tabular-nums font-medium">{d.value}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-sm">Needs attention</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <button className="w-full flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50"
                onClick={() => setFilters((f) => ({ ...f, rag: "red" }))} data-testid="attention-behind">
                <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-600" /> Behind plan</span>
                <Badge variant={h && h.ragRed > 0 ? "destructive" : "secondary"}>{h?.ragRed ?? 0}</Badge>
              </button>
              <button className="w-full flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50"
                onClick={() => navigate("/execution/deliveries")} data-testid="attention-deliveries">
                <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Overdue deliveries</span>
                <Badge variant="secondary">{h?.overdueDeliveries ?? 0}</Badge>
              </button>
              <button className="w-full flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50"
                onClick={() => setFilters((f) => ({ ...f, hasFlags: true }))} data-testid="attention-flags">
                <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Open flags</span>
                <Badge variant="secondary">{h?.openFlags ?? 0}</Badge>
              </button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Input className="w-48" placeholder="Search site…" value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} data-testid="execution-search" />
        <Select value={filters.phase} onValueChange={(v) => setFilters((f) => ({ ...f, phase: v }))}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Phase" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All phases</SelectItem>{phases.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.rag} onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Schedule RAG" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All RAG</SelectItem><SelectItem value="red">Red</SelectItem><SelectItem value="amber">Amber</SelectItem><SelectItem value="green">Green</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.pm} onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))}>
          <SelectTrigger className="w-40"><SelectValue placeholder="PM" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All PMs</SelectItem>{pms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant={filters.hasFlags ? "default" : "outline"} size="sm"
          onClick={() => setFilters((f) => ({ ...f, hasFlags: !f.hasFlags }))} data-testid="execution-filter-flags">Has flags</Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} of {rows.length}</span>
          <Button variant={groupByPm ? "default" : "outline"} size="sm" onClick={() => setGroupByPm((v) => !v)} data-testid="execution-group-by-pm">Group by PM</Button>
          <Button variant="outline" size="sm" onClick={handleExport} data-testid="execution-export" className="gap-1.5">
            <Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Compact table */}
      <Card className="mt-3">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-muted-foreground" data-testid="execution-board-error">Could not load the board. <Button variant="link" onClick={() => refetch()}>Retry</Button></div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground" data-testid="execution-board-empty">No active sites match these filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">{head.map((hd, i) => <th key={hd || `col-${i}`} className="py-2 pr-3 font-medium">{hd}</th>)}</tr></thead>
              <tbody>
                {groupByPm
                  ? byPm.map(([pm, prs]) => (
                      <Fragment key={`g-${pm}`}>
                        <tr className="bg-muted/30"><td colSpan={head.length} className="py-1.5 px-2 text-xs font-medium">{pm} — {prs.length} active · {prs.filter((r) => r.schedule.rag === "red").length} behind</td></tr>
                        {prs.map((r) => <Row key={r.projectId} row={r} onOpen={open} {...rowProps} />)}
                      </Fragment>
                    ))
                  : filtered.map((r) => <Row key={r.projectId} row={r} onOpen={open} {...rowProps} />)}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-1">as imported</Badge>
        Schedule = actual%/expected%, duration-weighted from the latest tracker import. Flags = open/actioned.
      </p>

      <EditProjectInfoModal
        row={editProject}
        open={!!editProject}
        onOpenChange={(o) => { if (!o) setEditProject(null); }}
      />
    </PageShell>
  );
}

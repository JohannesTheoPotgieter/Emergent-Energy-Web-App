import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronsUpDown, Download, ListFilter, Pencil } from "lucide-react";
import { useApiMutation } from "@/hooks/use-api-mutation";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LabelList,
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
import UserPicker from "@/components/UserPicker";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { PHASE_LABELS } from "@shared/phases";
import { EditProjectInfoModal } from "@/components/execution/edit-project-info-modal";
import type { BoardResult, BoardRow, Rag, EngineeringSummary, QualitySummary } from "@/lib/execution-types";
import { fmtPct, fmtDate, parseExecDate } from "@/lib/execution-types";

interface Filters {
  search: string;
  phases: string[];
  rag: string;
  pm: string;
  hasFlags: boolean;
}
const DEFAULT_FILTERS: Filters = { search: "", phases: [], rag: "all", pm: "all", hasFlags: false };

/** Load persisted filters, tolerating the pre-multiselect `phase: string` shape. */
function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const merged = { ...DEFAULT_FILTERS, ...(raw ? JSON.parse(raw) : {}) } as Filters & { phase?: string };
    if (!Array.isArray(merged.phases)) merged.phases = [];
    // Migrate a single legacy `phase` value (anything but the old "all" sentinel).
    if (merged.phase && merged.phase !== "all" && merged.phases.length === 0) merged.phases = [merged.phase];
    delete merged.phase;
    return merged;
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}
const LS_KEY = "execution-board-filters";
const LS_GROUP = "execution-board-group-by-pm";

const RAG_COLORS: Record<string, string> = { green: "#16A34A", amber: "#F59E0B", red: "#DC2626", none: "#CBD5E1" };

// Canonical lifecycle phases — driven from the SAME source the server validates
// against (shared/phases PHASE_LABELS, e.g. "Commissioning & QA"), so an inline
// edit writes a value the /phase endpoint accepts. Editing writes the canonical
// project_execution_state.phase via /api/lifecycle-board/projects/:id/phase, so
// the phase correlates through every lens (board, lifecycle board, detail).
const LIFECYCLE_PHASES: string[] = [...PHASE_LABELS];

/** Map a stored phase (possibly legacy-cased, e.g. "PLANNING") to its canonical label. */
function canonicalPhaseLabel(phase: string | null): string {
  if (!phase) return "";
  const lc = phase.trim().toLowerCase();
  return LIFECYCLE_PHASES.find((p) => p.toLowerCase() === lc) ?? phase;
}

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
  // Normalise the stored value (e.g. legacy "PLANNING") to its canonical label
  // so the select shows the matching option and never sends a rejected value.
  const current = canonicalPhaseLabel(row.phase);
  if (!isAdmin) return <span className="text-muted-foreground">{current || "—"}</span>;
  // Include a truly-unknown value as an extra option so the select still shows it.
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

function Kpi({ label, value, tone, onClick, active, accent }: { label: string; value: string | number; tone?: string; onClick?: () => void; active?: boolean; accent?: string }) {
  return (
    <Card
      className={`relative overflow-hidden transition-colors ${onClick ? "cursor-pointer hover:border-emerald-400 hover:shadow-sm" : ""} ${active ? "border-emerald-500 ring-1 ring-emerald-500" : ""}`}
      onClick={onClick}
      data-testid={`execution-kpi-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      {accent && <span className={`absolute left-0 top-0 h-full w-1 ${accent}`} aria-hidden />}
      <CardContent className="p-3 pl-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
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

const LS_SORT = "execution-board-sort";
const LS_COLW = "execution-board-colwidths";

// Sort helpers — worst-first for RAG-style columns, lifecycle order for phase.
const ragRank = (rag: Rag): number => (rag === "red" ? 0 : rag === "amber" ? 1 : rag === "green" ? 2 : 3);
const ragStatusRank = (s: string | null): number =>
  s ? ({ RED: 0, AMBER: 1, GREEN: 2 } as Record<string, number>)[s.toUpperCase()] ?? 4 : 4;
const phaseRank = (phase: string | null): number => {
  const i = LIFECYCLE_PHASES.indexOf(canonicalPhaseLabel(phase));
  return i === -1 ? LIFECYCLE_PHASES.length : i;
};
const dateRank = (d: string | null): number => parseExecDate(d)?.getTime() ?? Number.POSITIVE_INFINITY;

/** Per-column sort value, keyed by column key (kept module-level so sorting is stable). */
function sortValue(r: BoardRow, key: string): string | number {
  switch (key) {
    case "site": return r.projectName.toLowerCase();
    case "phase": return phaseRank(r.phase);
    case "sched": return r.schedule.variance ?? Number.POSITIVE_INFINITY;
    case "nextTask": return dateRank(r.nextTask?.date ?? null);
    case "nextDelivery": return dateRank(r.nextDelivery?.date ?? null);
    case "installer": return (r.installers.primary ?? "").toLowerCase();
    case "pm": return (r.pmName ?? "~").toLowerCase();
    case "rag": return ragStatusRank(r.ragStatus);
    case "eng": return ragRank(r.engineering.rag);
    case "qa": return ragRank(r.quality.rag);
    case "flags": return r.flags.open + r.flags.flagged;
    default: return 0;
  }
}

/** Truncating cell content — keeps long values (e.g. delivery names) inside the column. */
function Trunc({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="block truncate" title={title}>{children}</span>;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 opacity-30 shrink-0" />;
  return dir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600 shrink-0" /> : <ArrowDown className="w-3 h-3 text-emerald-600 shrink-0" />;
}

interface Col {
  key: string;
  header: string;
  width: number;
  align?: "right";
  sortable?: boolean;
  cell: (r: BoardRow) => ReactNode;
}

// Only navigate to detail when the click/keypress is on the row itself — never
// when it lands on an inline editor (PM, phase, RAG, edit, or any form control).
const INTERACTIVE = '[data-interactive="true"], button, a, input, select, textarea, [role="combobox"], [role="option"], [role="dialog"]';

function TableRow({ row, columns, onOpen }: { row: BoardRow; columns: Col[]; onOpen: (id: number) => void }) {
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
      {columns.map((c) => (
        <td key={c.key} className={`py-2 px-2 overflow-hidden align-middle ${c.align === "right" ? "text-right" : ""}`}>
          {c.cell(row)}
        </td>
      ))}
    </tr>
  );
}

/** Multi-select phase filter — checkbox popover with search. Empty = all phases. */
function PhaseMultiSelect({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const matches = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const toggle = (p: string) => onChange(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]);
  const label = selected.length === 0 ? "All phases" : selected.length === 1 ? selected[0] : `${selected.length} phases`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-44 h-9 justify-between font-normal" data-testid="execution-phase-filter">
          <span className="inline-flex items-center gap-1.5 truncate">
            <ListFilter className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">{label}</span>
          </span>
          <span className="inline-flex items-center gap-1 shrink-0">
            {selected.length > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{selected.length}</Badge>}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <div className="p-2 border-b">
          <Input className="h-8 text-xs" placeholder="Search phases…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="execution-phase-search" />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/60 text-muted-foreground"
            onClick={() => onChange([])}
            data-testid="execution-phase-all"
          >
            <span className={`flex items-center justify-center w-4 h-4 rounded border ${selected.length === 0 ? "bg-emerald-600 border-emerald-600 text-white" : "border-input"}`}>
              {selected.length === 0 && <Check className="h-3 w-3" />}
            </span>
            All phases
          </button>
          {matches.map((p) => {
            const on = selected.includes(p);
            return (
              <button
                key={p}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/60 text-left"
                onClick={() => toggle(p)}
                data-testid={`execution-phase-opt-${p}`}
              >
                <span className={`flex items-center justify-center w-4 h-4 shrink-0 rounded border ${on ? "bg-emerald-600 border-emerald-600 text-white" : "border-input"}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{p}</span>
              </button>
            );
          })}
          {matches.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground text-center">No phases found</p>}
        </div>
        {selected.length > 0 && (
          <div className="p-1 border-t">
            <button className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 rounded hover:bg-muted/60" onClick={() => onChange([])} data-testid="execution-phase-clear">
              Clear selection
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function ExecutionReviewBoard() {
  const [, navigate] = useLocation();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<BoardResult>({ queryKey: ["/api/execution-review/board"] });

  const [editProject, setEditProject] = useState<BoardRow | null>(null);

  const invalidateBoard = () => qc.invalidateQueries({ queryKey: ["/api/execution-review/board"] });

  const assignPm = useApiMutation({
    mutationFn: async ({ projectId, pm, pmUserId }: { projectId: number; pm: string; pmUserId: number | null }) => {
      await apiRequest("PATCH", `/api/project-info/${projectId}/assign-pm`, { pm, pmUserId });
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

  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [groupByPm, setGroupByPm] = useState<boolean>(() => localStorage.getItem(LS_GROUP) === "1");
  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(filters)); }, [filters]);
  useEffect(() => { localStorage.setItem(LS_GROUP, groupByPm ? "1" : "0"); }, [groupByPm]);

  // Sort + resizable column widths (both persisted to localStorage).
  const [sort, setSort] = useState<{ key: string | null; dir: "asc" | "desc" }>(() => {
    try { const s = JSON.parse(localStorage.getItem(LS_SORT) || "null"); return s?.key ? s : { key: null, dir: "asc" }; }
    catch { return { key: null, dir: "asc" }; }
  });
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_COLW) || "{}"); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem(LS_SORT, JSON.stringify(sort)); }, [sort]);
  useEffect(() => { localStorage.setItem(LS_COLW, JSON.stringify(colWidths)); }, [colWidths]);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const onAssignPm = (row: BoardRow, id: number | null, name: string | null) =>
    assignPm.mutate({ projectId: row.projectId, pm: name ?? "", pmUserId: id });
  const onSetPhase = (row: BoardRow, phase: string) => setPhase.mutate({ projectId: row.projectId, phase });
  const onSetRag = (row: BoardRow, rag: string, comment: string) => setRag.mutate({ projectId: row.projectId, rag, comment });

  const columns: Col[] = [
    { key: "site", header: "Site", width: 140, sortable: true, cell: (r) => <Trunc title={r.projectName}><span className="font-medium">{r.projectName}</span></Trunc> },
    { key: "phase", header: "Phase", width: 145, sortable: true, cell: (r) => <PhaseCell row={r} isAdmin={isAdmin} onSetPhase={onSetPhase} /> },
    { key: "sched", header: "Sched", width: 95, sortable: true, cell: (r) => <ScheduleCell row={r} /> },
    { key: "nextTask", header: "Next task ·14d", width: 165, sortable: true, cell: (r) => r.nextTask ? <Trunc title={`${r.nextTask.taskName} · ${fmtDate(r.nextTask.date)}`}>{r.nextTask.taskName} · {fmtDate(r.nextTask.date)}</Trunc> : <span className="text-muted-foreground">—</span> },
    { key: "nextDelivery", header: "Next delivery", width: 165, sortable: true, cell: (r) => r.nextDelivery ? <Trunc title={`${r.nextDelivery.label} · ${fmtDate(r.nextDelivery.date)}`}><span className="inline-flex items-center gap-1.5"><RagBadge rag={r.nextDelivery.rag} dotOnly showLabel={false} />{r.nextDelivery.label} · {fmtDate(r.nextDelivery.date)}</span></Trunc> : <span className="text-muted-foreground">—</span> },
    { key: "installer", header: "Installer", width: 110, sortable: true, cell: (r) => r.installers.count > 0 ? <Trunc title={r.installers.list.map((i) => i.name).join(", ")}>{r.installers.primary}{r.installers.count > 1 ? ` +${r.installers.count - 1}` : ""}</Trunc> : <span className="text-muted-foreground">—</span> },
    { key: "pm", header: "PM", width: 150, sortable: true, cell: (r) => isAdmin ? (
      <span data-interactive="true" onClick={(e) => e.stopPropagation()}>
        <UserPicker
          value={r.pmUserId}
          valueType="internal_user"
          restrictTo="internal"
          onValueChange={(id, name) => onAssignPm(r, id, name)}
          placeholder={r.pmName || "No PM"}
          label="Assign PM"
          data-testid={`select-pm-${r.projectId}`}
        />
      </span>
    ) : (r.pmName ? <Trunc title={r.pmName}>{r.pmName}</Trunc> : <span className="text-muted-foreground">—</span>) },
    { key: "rag", header: "RAG", width: 95, sortable: true, cell: (r) => <RagStatusCell row={r} isAdmin={isAdmin} onSetRag={onSetRag} /> },
    { key: "eng", header: "Eng", width: 75, sortable: true, cell: (r) => <MiniRag rag={r.engineering.rag} value={engValue(r.engineering)} /> },
    { key: "qa", header: "QA", width: 65, sortable: true, cell: (r) => <MiniRag rag={r.quality.rag} value={qaValue(r.quality)} /> },
    { key: "flags", header: "Flags", width: 70, align: "right", sortable: true, cell: (r) => <span className="tabular-nums">{r.flags.open + r.flags.flagged}/{r.flags.actioned}</span> },
    ...(isAdmin ? ([{ key: "actions", header: "", width: 46, cell: (r: BoardRow) => (
      <span data-interactive="true" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditProject(r)} aria-label={`Edit ${r.projectName}`} data-testid={`btn-edit-project-${r.projectId}`}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </span>
    ) }] as Col[]) : []),
  ];

  const colW = (c: Col) => colWidths[c.key] ?? c.width;
  const startResize = (e: React.MouseEvent, key: string, startW: number) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startW };
    const move = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.max(48, resizing.current.startW + (ev.clientX - resizing.current.startX));
      setColWidths((prev) => ({ ...prev, [resizing.current!.key]: w }));
    };
    const up = () => { resizing.current = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
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
  const ragTotal = useMemo(() => ragData.reduce((s, d) => s + d.value, 0), [ragData]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filters.search && !r.projectName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.phases.length > 0 && !filters.phases.includes(r.phase ?? "—")) return false;
    if (filters.rag !== "all" && r.schedule.rag !== filters.rag) return false;
    if (filters.pm !== "all" && r.pmName !== filters.pm) return false;
    if (filters.hasFlags && r.flags.open + r.flags.flagged === 0) return false;
    return true;
  }), [rows, filters]);

  const togglePhase = (p: string) =>
    setFilters((f) => ({ ...f, phases: f.phases.includes(p) ? f.phases.filter((x) => x !== p) : [...f.phases, p] }));
  const toggleSchedRag = (rag: string) =>
    setFilters((f) => ({ ...f, rag: f.rag === rag ? "all" : rag }));

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, key), bv = sortValue(b, key);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort]);

  const byPm = useMemo(() => {
    const m = new Map<string, BoardRow[]>();
    for (const r of sorted) { const k = r.pmName ?? "Unassigned"; const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sorted]);

  const open = (id: number) => navigate(`/execution/site/${id}`);
  const h = data?.header;

  return (
    <PageShell className="max-w-7xl p-4 md:p-6" data-testid="execution-board-page">
      <PageHeader title="Execution" subtitle="Program-wide delivery control tower · schedule read verbatim from the latest imported program plan" />

      {/* KPI strip — clickable tiles cross-filter the table */}
      {h && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <Kpi label="Active sites" value={h.activeCount} accent="bg-emerald-500" onClick={() => setFilters({ ...DEFAULT_FILTERS })} />
          <Kpi label="Behind (red)" value={h.ragRed} tone={h.ragRed > 0 ? "text-red-600" : ""} accent="bg-red-500" active={filters.rag === "red"}
            onClick={() => setFilters((f) => ({ ...f, rag: f.rag === "red" ? "all" : "red" }))} />
          <Kpi label="Overdue deliveries" value={h.overdueDeliveries} tone={h.overdueDeliveries > 0 ? "text-amber-600" : ""} accent="bg-amber-500"
            onClick={() => navigate("/execution/deliveries")} />
          <Kpi label="Open flags" value={h.openFlags} accent="bg-slate-400" active={filters.hasFlags}
            onClick={() => setFilters((f) => ({ ...f, hasFlags: !f.hasFlags }))} />
          <Kpi label="Prog actual/exp" value={`${fmtPct(h.weightedActual)}/${fmtPct(h.weightedExpected)}`} accent="bg-emerald-500" />
        </div>
      )}

      {/* Dashboard: charts + needs-attention */}
      {!isLoading && !isError && rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
          <Card>
            <CardHeader className="pb-1 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Sites by phase</CardTitle>
              <span className="text-[10px] text-muted-foreground">click a bar to filter</span>
            </CardHeader>
            <CardContent className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byPhaseData} margin={{ top: 14, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="phase" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                  <Bar
                    dataKey="count"
                    name="Sites"
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    onClick={(d) => { const p = (d as { phase?: string }).phase; if (p) togglePhase(p); }}
                  >
                    {byPhaseData.map((d) => {
                      const active = filters.phases.length === 0 || filters.phases.includes(d.phase);
                      return <Cell key={d.phase} fill={active ? "#16A34A" : "#D1FAE5"} />;
                    })}
                    <LabelList dataKey="count" position="top" fontSize={10} fill="#64748b" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Schedule RAG</CardTitle>
              <span className="text-[10px] text-muted-foreground">click to filter</span>
            </CardHeader>
            <CardContent className="h-[200px] flex items-center gap-2">
              <div className="relative h-full" style={{ width: "55%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={ragData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={46}
                      outerRadius={72}
                      paddingAngle={2}
                      stroke="none"
                      cursor="pointer"
                      onClick={(d) => { const k = (d as { key?: string }).key; if (k) toggleSchedRag(k === "none" ? "all" : k); }}
                    >
                      {ragData.map((d) => (
                        <Cell key={d.key} fill={RAG_COLORS[d.key]} opacity={filters.rag === "all" || filters.rag === d.key ? 1 : 0.3} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-semibold tabular-nums leading-none">{ragTotal}</span>
                  <span className="text-[10px] text-muted-foreground">sites</span>
                </div>
              </div>
              <ul className="text-xs space-y-0.5 flex-1">
                {ragData.map((d) => {
                  const active = filters.rag === d.key;
                  return (
                    <li key={d.key}>
                      <button
                        className={`w-full flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-muted/60 ${active ? "bg-muted ring-1 ring-emerald-300" : ""}`}
                        onClick={() => toggleSchedRag(d.key === "none" ? "all" : d.key)}
                        data-testid={`execution-rag-legend-${d.key}`}
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: RAG_COLORS[d.key] }} />
                        <span className="truncate">{d.name}</span>
                        <span className="ml-auto tabular-nums font-medium">{d.value}</span>
                      </button>
                    </li>
                  );
                })}
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
        <PhaseMultiSelect options={phases} selected={filters.phases} onChange={(v) => setFilters((f) => ({ ...f, phases: v }))} />
        {filters.phases.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {filters.phases.map((p) => (
              <button
                key={p}
                onClick={() => togglePhase(p)}
                className="inline-flex items-center gap-1 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 px-2 py-0.5 text-xs hover:bg-emerald-100"
                data-testid={`execution-phase-chip-${p}`}
              >
                {p}<span aria-hidden className="text-emerald-500">×</span>
              </button>
            ))}
          </div>
        )}
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
            <table className="text-sm border-collapse" style={{ tableLayout: "fixed", width: columns.reduce((s, c) => s + colW(c), 0) }}>
              <colgroup>{columns.map((c) => <col key={c.key} style={{ width: colW(c) }} />)}</colgroup>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`relative py-2 px-2 font-medium select-none whitespace-nowrap ${c.align === "right" ? "text-right" : ""} ${c.sortable ? "cursor-pointer hover:text-foreground" : ""}`}
                      onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                      data-testid={`execution-col-${c.key}`}
                    >
                      <span className={`inline-flex items-center gap-0.5 ${c.align === "right" ? "justify-end w-full" : ""}`}>
                        <span className="truncate">{c.header}</span>
                        {c.sortable && <SortIcon active={sort.key === c.key} dir={sort.dir} />}
                      </span>
                      <span
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-emerald-400/60"
                        onMouseDown={(e) => startResize(e, c.key, colW(c))}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`execution-resize-${c.key}`}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupByPm
                  ? byPm.map(([pm, prs]) => (
                      <Fragment key={`g-${pm}`}>
                        <tr className="bg-muted/30"><td colSpan={columns.length} className="py-1.5 px-2 text-xs font-medium">{pm} — {prs.length} active · {prs.filter((r) => r.schedule.rag === "red").length} behind</td></tr>
                        {prs.map((r) => <TableRow key={r.projectId} row={r} columns={columns} onOpen={open} />)}
                      </Fragment>
                    ))
                  : sorted.map((r) => <TableRow key={r.projectId} row={r} columns={columns} onOpen={open} />)}
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

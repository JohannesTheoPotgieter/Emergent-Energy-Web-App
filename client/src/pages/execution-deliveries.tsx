import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RagBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Download, Pencil, Plus, Truck } from "lucide-react";
import type { DeliveryProgramRow, WorkItemPick } from "@/lib/execution-types";
import { fmtDate, parseExecDate } from "@/lib/execution-types";
import { useTableSort, SortHeader, downloadCsv } from "@/lib/table-utils";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { apiRequest } from "@/lib/queryClient";

const SOURCE_LABEL: Record<DeliveryProgramRow["source"], string> = {
  milestone: "milestone",
  procurement: "order",
  task: "plan task",
};

/** Short will-it-make-it verdict from the row's planning state. */
function makeItVerdict(r: DeliveryProgramRow): string {
  if (r.complete) return r.willMakeIt === "red" ? "Delivered late" : "Delivered";
  if (r.source !== "procurement") return r.overdue ? "Overdue" : "—";
  if (r.leadTimeDays == null || !r.neededBy) return "Set lead time";
  if (r.orderDate) return r.willMakeIt === "red" ? "Will miss" : r.willMakeIt === "amber" ? "Tight" : "On track";
  return r.willMakeIt === "red" ? "Order overdue" : r.willMakeIt === "amber" ? "Order soon" : "In time";
}

function deliverySortValue(r: DeliveryProgramRow, key: string): string | number | null {
  switch (key) {
    case "site": return r.projectName.toLowerCase();
    case "item": return r.label.toLowerCase();
    case "needed": { const d = parseExecDate(r.neededBy ?? r.date); return d ? d.getTime() : null; }
    case "make": return r.willMakeIt === "red" ? 0 : r.willMakeIt === "amber" ? 1 : r.willMakeIt === "green" ? 2 : 3;
    case "status": return r.complete ? 2 : r.overdue ? 0 : 1;
    default: return null;
  }
}

// ──────────────────────────── create / edit dialog ───────────────────────────

interface ProjectOpt { id: number; name: string }

function DeliveryDialog({ projects, row, open, onOpenChange, onSaved }: {
  projects: ProjectOpt[];
  row: DeliveryProgramRow | null; // null = create
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(row?.id);
  // Promote: an existing plan-task delivery (no order yet) being turned into a
  // managed order — project + task are fixed, we just capture the planning.
  const isPromote = !isEdit && row?.linkedWorkItemId != null;
  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [workItemId, setWorkItemId] = useState<string>("");
  const [leadTime, setLeadTime] = useState<string>("");
  const [orderDate, setOrderDate] = useState<string>("");

  // reset fields when (re)opened
  useEffect(() => {
    if (!open) return;
    setProjectId(row ? String(row.projectId) : "");
    setTitle(row?.label ?? "");
    setWorkItemId(row?.linkedWorkItemId != null ? String(row.linkedWorkItemId) : "");
    setLeadTime(row?.leadTimeDays != null ? String(row.leadTimeDays) : "");
    setOrderDate(row?.orderDate ?? "");
  }, [open, row]);

  const { data: tasks } = useQuery<WorkItemPick[]>({
    queryKey: ["/api/execution-review/projects", projectId ? Number(projectId) : 0, "work-items"],
    enabled: open && !!projectId,
  });

  const save = useApiMutation({
    mutationFn: async () => {
      const body = {
        title: title || "Delivery",
        linkedWorkItemId: workItemId ? Number(workItemId) : null,
        leadTimeDays: leadTime === "" ? null : Number(leadTime),
        orderDate: orderDate || null,
      };
      if (isEdit && row?.id) {
        await apiRequest("PATCH", `/api/procurement/${row.id}`, body);
      } else {
        await apiRequest("POST", "/api/procurement", { projectId: Number(projectId), ...body });
      }
    },
    successToast: isEdit ? "Delivery updated" : "Delivery added",
    errorToast: "Could not save delivery",
    onSuccess: () => { onSaved(); onOpenChange(false); },
  });

  const markReceived = useApiMutation({
    mutationFn: async () => {
      if (!row?.id) return;
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      await apiRequest("PATCH", `/api/procurement/${row.id}`, { status: "received", deliveryActualDate: iso, deliveryStatus: "delivered" });
    },
    successToast: "Marked delivered",
    errorToast: "Could not update",
    onSuccess: () => { onSaved(); onOpenChange(false); },
  });

  const selectedTask = (tasks ?? []).find((t) => String(t.id) === workItemId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit delivery" : isPromote ? "Plan delivery" : "New delivery / order"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {isPromote && (
            <p className="text-xs text-muted-foreground">Planning <span className="font-medium text-foreground">{row?.label}</span> on {row?.projectName} — capture its lead time and order date to track if it'll make it on site.</p>
          )}
          {!isEdit && !isPromote && (
            <label className="text-sm block">
              <span className="text-muted-foreground">Project</span>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v); setWorkItemId(""); }}>
                <SelectTrigger data-testid="delivery-project"><SelectValue placeholder="Select project…" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="text-sm block">
            <span className="text-muted-foreground">Item / order</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Inverters — 50kW ×4" data-testid="delivery-title" />
          </label>
          <label className="text-sm block">
            <span className="text-muted-foreground">Needed for (execution task)</span>
            <Select value={workItemId} onValueChange={setWorkItemId} disabled={!projectId}>
              <SelectTrigger data-testid="delivery-task"><SelectValue placeholder={projectId ? "Link the task it's needed for…" : "Pick a project first"} /></SelectTrigger>
              <SelectContent>
                {(tasks ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.taskNo ? `${t.taskNo} · ` : ""}{t.title}{t.startDate ? ` (${fmtDate(t.startDate)})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTask?.startDate && <span className="text-[11px] text-muted-foreground">Needed on site: {fmtDate(selectedTask.startDate)}</span>}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm block">
              <span className="text-muted-foreground">Lead time (days)</span>
              <Input type="number" min={0} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="e.g. 42" data-testid="delivery-leadtime" />
            </label>
            <label className="text-sm block">
              <span className="text-muted-foreground">Ordered on <span className="opacity-60">(optional)</span></span>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} data-testid="delivery-orderdate" />
            </label>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {isEdit && !row?.complete && (
            <Button variant="outline" className="mr-auto" onClick={() => markReceived.mutate()} disabled={markReceived.isPending} data-testid="delivery-received">
              <Truck className="w-4 h-4 mr-1" /> Mark delivered
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!isEdit && !projectId)} data-testid="delivery-save">
            {isEdit ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────── page ────────────────────────────────────

export default function ExecutionDeliveries() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(true); // default: hide completed
  const [dialog, setDialog] = useState<{ row: DeliveryProgramRow | null } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<DeliveryProgramRow[]>({
    queryKey: ["/api/execution-review/program/deliveries"],
  });

  // Full active-project universe for the "new delivery" picker — NOT derived
  // from delivery rows (a project with no deliveries yet would otherwise be
  // unpickable). Fall back to the row-derived set if the list hasn't loaded.
  const { data: activeProjects } = useQuery<ProjectOpt[]>({
    queryKey: ["/api/execution-review/program/projects"],
  });
  const projects = useMemo<ProjectOpt[]>(() => {
    if (activeProjects && activeProjects.length > 0) {
      return [...activeProjects].sort((a, b) => a.name.localeCompare(b.name));
    }
    const m = new Map<number, string>();
    for (const r of data ?? []) m.set(r.projectId, r.projectName);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeProjects, data]);

  const rows = useMemo(
    () => (data ?? []).filter((r) => {
      if (overdueOnly && !r.overdue) return false;
      if (hideCompleted && r.complete) return false;
      return true;
    }),
    [data, overdueOnly, hideCompleted],
  );
  const { sorted, sort, toggle } = useTableSort(rows, deliverySortValue);
  // A delivery write changes the board's Next-delivery column too, so refresh
  // both this list and the board.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/execution-review/program/deliveries"] });
    qc.invalidateQueries({ queryKey: ["/api/execution-review/board"] });
  };

  const exportCsv = () => downloadCsv(
    "execution-deliveries",
    ["Site", "Item", "Source", "Linked task", "Needed by", "Lead days", "Order by", "ETA", "Will make it", "Status"],
    sorted.map((r) => [
      r.projectName, r.label, SOURCE_LABEL[r.source], r.taskNo ?? "",
      r.neededBy ?? r.date ?? "", r.leadTimeDays ?? "", r.orderBy ?? "", r.eta ?? "",
      makeItVerdict(r), r.complete ? "done" : r.overdue ? "overdue" : "open",
    ]),
  );

  return (
    <PageShell className="max-w-5xl p-4 md:p-6" data-testid="execution-deliveries-page">
      <PageHeader title="Deliveries" subtitle="Plan orders backward from the execution task they feed — capture lead time, see if they'll make it on site" />
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button size="sm" onClick={() => setDialog({ row: null })} className="gap-1.5" data-testid="deliveries-new"><Plus className="w-4 h-4" />New delivery</Button>
        <Button size="sm" variant={overdueOnly ? "default" : "outline"} onClick={() => setOverdueOnly((v) => !v)} data-testid="deliveries-overdue-only">Overdue only</Button>
        <Button size="sm" variant={hideCompleted ? "default" : "outline"} onClick={() => setHideCompleted((v) => !v)} data-testid="deliveries-hide-completed">Hide completed</Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rows.length} of {data?.length ?? 0}</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv} disabled={rows.length === 0} data-testid="deliveries-export">
            <Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      <Card className="mt-4"><CardContent className="p-0 overflow-x-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : isError ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Could not load. <Button variant="link" onClick={() => refetch()}>Retry</Button></p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No deliveries match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <SortHeader label="Site" sortKey="site" sort={sort} onSort={toggle} />
              <SortHeader label="Item / task" sortKey="item" sort={sort} onSort={toggle} />
              <SortHeader label="Needed by" sortKey="needed" sort={sort} onSort={toggle} />
              <th className="py-2 px-3 font-medium">Lead</th>
              <th className="py-2 px-3 font-medium">Order by / ETA</th>
              <SortHeader label="Will it make it" sortKey="make" sort={sort} onSort={toggle} />
              <th className="py-2 px-3" />
            </tr></thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={`${r.source}-${r.id ?? i}-${r.projectId}`} className="border-b hover:bg-muted/40" data-testid="deliveries-row">
                  <td className="py-1.5 px-3 font-medium align-top cursor-pointer" onClick={() => navigate(`/execution/site/${r.projectId}`)}>{r.projectName}</td>
                  <td className="py-1.5 px-3 align-top">
                    <div className={r.complete ? "text-muted-foreground line-through" : ""}>{r.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {SOURCE_LABEL[r.source]}{r.taskNo ? ` · ${r.taskNo}` : ""}{r.isLongLead ? " · long-lead" : ""}
                    </div>
                  </td>
                  <td className="py-1.5 px-3 align-top whitespace-nowrap tabular-nums">{fmtDate(r.neededBy ?? r.date)}</td>
                  <td className="py-1.5 px-3 align-top whitespace-nowrap tabular-nums text-muted-foreground">{r.leadTimeDays != null ? `${r.leadTimeDays}d` : "—"}</td>
                  <td className="py-1.5 px-3 align-top whitespace-nowrap tabular-nums">
                    {r.orderDate ? <span title="ETA = ordered + lead">ETA {fmtDate(r.eta)}</span> : r.orderBy ? <span title="Latest safe order date">by {fmtDate(r.orderBy)}</span> : "—"}
                  </td>
                  <td className="py-1.5 px-3 align-top whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5"><RagBadge rag={r.complete ? "green" : r.willMakeIt ?? r.rag} dotOnly showLabel={false} />{makeItVerdict(r)}</span>
                  </td>
                  <td className="py-1.5 px-2 align-top text-right">
                    {r.editable ? (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDialog({ row: r })} aria-label="Edit delivery" data-testid={`delivery-edit-${r.id}`}>
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    ) : r.complete ? <Badge variant="secondary">done</Badge> : r.overdue ? <Badge variant="destructive">overdue</Badge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>

      <DeliveryDialog
        projects={projects}
        row={dialog?.row ?? null}
        open={dialog != null}
        onOpenChange={(v) => { if (!v) setDialog(null); }}
        onSaved={invalidate}
      />
    </PageShell>
  );
}

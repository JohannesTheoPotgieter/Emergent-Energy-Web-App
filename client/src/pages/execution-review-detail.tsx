import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RagBadge } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import LatestUpdateEditor from "@/components/LatestUpdateEditor";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FlagDialog, AllocateDialog, AssignPmDialog } from "@/components/execution/execution-dialogs";
import { CriticalPathViewer } from "@/components/execution/critical-path";
import type {
  ProjectDetail, ExecutionReviewItem, ExecItemStatus, InstallerRow, PlanTaskView,
} from "@/lib/execution-types";
import { fmtPct, fmtDate, fmtMoney } from "@/lib/execution-types";

const ITEM_STATUSES: ExecItemStatus[] = ["open", "flagged", "actioned", "closed"];

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export default function ExecutionReviewDetail() {
  const [, params] = useRoute("/execution/site/:projectId");
  const projectId = params?.projectId ? Number(params.projectId) : NaN;
  const qc = useQueryClient();
  const { toast } = useToast();

  const detailKey = ["/api/execution-review/projects", projectId, "detail"];
  const itemsKey = ["/api/execution-review/projects", projectId, "items"];

  const { data, isLoading, isError, refetch } = useQuery<ProjectDetail>({
    queryKey: detailKey,
    enabled: Number.isFinite(projectId),
  });
  const items = useQuery<ExecutionReviewItem[]>({
    queryKey: itemsKey,
    enabled: Number.isFinite(projectId),
  });

  const [flagOpen, setFlagOpen] = useState(false);
  const [editItem, setEditItem] = useState<ExecutionReviewItem | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [editAlloc, setEditAlloc] = useState<InstallerRow | null>(null);
  const [pmOpen, setPmOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: itemsKey });
    qc.invalidateQueries({ queryKey: ["/api/execution-review/board"] });
  };

  const statusMut = useMutation({
    mutationFn: async (v: { id: number; status: ExecItemStatus }) =>
      apiRequest("PATCH", `/api/execution-review/items/${v.id}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemsKey }),
    onError: () => toast({ title: "Could not update status", variant: "destructive" }),
  });

  const saveLatestUpdate = async (value: string | null) => {
    if (!data) return;
    await apiRequest("PATCH", `/api/projects-summary/${encodeURIComponent(data.project.projectName)}/latest-update`, {
      latestUpdate: value,
    });
    qc.invalidateQueries({ queryKey: detailKey });
  };

  const itemsByCategory = useMemo(() => {
    const m = new Map<string, ExecutionReviewItem[]>();
    for (const it of items.data ?? []) {
      const arr = m.get(it.category) ?? [];
      arr.push(it);
      m.set(it.category, arr);
    }
    return [...m.entries()];
  }, [items.data]);

  const upcoming = useMemo(() => {
    const tasks = data?.planTasks ?? [];
    const parents = new Set(tasks.map((t) => t.parentTaskNo).filter(Boolean) as string[]);
    const horizon = Date.now() + 14 * 86_400_000;
    return tasks.filter((t) => {
      if (t.taskNo && parents.has(t.taskNo)) return false;
      if ((t.pctComplete ?? 0) >= 100) return false;
      const start = t.plannedStart ? new Date(t.plannedStart).getTime() : NaN;
      return Number.isFinite(start) && start >= Date.now() - 86_400_000 && start <= horizon;
    });
  }, [data]);

  if (!Number.isFinite(projectId)) return <PageShell className="p-6">Invalid project.</PageShell>;

  if (isLoading) {
    return (
      <PageShell className="max-w-6xl p-4 md:p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-40 w-full" />
      </PageShell>
    );
  }
  if (isError || !data) {
    return (
      <PageShell className="max-w-6xl p-6">
        <p className="text-sm text-muted-foreground">
          Could not load this site. <Button variant="link" onClick={() => refetch()}>Retry</Button>
        </p>
      </PageShell>
    );
  }

  const p = data.project;
  const importedLabel = data.schedule.importedAt ? fmtDate(data.schedule.importedAt) : "no import";

  return (
    <PageShell className="max-w-6xl p-4 md:p-6" data-testid="execution-detail-page">
      <Link href="/execution" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Execution
      </Link>
      <div className="flex flex-wrap items-center gap-3 mt-1">
        <h1 className="text-2xl font-semibold">{p.projectName}</h1>
        {p.phase && <Badge variant="outline">{p.phase}</Badge>}
        <span className="text-sm text-muted-foreground">{p.sizeKwp ? `${p.sizeKwp} kWp` : ""} {p.contractValue ? `· ${fmtMoney(p.contractValue)}` : ""}</span>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary">PM: {p.pmName ?? "Unassigned"}</Badge>
          <Button size="sm" variant="outline" onClick={() => setPmOpen(true)} data-testid="execution-assign-pm">Assign PM</Button>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Latest update</CardTitle></CardHeader>
        <CardContent>
          <LatestUpdateEditor
            projectName={p.projectName}
            latestUpdate={p.latestUpdate}
            latestUpdateBy={p.latestUpdateBy}
            latestUpdateAt={p.latestUpdateAt}
            onSave={saveLatestUpdate}
            testIdSuffix={String(p.id)}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="schedule" className="mt-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="schedule" data-testid="execution-tab-schedule">Schedule</TabsTrigger>
          <TabsTrigger value="critical-path" data-testid="execution-tab-critical-path">Critical path</TabsTrigger>
          <TabsTrigger value="upcoming" data-testid="execution-tab-upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="installers" data-testid="execution-tab-installers">Installers & suppliers</TabsTrigger>
          <TabsTrigger value="deliveries" data-testid="execution-tab-deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="engineering" data-testid="execution-tab-engineering">Engineering ↗</TabsTrigger>
          <TabsTrigger value="quality" data-testid="execution-tab-quality">Quality ↗</TabsTrigger>
          <TabsTrigger value="flags" data-testid="execution-tab-flags">Flags{items.data?.length ? ` (${items.data.length})` : ""}</TabsTrigger>
        </TabsList>

        {/* T1 Schedule */}
        <TabsContent value="schedule">
          <div className="flex items-center gap-2 text-sm mb-2">
            <RagBadge rag={data.schedule.rag} />
            <span>actual {fmtPct(data.schedule.actualPct)} / expected {fmtPct(data.schedule.expectedPct)}</span>
            <Badge variant="outline" className="ml-2">as imported · {importedLabel}</Badge>
          </div>
          {data.planTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No imported program plan for this site.</p>
          ) : (
            <Card><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  {["WBS", "Task", "Planned", "Actual", "%", "Slip"].map((h) => <th key={h} className="py-2 px-3 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.planTasks.map((t, i) => <PlanRow key={`${t.taskNo}-${i}`} t={t} />)}
                </tbody>
              </table>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Critical path */}
        <TabsContent value="critical-path">
          <CriticalPathViewer criticalPath={data.criticalPath} planTasks={data.planTasks} />
        </TabsContent>

        {/* T2 Upcoming */}
        <TabsContent value="upcoming">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No plan tasks starting in the next 14 days.</p>
          ) : (
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <tbody>
                  {upcoming.map((t, i) => (
                    <tr key={`${t.taskNo}-${i}`} className="border-b">
                      <td className="py-2 px-3 text-muted-foreground">{t.taskNo}</td>
                      <td className="py-2 px-3">{t.taskName}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{fmtDate(t.plannedStart)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* T3 Installers */}
        <TabsContent value="installers">
          <div className="flex justify-end mb-2">
            <Button size="sm" onClick={() => { setEditAlloc(null); setAllocOpen(true); }} data-testid="execution-allocate">
              <Plus className="h-3.5 w-3.5 mr-1" /> Allocate
            </Button>
          </div>
          {data.installers.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No active subcontractors or suppliers allocated.</p>
          ) : (
            <div className="space-y-2">
              {data.installers.map((a) => (
                <Card key={a.id}><CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{a.counterpartyName}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.workPackage ?? "—"}{a.scopeDescription ? ` · ${a.scopeDescription}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline">{a.counterpartyType ?? "—"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => { setEditAlloc(a); setAllocOpen(true); }}>Edit</Button>
                </CardContent></Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* T4 Deliveries */}
        <TabsContent value="deliveries">
          <div className="flex justify-end mb-2">
            <Link href={`/project/id/${p.id}`} className="text-sm text-emerald-600 inline-flex items-center gap-1">
              Open procurement <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
          {data.deliveries.milestones.length === 0 && data.deliveries.procurement.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No deliveries scheduled.</p>
          ) : (
            <Card><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  {["Item", "Source", "Date", "Status"].map((h) => <th key={h} className="py-2 px-3 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.deliveries.milestones.map((m) => (
                    <tr key={`m-${m.id}`} className="border-b">
                      <td className="py-2 px-3">{m.milestoneName}{m.blocker ? <Badge variant="destructive" className="ml-2">blocked</Badge> : null}</td>
                      <td className="py-2 px-3 text-muted-foreground">milestone</td>
                      <td className={`py-2 px-3 whitespace-nowrap ${isOverdue(m.plannedDate) && !m.actualDate ? "text-red-600" : ""}`}>{fmtDate(m.actualDate ?? m.plannedDate)}</td>
                      <td className="py-2 px-3">{m.status}</td>
                    </tr>
                  ))}
                  {data.deliveries.procurement.map((pr) => (
                    <tr key={`p-${pr.id}`} className="border-b">
                      <td className="py-2 px-3">{pr.title}</td>
                      <td className="py-2 px-3 text-muted-foreground">procurement</td>
                      <td className={`py-2 px-3 whitespace-nowrap ${isOverdue(pr.requiredDate) ? "text-red-600" : ""}`}>{fmtDate(pr.requiredDate)}</td>
                      <td className="py-2 px-3">{pr.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* T5 Engineering */}
        <TabsContent value="engineering">
          <Card><CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-3"><RagBadge rag={data.engineering.rag} />
              <span className="text-sm">{data.engineering.complete}/{data.engineering.total} stages complete · {data.engineering.blocked} blocked · {data.engineering.openTasks} open tasks</span>
            </div>
            <Link href="/engineering" className="text-sm text-emerald-600 inline-flex items-center gap-1">
              Open engineering <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </CardContent></Card>
        </TabsContent>

        {/* T6 Quality */}
        <TabsContent value="quality">
          <Card><CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-3"><RagBadge rag={data.quality.rag} />
              <span className="text-sm">
                {data.quality.openTotal} open snags · {data.quality.critical} critical · {data.quality.major} major · {data.quality.overdue} overdue · QCP {data.quality.hasQcp ? "in place" : "missing"}
              </span>
            </div>
            <Link href="/quality" className="text-sm text-emerald-600 inline-flex items-center gap-1">
              Open quality <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </CardContent></Card>
        </TabsContent>

        {/* T7 Flags */}
        <TabsContent value="flags">
          <div className="flex justify-end mb-2">
            <Button size="sm" onClick={() => { setEditItem(null); setFlagOpen(true); }} data-testid="execution-add-flag">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add item
            </Button>
          </div>
          {items.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : itemsByCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No flagged items yet — add the first.</p>
          ) : (
            itemsByCategory.map(([cat, list]) => (
              <div key={cat} className="mb-4">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{cat}</h3>
                <div className="space-y-2">
                  {list.map((it) => (
                    <Card key={it.id}><CardContent className="p-3 flex items-start gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{it.title}</div>
                        {it.detail && <div className="text-xs text-muted-foreground">{it.detail}</div>}
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                          <Badge variant="outline">{it.severity}</Badge>
                          {it.dueDate && <span>due {fmtDate(it.dueDate)}</span>}
                          {it.planTaskNo && <span>↳ WBS {it.planTaskNo}</span>}
                          {it.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                        </div>
                      </div>
                      <Select value={it.status} onValueChange={(v) => statusMut.mutate({ id: it.id, status: v as ExecItemStatus })}>
                        <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ITEM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost" onClick={() => { setEditItem(it); setFlagOpen(true); }}>Edit</Button>
                    </CardContent></Card>
                  ))}
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      <FlagDialog
        projectId={projectId}
        item={editItem}
        planTasks={data.planTasks}
        open={flagOpen}
        onOpenChange={setFlagOpen}
        onSaved={invalidate}
      />
      <AllocateDialog
        projectId={projectId}
        assignment={editAlloc}
        open={allocOpen}
        onOpenChange={setAllocOpen}
        onSaved={invalidate}
      />
      <AssignPmDialog
        projectId={projectId}
        currentPmName={p.pmName}
        open={pmOpen}
        onOpenChange={setPmOpen}
        onSaved={invalidate}
      />
    </PageShell>
  );
}

function PlanRow({ t }: { t: PlanTaskView }) {
  const indent = t.parentTaskNo ? "pl-6" : "font-medium";
  return (
    <tr className="border-b">
      <td className="py-1.5 px-3 text-muted-foreground tabular-nums">{t.taskNo}</td>
      <td className={`py-1.5 px-3 ${indent}`}>
        {t.taskName}
        {t.isMilestone ? <Badge variant="outline" className="ml-2">◆</Badge> : null}
        {t.onCriticalPath ? <Badge variant="destructive" className="ml-2">critical</Badge> : null}
      </td>
      <td className="py-1.5 px-3 whitespace-nowrap text-xs">{fmtDate(t.plannedStart)} – {fmtDate(t.plannedEnd)}</td>
      <td className="py-1.5 px-3 whitespace-nowrap text-xs">{fmtDate(t.actualStart)} – {fmtDate(t.actualEnd)}</td>
      <td className="py-1.5 px-3 tabular-nums">{fmtPct(t.pctComplete)}</td>
      <td className={`py-1.5 px-3 tabular-nums ${t.slipDays != null && t.slipDays > 0 ? "text-amber-600" : ""}`}>
        {t.slipDays == null ? "—" : `${t.slipDays > 0 ? "+" : ""}${t.slipDays}d`}
      </td>
    </tr>
  );
}

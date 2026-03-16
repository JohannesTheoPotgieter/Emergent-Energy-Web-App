import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminPageShell, AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check, FileSpreadsheet, Loader2, Clock, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, Filter,
  CheckCheck, ArrowRight, GitBranch, LayoutList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function parseChangeDetails(raw: string | null | undefined) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

const PAGE_SIZE = 30;

export default function ExcelUpdatesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"pending" | "confirmed" | "all">("pending");
  const [projectFilter, setProjectFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("status", tab);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (projectFilter) params.set("search", projectFilter);
    return params.toString();
  }, [tab, page, projectFilter]);

  const updatesQuery = useQuery<any, Error>({
    queryKey: ["excel-updates", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/excel-updates?${queryParams}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Excel update reconciliation could not be loaded.");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const data = updatesQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pendingCount = data?.pendingCount ?? 0;
  const confirmedCount = data?.confirmedCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const governanceStatuses = [
    pendingCount > 0
      ? { label: `${pendingCount} pending confirmations`, tone: "warning" as const }
      : { label: "No pending confirmations", tone: "success" as const },
    { label: "Tracker reconciliation visible here", tone: "info" as const },
  ];

  const confirmMutation = useMutation({
    mutationFn: async (notifId: number) => {
      const res = await fetch(`/api/notifications/${notifId}/confirm`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to confirm");
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Confirmed", description: "Marked as captured in Excel tracker" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not confirm", variant: "destructive" });
    },
  });

  const bulkConfirmMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/excel-updates/bulk-confirm", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notificationIds: ids }),
      });
      if (!res.ok) throw new Error("Failed to bulk confirm");
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      setSelectedIds(new Set());
      toast({ title: "Bulk Confirmed", description: `${data.confirmedCount} updates confirmed by ${data.confirmedBy}` });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not bulk confirm", variant: "destructive" });
    },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["excel-updates"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["notifications-center"] });
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    qc.invalidateQueries({ queryKey: ["notifications-list"] });
  }

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    const pendingIds = items.filter((n: any) => !n.confirmedAt).map((n: any) => n.id);
    setSelectedIds(new Set(pendingIds));
  };

  const handleConfirmAll = () => {
    const pendingIds = items.filter((n: any) => !n.confirmedAt).map((n: any) => n.id);
    if (pendingIds.length > 0) bulkConfirmMutation.mutate(pendingIds);
  };

  const handleConfirmSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length > 0) bulkConfirmMutation.mutate(ids);
  };

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const item of items) {
      const project = (item.projectName || "Unknown").replace(/_Tracker$/i, "").replace(/_/g, " ");
      if (!groups[project]) groups[project] = [];
      groups[project].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  return (
    <AdminPageShell
      surfaceId="excel-updates"
      title="Excel Updates"
      description="Review plan and Excel sync changes that still need to be captured in source trackers."
      statuses={governanceStatuses}
      metrics={[
        { label: "Pending", value: pendingCount, helper: "Awaiting tracker confirmation" },
        { label: "Confirmed", value: confirmedCount, helper: "Already reconciled" },
        { label: "Visible Total", value: pendingCount + confirmedCount, helper: "Current queue volume" },
      ]}
    >
    <div className="space-y-4" data-testid="excel-updates-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
          <div>
            <h1 className="text-xl font-bold text-foreground dark:text-white" data-testid="text-page-title">
              Excel Updates
            </h1>
            <p className="text-sm text-muted-foreground">
              Changes that need to be captured in Excel trackers
            </p>
          </div>
        </div>

        {pendingCount > 0 && (
          <Badge variant="destructive" className="text-sm px-3 py-1" data-testid="badge-pending-count">
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            {pendingCount} pending
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="excel-updates-kpis">
        <Card className="border-amber-200/50">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-700" data-testid="kpi-pending">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200/50">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-700" data-testid="kpi-confirmed">{confirmedCount}</p>
              <p className="text-xs text-muted-foreground">Confirmed</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <LayoutList className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground" data-testid="kpi-total">{pendingCount + confirmedCount}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setPage(0); setSelectedIds(new Set()); }}>
          <TabsList data-testid="tabs-filter">
            <TabsTrigger value="pending" className="gap-1.5" data-testid="tab-pending">
              <Clock className="w-3.5 h-3.5" />
              Pending ({pendingCount})
            </TabsTrigger>
            <TabsTrigger value="confirmed" className="gap-1.5" data-testid="tab-confirmed">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Confirmed ({confirmedCount})
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-1.5" data-testid="tab-all">
              All ({pendingCount + confirmedCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative flex-1 max-w-xs">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Filter by project..."
            value={projectFilter}
            onChange={(e) => { setProjectFilter(e.target.value); setPage(0); }}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground dark:text-white placeholder:text-slate-500"
            data-testid="input-project-filter"
          />
        </div>

        {tab === "pending" && pendingCount > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={handleConfirmSelected}
                disabled={bulkConfirmMutation.isPending}
                data-testid="button-confirm-selected"
              >
                {bulkConfirmMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Confirm Selected ({selectedIds.size})
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1"
              onClick={selectAllPending}
              data-testid="button-select-all"
            >
              <CheckCheck className="w-3 h-3" />
              Select All
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1 bg-amber-500 hover:bg-amber-600 text-white"
              onClick={handleConfirmAll}
              disabled={bulkConfirmMutation.isPending}
              data-testid="button-confirm-all"
            >
              {bulkConfirmMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
              Confirm All
            </Button>
          </div>
        )}
      </div>

      <AdminQueryState
        isLoading={updatesQuery.isLoading}
        error={updatesQuery.error?.message || null}
        onRetry={() => void updatesQuery.refetch()}
        loadingLabel="Loading reconciliation queue..."
      >
        {items.length === 0 ? (
          <Card data-testid="empty-state">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              {tab === "pending" ? (
                <>
                  <CheckCircle2 className="w-12 h-12 text-emerald-600 mb-3" />
                  <p className="text-lg font-medium text-foreground">All caught up!</p>
                  <p className="text-sm text-muted-foreground">No pending Excel updates to confirm.</p>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-12 h-12 text-slate-600 mb-3" />
                  <p className="text-lg font-medium text-foreground">No updates found</p>
                  <p className="text-sm text-muted-foreground">No Excel sync notifications match your filters.</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
          {grouped.map(([project, projectItems]) => (
            <div key={project} data-testid={`group-${project}`}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <GitBranch className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-sm font-semibold text-foreground">{project}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {projectItems.length}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {projectItems.map((n: any) => {
                  const details = parseChangeDetails(n.changeDetails);
                  const isConfirmed = !!n.confirmedAt;
                  const isSelected = selectedIds.has(n.id);
                  const isExcelSync = n.eventType === "excel_sync_confirmation";

                  return (
                    <Card
                      key={n.id}
                      className={`transition-all ${isConfirmed ? "bg-muted/80 border-border opacity-75" : "bg-card border-l-4 border-l-amber-400 border-t border-r border-b border-amber-200/50"} ${isSelected && !isConfirmed ? "ring-2 ring-amber-300 dark:ring-amber-700" : ""}`}
                      data-testid={`card-update-${n.id}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start gap-3">
                          {!isConfirmed && tab === "pending" && (
                            <label className="flex items-center pt-0.5 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(n.id)}
                                className="w-4 h-4 rounded border-border text-amber-500 focus:ring-amber-400"
                                data-testid={`checkbox-${n.id}`}
                              />
                            </label>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 ${isExcelSync
                                  ? "text-orange-600 border-orange-200 bg-orange-50"
                                  : "text-blue-600 border-blue-200 bg-blue-50"
                                }`}
                              >
                                {isExcelSync ? "Excel Sync" : "Plan Change"}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 ${isConfirmed
                                  ? "text-emerald-600 border-emerald-200 bg-emerald-50"
                                  : "text-amber-600 border-amber-200 bg-amber-50"
                                }`}
                                data-testid={`badge-status-${n.id}`}
                              >
                                {isConfirmed ? <><CheckCircle2 className="w-3 h-3 mr-0.5" /> Confirmed</> : <><Clock className="w-3 h-3 mr-0.5" /> Pending</>}
                              </Badge>
                              <span className="text-[10px] text-slate-500">{timeAgo(n.createdAt)}</span>
                            </div>

                            <p className="text-sm text-foreground leading-snug" data-testid={`text-body-${n.id}`}>
                              {n.body || n.title}
                            </p>

                            {details && (
                              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                                {details.changedBy && (
                                  <span>By: <strong className="text-foreground">{details.changedBy}</strong></span>
                                )}
                                {details.changeType && (
                                  <span>Type: <strong className="text-foreground">{details.changeType.replace(/_/g, " ")}</strong></span>
                                )}
                                {details.details && typeof details.details === "object" && Object.keys(details.details).length > 0 && (
                                  <div className="w-full mt-1 p-1.5 bg-muted rounded border border-border text-[11px]">
                                    {Object.entries(details.details).map(([k, v]) => (
                                      <div key={k} className="flex gap-2">
                                        <span className="text-slate-500 min-w-[70px]">{k}:</span>
                                        <span className="text-foreground truncate">{String(v)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {details.changes && Array.isArray(details.changes) && details.changes.length > 0 && (
                                  <div className="w-full mt-1 p-1.5 bg-blue-50 rounded border border-blue-100 text-[11px]">
                                    {details.changes.map((ch: any, i: number) => (
                                      <div key={i} className="flex items-center gap-2">
                                        <ArrowRight className="w-2.5 h-2.5 text-blue-600 flex-shrink-0" />
                                        <span className="text-foreground">
                                          {ch.field && <strong>{ch.field}: </strong>}
                                          {ch.oldValue && <span className="line-through text-red-600 mr-1">{ch.oldValue}</span>}
                                          {ch.newValue && <span className="text-emerald-600">{ch.newValue}</span>}
                                          {ch.operation && <span>{ch.operation}</span>}
                                          {ch.tasks && Array.isArray(ch.tasks) && ch.tasks.length > 0 && (
                                            <span className="text-slate-500"> ({ch.tasks.join(", ")})</span>
                                          )}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {isConfirmed && n.confirmedAt && (
                              <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                Confirmed {new Date(n.confirmedAt).toLocaleString()}
                              </p>
                            )}
                          </div>

                          {!isConfirmed && (
                            <Button
                              size="sm"
                              className="shrink-0 h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white"
                              onClick={() => confirmMutation.mutate(n.id)}
                              disabled={confirmMutation.isPending}
                              data-testid={`button-confirm-${n.id}`}
                            >
                              {confirmMutation.isPending ? (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3 mr-1" />
                              )}
                              Confirm
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        )}
      </AdminQueryState>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
    </AdminPageShell>
  );
}

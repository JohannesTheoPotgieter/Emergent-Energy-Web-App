import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check, FileSpreadsheet, Loader2, Clock, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, Filter,
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

const PAGE_SIZE = 20;

export default function ExcelUpdatesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"pending" | "confirmed" | "all">("pending");
  const [projectFilter, setProjectFilter] = useState("");
  const [page, setPage] = useState(0);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("eventType", "excel_sync_confirmation");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (projectFilter) params.set("search", projectFilter);
    return params.toString();
  }, [page, projectFilter]);

  const { data: notifsData, isLoading } = useQuery({
    queryKey: ["excel-updates", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?${queryParams}`, { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });

  const planParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("eventType", "plan.change_confirmation");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (projectFilter) params.set("search", projectFilter);
    return params.toString();
  }, [page, projectFilter]);

  const { data: planNotifsData } = useQuery({
    queryKey: ["plan-change-updates", planParams],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?${planParams}`, { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });

  const allItems = useMemo(() => {
    const excel = (notifsData?.items ?? []).map((n: any) => ({ ...n, source: "excel_sync" }));
    const plan = (planNotifsData?.items ?? []).map((n: any) => ({ ...n, source: "plan_change" }));
    const combined = [...excel, ...plan];
    combined.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return combined;
  }, [notifsData, planNotifsData]);

  const filtered = useMemo(() => {
    if (tab === "pending") return allItems.filter((n: any) => !n.confirmedAt);
    if (tab === "confirmed") return allItems.filter((n: any) => !!n.confirmedAt);
    return allItems;
  }, [allItems, tab]);

  const pendingCount = allItems.filter((n: any) => !n.confirmedAt).length;
  const confirmedCount = allItems.filter((n: any) => !!n.confirmedAt).length;

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
      qc.invalidateQueries({ queryKey: ["excel-updates"] });
      qc.invalidateQueries({ queryKey: ["plan-change-updates"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Confirmed", description: "Marked as saved in Excel tracker" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not confirm", variant: "destructive" });
    },
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4" data-testid="excel-updates-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white" data-testid="text-page-title">
              Excel Updates
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Track changes that need to be captured in Excel trackers
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

      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setPage(0); }}>
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
              All ({allItems.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative flex-1 max-w-xs">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Filter by project..."
            value={projectFilter}
            onChange={(e) => { setProjectFilter(e.target.value); setPage(0); }}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400"
            data-testid="input-project-filter"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16" data-testid="loading-state">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <Card data-testid="empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            {tab === "pending" ? (
              <>
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
                <p className="text-lg font-medium text-slate-700 dark:text-slate-200">All caught up!</p>
                <p className="text-sm text-slate-500">No pending Excel updates to confirm.</p>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-12 h-12 text-slate-300 mb-3" />
                <p className="text-lg font-medium text-slate-700 dark:text-slate-200">No updates found</p>
                <p className="text-sm text-slate-500">No Excel sync notifications match your filters.</p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n: any) => {
            const details = parseChangeDetails(n.changeDetails);
            const isConfirmed = !!n.confirmedAt;
            const projectDisplay = (n.projectName || details?.projectName || "Unknown")
              .replace(/_Tracker$/i, "").replace(/_/g, " ");

            return (
              <Card
                key={n.id}
                className={`transition-colors ${isConfirmed ? "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800" : "bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-800/50"}`}
                data-testid={`card-update-${n.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={isConfirmed
                            ? "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/30"
                            : "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-900/30"
                          }
                          data-testid={`badge-status-${n.id}`}
                        >
                          {isConfirmed ? (
                            <><CheckCircle2 className="w-3 h-3 mr-1" /> Confirmed</>
                          ) : (
                            <><Clock className="w-3 h-3 mr-1" /> Pending</>
                          )}
                        </Badge>
                        <span className="text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
                        {n.source === "plan_change" && (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-900/30">
                            Plan Change
                          </Badge>
                        )}
                      </div>

                      <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 mb-0.5" data-testid={`text-project-${n.id}`}>
                        {projectDisplay}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-300" data-testid={`text-body-${n.id}`}>
                        {n.body || n.title}
                      </p>

                      {details && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          {details.changedBy && (
                            <span>Changed by: <strong className="text-slate-700 dark:text-slate-300">{details.changedBy}</strong></span>
                          )}
                          {details.changeType && (
                            <span>Type: <strong className="text-slate-700 dark:text-slate-300">{details.changeType.replace(/_/g, " ")}</strong></span>
                          )}
                          {details.details && Object.keys(details.details).length > 0 && (
                            <div className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-100 dark:border-slate-700">
                              {Object.entries(details.details).map(([k, v]) => (
                                <div key={k} className="flex gap-2">
                                  <span className="text-slate-400 min-w-[80px]">{k}:</span>
                                  <span className="text-slate-700 dark:text-slate-300">{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {isConfirmed && n.confirmedAt && (
                        <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Confirmed {new Date(n.confirmedAt).toLocaleString()}
                        </p>
                      )}
                    </div>

                    {!isConfirmed && (
                      <Button
                        size="sm"
                        className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white"
                        onClick={() => confirmMutation.mutate(n.id)}
                        disabled={confirmMutation.isPending}
                        data-testid={`button-confirm-${n.id}`}
                      >
                        {confirmMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5 mr-1" />
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
      )}

      {allItems.length > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-500">
            Page {page + 1}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

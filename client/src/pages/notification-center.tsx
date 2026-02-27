import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell, Check, CheckCheck, FileSpreadsheet, Loader2, Search,
  Filter, ChevronLeft, ChevronRight, BellOff, Inbox, Clock,
  AlertTriangle, Zap, ClipboardCheck, ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

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

const EVENT_TYPE_LABELS: Record<string, { label: string; icon: typeof Bell; color: string }> = {
  "plan.change_confirmation": { label: "Plan Change", icon: FileSpreadsheet, color: "text-amber-600 bg-amber-50" },
  "task.assigned": { label: "Task Assigned", icon: ClipboardCheck, color: "text-blue-600 bg-blue-50" },
  "task.status_changed": { label: "Status Update", icon: ArrowRight, color: "text-indigo-600 bg-indigo-50" },
  "task.approaching_deadline": { label: "Deadline Approaching", icon: Clock, color: "text-orange-600 bg-orange-50" },
  "deliverable.submitted_for_approval": { label: "Needs Approval", icon: AlertTriangle, color: "text-purple-600 bg-purple-50" },
  "deliverable.qc_approved": { label: "QC Approved", icon: Check, color: "text-green-600 bg-green-50" },
  "deliverable.feedback_requested": { label: "Feedback Requested", icon: Zap, color: "text-rose-600 bg-rose-50" },
  "deliverable.sent_for_acknowledgment": { label: "Deliverable Received", icon: Inbox, color: "text-orange-600 bg-orange-50" },
  "deliverable.acknowledged": { label: "Deliverable Acknowledged", icon: Check, color: "text-emerald-600 bg-emerald-50" },
  "milestone.approaching": { label: "Milestone Approaching", icon: Clock, color: "text-orange-600 bg-orange-50" },
  "milestone.commissioning_soon": { label: "Commissioning Soon", icon: Zap, color: "text-amber-600 bg-amber-50" },
  "project.phase_changed": { label: "Phase Changed", icon: ArrowRight, color: "text-teal-600 bg-teal-50" },
  "project.behind_schedule": { label: "Behind Schedule", icon: AlertTriangle, color: "text-red-600 bg-red-50" },
};

function getEventTypeInfo(eventType: string) {
  return EVENT_TYPE_LABELS[eventType] || { label: eventType, icon: Bell, color: "text-gray-600 bg-gray-50" };
}

const PAGE_SIZE = 30;

export default function NotificationCenterPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<"all" | "unread" | "read" | "action_required">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  const searchTimeout = useMemo(() => {
    let timer: ReturnType<typeof setTimeout>;
    return (val: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => { setDebouncedSearch(val); setPage(0); }, 300);
    };
  }, []);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filterStatus === "unread") params.set("unreadOnly", "true");
    if (filterType) params.set("eventType", filterType);
    if (debouncedSearch) params.set("search", debouncedSearch);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    return params.toString();
  }, [filterStatus, filterType, debouncedSearch, page]);

  const { data: notifsData, isLoading } = useQuery({
    queryKey: ["notifications-center", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?${queryParams}`, { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });

  const notifs = notifsData?.items ?? [];
  const total = notifsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: eventTypes = [] } = useQuery<string[]>({
    queryKey: ["notification-event-types"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/event-types", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
  });

  const { data: countData } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/unread-count", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });
  const unreadCount = countData?.count || 0;

  const markReadMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notificationIds: ids }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-center"] });
      qc.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-center"] });
      qc.invalidateQueries({ queryKey: ["notifications-list"] });
      toast({ title: "Done", description: "All notifications marked as read." });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (notifId: number) => {
      const res = await fetch(`/api/notifications/${notifId}/confirm`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to confirm");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-center"] });
      qc.invalidateQueries({ queryKey: ["notifications-list"] });
      toast({ title: "Confirmed", description: `Tracker update confirmed by ${data.confirmedBy}.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const actionRequired = notifs.filter((n: any) => n.requiresConfirmation && !n.confirmedAt);

  const filteredNotifs = useMemo(() => {
    if (filterStatus === "action_required") return notifs.filter((n: any) => n.requiresConfirmation && !n.confirmedAt);
    if (filterStatus === "read") return notifs.filter((n: any) => n.isRead);
    return notifs;
  }, [notifs, filterStatus]);

  function formatRelativeTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50" data-testid="text-notification-center-title">Notification Center</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {unreadCount > 0 ? <span className="text-primary font-medium">{unreadCount} unread</span> : "All caught up"} · {total} total
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read-center"
            >
              <CheckCheck className="w-4 h-4 mr-1.5" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="notification-filters">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search notifications..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); searchTimeout(e.target.value); }}
            data-testid="input-notification-search"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 p-0.5">
          {(["all", "unread", "action_required", "read"] as const).map(status => (
            <button
              key={status}
              onClick={() => { setFilterStatus(status); setPage(0); }}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${filterStatus === status ? 'bg-primary text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              data-testid={`filter-status-${status}`}
            >
              {status === "all" ? "All" : status === "unread" ? "Unread" : status === "action_required" ? "Action Required" : "Read"}
            </button>
          ))}
        </div>
        <select
          className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
          value={filterType}
          onChange={e => { setFilterType(e.target.value); setPage(0); }}
          data-testid="select-notification-type"
        >
          <option value="">All Types</option>
          {eventTypes.map(et => (
            <option key={et} value={et}>{getEventTypeInfo(et).label}</option>
          ))}
        </select>
      </div>

      {actionRequired.length > 0 && filterStatus !== "action_required" && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800" data-testid="card-action-required-banner">
          <CardContent className="py-3 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {actionRequired.length} notification{actionRequired.length !== 1 ? 's' : ''} requiring your action
              </span>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs border-amber-300" onClick={() => setFilterStatus("action_required")} data-testid="button-show-action-required">
              Show
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm" data-testid="card-notifications-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filteredNotifs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400" data-testid="text-no-notifications-center">
              <Inbox className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm font-medium">No notifications found</p>
              <p className="text-xs mt-1">
                {filterStatus !== "all" || filterType || debouncedSearch ? "Try adjusting your filters" : "You're all caught up!"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredNotifs.map((n: any) => {
                const details = parseChangeDetails(n.changeDetails);
                const isConfirmation = n.requiresConfirmation;
                const isConfirmed = !!n.confirmedAt;
                const isExpanded = expandedId === n.id;
                const etInfo = getEventTypeInfo(n.eventType);
                const EtIcon = etInfo.icon;

                return (
                  <div
                    key={n.id}
                    className={`p-4 cursor-pointer transition-colors ${
                      !n.isRead ? "bg-primary/[0.03] dark:bg-primary/[0.06]" : ""
                    } ${isConfirmation && !isConfirmed ? "bg-amber-50/60 dark:bg-amber-950/20" : ""} hover:bg-gray-50 dark:hover:bg-gray-800/40`}
                    onClick={() => {
                      if (!n.isRead && !isConfirmation) markReadMutation.mutate([n.id]);
                      if (isConfirmation) setExpandedId(isExpanded ? null : n.id);
                    }}
                    data-testid={`notification-center-item-${n.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${etInfo.color}`}>
                        <EtIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className={`text-sm font-medium truncate ${!n.isRead ? "text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400"}`}>
                            {n.title}
                          </p>
                          {!n.isRead && <div className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                        </div>
                        {n.body && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${etInfo.color} border-none`}>
                            {etInfo.label}
                          </Badge>
                          {n.projectName && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                              {n.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ")}
                            </Badge>
                          )}
                          <span className="text-[10px] text-gray-400">{formatRelativeTime(n.createdAt)}</span>
                        </div>

                        {isConfirmation && isExpanded && details && (
                          <div className="mt-3 p-2.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 text-[11px] space-y-1">
                            <p className="font-medium text-slate-600 dark:text-slate-300">Change Details:</p>
                            <p><span className="text-slate-400">Project:</span> {details.projectName}</p>
                            <p><span className="text-slate-400">Changed by:</span> {details.changedBy}</p>
                            <p><span className="text-slate-400">Time:</span> {new Date(details.timestamp).toLocaleString()}</p>
                            {details.changes?.map((c: any, i: number) => (
                              <div key={i} className="pl-2 border-l-2 border-slate-200 dark:border-slate-700 mt-1">
                                {c.field && <p><span className="text-slate-400">Field:</span> {c.field}</p>}
                                {c.newValue && <p><span className="text-slate-400">New value:</span> {c.newValue}</p>}
                                {c.operation && <p><span className="text-slate-400">Operation:</span> {c.operation}</p>}
                                {c.tasks?.length > 0 && <p><span className="text-slate-400">Tasks:</span> {c.tasks.join(", ")}</p>}
                              </div>
                            ))}
                          </div>
                        )}

                        {isConfirmation && (
                          <div className="mt-2">
                            {isConfirmed ? (
                              <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
                                <Check className="w-3.5 h-3.5" />
                                Confirmed in tracker
                                {n.confirmedAt && <span className="text-slate-400 font-normal">({new Date(n.confirmedAt).toLocaleString()})</span>}
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                className="h-7 text-xs mt-0.5 bg-amber-500 hover:bg-amber-600 text-white"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  confirmMutation.mutate(n.id);
                                }}
                                disabled={confirmMutation.isPending}
                                data-testid={`button-confirm-center-${n.id}`}
                              >
                                {confirmMutation.isPending ? (
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3 mr-1" />
                                )}
                                Confirm saved in Excel tracker
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1" data-testid="notification-pagination">
          <span className="text-xs text-gray-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
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
  );
}

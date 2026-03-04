import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, FileSpreadsheet, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: countData } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/unread-count", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: notifsData } = useQuery({
    queryKey: ["notifications-list"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?unreadOnly=false&limit=50", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    enabled: open,
    refetchOnMount: "always" as const,
  });
  const notifs = notifsData?.items ?? (Array.isArray(notifsData) ? notifsData : []);

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
      qc.invalidateQueries({ queryKey: ["notifications-list"] });
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
      qc.invalidateQueries({ queryKey: ["notifications-list"] });
      toast({ title: "Confirmed", description: `Tracker update confirmed by ${data.confirmedBy}.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const count = countData?.count || 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications-bell">
          <Bell className="w-5 h-5" />
          {count > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 text-xs bg-red-600 hover:bg-red-600" data-testid="badge-notification-count">
              {count > 99 ? "99+" : count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] max-w-[90vw] p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {count > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => markAllReadMutation.mutate()} data-testid="button-mark-all-read">
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[420px]">
          {notifs.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-notifications">
              No notifications
            </div>
          ) : (
            <div className="divide-y">
              {notifs.map((n: any) => {
                const details = parseChangeDetails(n.changeDetails);
                const isConfirmation = n.requiresConfirmation;
                const isConfirmed = !!n.confirmedAt;
                const isExpanded = expandedId === n.id;

                return (
                  <div
                    key={n.id}
                    className={`p-3 text-sm cursor-pointer transition-colors ${
                      !n.isRead ? "bg-primary/5 border-l-2 border-l-primary" : ""
                    } ${isConfirmation && !isConfirmed ? "bg-amber-50/60 border-l-2 border-l-amber-400" : ""}`}
                    onClick={() => {
                      if (!n.isRead && !isConfirmation) markReadMutation.mutate([n.id]);
                      if (isConfirmation) setExpandedId(isExpanded ? null : n.id);
                    }}
                    data-testid={`notification-item-${n.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {isConfirmation && <FileSpreadsheet className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                          <p className={`text-xs font-medium truncate ${!n.isRead ? "text-primary" : ""}`}>{n.title}</p>
                        </div>
                        {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">{n.body}</p>}

                        {isConfirmation && isExpanded && details && (
                          <div className="mt-2 p-2 bg-muted rounded border border-border text-[11px] space-y-1">
                            <p className="font-medium text-muted-foreground">Change Details:</p>
                            <p><span className="text-muted-foreground">Project:</span> {details.projectName}</p>
                            <p><span className="text-muted-foreground">Changed by:</span> {details.changedBy}</p>
                            <p><span className="text-muted-foreground">Time:</span> {new Date(details.timestamp).toLocaleString()}</p>
                            {details.changes?.map((c: any, i: number) => (
                              <div key={i} className="pl-2 border-l-2 border-border mt-1">
                                {c.field && <p><span className="text-muted-foreground">Field:</span> {c.field}</p>}
                                {c.newValue && <p><span className="text-muted-foreground">New value:</span> {c.newValue}</p>}
                                {c.operation && <p><span className="text-muted-foreground">Operation:</span> {c.operation}</p>}
                                {c.tasks?.length > 0 && <p><span className="text-muted-foreground">Tasks:</span> {c.tasks.join(", ")}</p>}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-1.5">
                          {n.projectName && <Badge variant="outline" className="text-[10px] h-4 px-1">{n.projectName}</Badge>}
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(n.createdAt).toLocaleDateString()} {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {isConfirmation && (
                          <div className="mt-2">
                            {isConfirmed ? (
                              <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
                                <Check className="w-3.5 h-3.5" />
                                Confirmed in tracker
                                {n.confirmedAt && <span className="text-slate-500 font-normal">({new Date(n.confirmedAt).toLocaleString()})</span>}
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
                                data-testid={`button-confirm-tracker-${n.id}`}
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
                      {!n.isRead && !isConfirmation && (
                        <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Link href="/notifications" onClick={() => setOpen(false)}>
            <Button variant="ghost" size="sm" className="w-full text-xs h-8 text-primary" data-testid="link-view-all-notifications">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              View all notifications
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

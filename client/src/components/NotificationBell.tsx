import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: countData } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/unread-count", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: notifs = [] } = useQuery({
    queryKey: ["notifications-list"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?unreadOnly=false", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    enabled: open,
    refetchOnMount: "always" as const,
  });

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
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {count > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => markAllReadMutation.mutate()} data-testid="button-mark-all-read">
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifs.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-notifications">
              No notifications
            </div>
          ) : (
            <div className="divide-y">
              {notifs.map((n: any) => (
                <div
                  key={n.id}
                  className={`p-3 text-sm hover:bg-muted/50 cursor-pointer ${!n.isRead ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  onClick={() => { if (!n.isRead) markReadMutation.mutate([n.id]); }}
                  data-testid={`notification-item-${n.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${!n.isRead ? "text-primary" : ""}`}>{n.title}</p>
                      {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        {n.projectName && <Badge variant="outline" className="text-[10px] h-4 px-1">{n.projectName}</Badge>}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(n.createdAt).toLocaleDateString()} {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    {!n.isRead && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { engFetch, engPost } from "@/lib/eng-fetch";
import { cn } from "@/lib/utils";

interface Notification {
  id: number;
  eventType: string;
  title: string;
  body: string | null;
  projectName: string | null;
  linkedTaskId: number | null;
  linkedDeliverableId: number | null;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["notifications-unread-count"],
    queryFn: () => engFetch("/api/notifications/unread-count"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: listData } = useQuery<{ notifications: Notification[] }>({
    queryKey: ["notifications-list"],
    queryFn: () => engFetch("/api/notifications?limit=20"),
    enabled: open,
    staleTime: 5_000,
  });

  const unread = countData?.count ?? 0;
  const items = listData?.notifications ?? [];

  const markRead = useCallback(async (id: number) => {
    await engPost("/api/notifications/mark-read", { notificationId: id });
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    qc.invalidateQueries({ queryKey: ["notifications-list"] });
  }, [qc]);

  const markAllRead = useCallback(async () => {
    await engPost("/api/notifications/mark-all-read", {});
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    qc.invalidateQueries({ queryKey: ["notifications-list"] });
  }, [qc]);

  const handleClick = useCallback((n: Notification) => {
    if (!n.isRead) markRead(n.id);
    setOpen(false);
    if (n.eventType?.startsWith("standup.")) {
      setLocation("/standups");
    } else if (n.linkedTaskId) {
      setLocation(`/engineering/tasks?taskId=${n.linkedTaskId}`);
    } else if (n.linkedDeliverableId) {
      setLocation(`/engineering/tasks?deliverableId=${n.linkedDeliverableId}`);
    }
  }, [markRead, setLocation]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" data-testid="notification-bell">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[9px] bg-red-500 text-white border-0 flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 max-h-[420px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button onClick={markAllRead} className="text-[10px] text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <div className="overflow-y-auto flex-1">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications yet</div>
          ) : (
            items.map(n => (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "px-3 py-2.5 border-b last:border-b-0 cursor-pointer hover:bg-muted/50 transition-colors",
                  !n.isRead && "bg-primary/5"
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{n.title}</div>
                    {n.body && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>}
                    <div className="text-[9px] text-muted-foreground/70 mt-1">{timeAgo(n.createdAt)}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

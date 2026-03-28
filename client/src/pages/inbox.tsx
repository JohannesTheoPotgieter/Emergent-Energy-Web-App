import { useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { engFetch, engPost } from "@/lib/eng-fetch";
import { cn } from "@/lib/utils";
import {
  Inbox as InboxIcon,
  Bell,
  CheckCircle2,
  Circle,
  ChevronRight,
  Check,
  Filter,
} from "lucide-react";

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
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getEventCategory(eventType: string): string {
  if (eventType.startsWith("standup.")) return "standups";
  if (eventType.startsWith("task.") || eventType.includes("assignment")) return "tasks";
  if (eventType.startsWith("approval.") || eventType.includes("review")) return "approvals";
  if (eventType.startsWith("engineering.") || eventType.includes("deliverable")) return "engineering";
  if (eventType.startsWith("quality.")) return "quality";
  return "other";
}

export default function InboxPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: listData, isLoading } = useQuery<{ notifications: Notification[] }>({
    queryKey: ["notifications-list-full"],
    queryFn: () => engFetch("/api/notifications?limit=100"),
    staleTime: 5_000,
  });

  const items = listData?.notifications ?? [];

  const filteredItems = useMemo(() => {
    if (filter === "unread") return items.filter((n) => !n.isRead);
    return items;
  }, [items, filter]);

  const unreadCount = items.filter((n) => !n.isRead).length;

  const grouped = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const groups: Record<string, Notification[]> = {
      Today: [],
      Yesterday: [],
      "This Week": [],
      Earlier: [],
    };

    for (const n of filteredItems) {
      const d = new Date(n.createdAt);
      if (d >= today) groups.Today.push(n);
      else if (d >= yesterday) groups.Yesterday.push(n);
      else if (d >= weekAgo) groups["This Week"].push(n);
      else groups.Earlier.push(n);
    }

    return groups;
  }, [filteredItems]);

  const markRead = useCallback(async (id: number) => {
    await engPost("/api/notifications/mark-read", { notificationId: id });
    qc.invalidateQueries({ queryKey: ["notifications-list-full"] });
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
  }, [qc]);

  const markAllRead = useCallback(async () => {
    await engPost("/api/notifications/mark-all-read", {});
    qc.invalidateQueries({ queryKey: ["notifications-list-full"] });
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    qc.invalidateQueries({ queryKey: ["notifications-list"] });
  }, [qc]);

  const handleClick = useCallback((n: Notification) => {
    if (!n.isRead) markRead(n.id);
    if (n.eventType?.startsWith("standup.")) {
      navigate("/standups");
    } else if (n.linkedTaskId) {
      navigate(`/engineering/tasks?taskId=${n.linkedTaskId}`);
    } else if (n.linkedDeliverableId) {
      navigate(`/engineering/tasks?deliverableId=${n.linkedDeliverableId}`);
    }
  }, [markRead, navigate]);

  return (
    <PageShell data-testid="inbox-page">
      <SectionHeader
        icon={<InboxIcon className="h-5 w-5" />}
        title="Inbox"
        description="All your notifications, assignments, and updates in one place"
        actions={
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllRead} data-testid="btn-mark-all-read">
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Mark all read
              </Button>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-5">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | "unread")}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs px-3 h-6" data-testid="filter-all">
              All {items.length > 0 && `(${items.length})`}
            </TabsTrigger>
            <TabsTrigger value="unread" className="text-xs px-3 h-6" data-testid="filter-unread">
              Unread {unreadCount > 0 && `(${unreadCount})`}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-12 text-center">
            <InboxIcon className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([label, notifications]) =>
            notifications.length > 0 ? (
              <div key={label}>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                  {label}
                </h3>
                <Card className="border-border/50 divide-y divide-border/40">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors group",
                        !n.isRead && "bg-primary/[0.03]"
                      )}
                      data-testid={`notification-${n.id}`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {n.isRead ? (
                          <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />
                        ) : (
                          <span className="block w-2.5 h-2.5 rounded-full bg-primary mt-0.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className={cn("text-sm truncate", !n.isRead && "font-medium")}>{n.title}</p>
                          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                            {getEventCategory(n.eventType)}
                          </Badge>
                        </div>
                        {n.body && (
                          <p className="text-xs text-muted-foreground line-clamp-1">{n.body}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                          <span>{timeAgo(n.createdAt)}</span>
                          {n.projectName && (
                            <>
                              <span>·</span>
                              <span>{n.projectName}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-muted-foreground/50 shrink-0 mt-1 transition-colors" />
                    </div>
                  ))}
                </Card>
              </div>
            ) : null
          )}
        </div>
      )}
    </PageShell>
  );
}

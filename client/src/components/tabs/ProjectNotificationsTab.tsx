import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell, Check, CheckCheck, Loader2, Clock, Inbox,
  AlertTriangle, Zap, ClipboardCheck, ArrowRight,
  FileSpreadsheet, Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

const EVENT_ICONS: Record<string, { icon: typeof Bell; color: string }> = {
  "plan.change_confirmation": { icon: FileSpreadsheet, color: "text-amber-600 bg-amber-50" },
  "task.assigned": { icon: ClipboardCheck, color: "text-blue-600 bg-blue-50" },
  "task.status_changed": { icon: ArrowRight, color: "text-indigo-600 bg-indigo-50" },
  "task.approaching_deadline": { icon: Clock, color: "text-orange-600 bg-orange-50" },
  "deliverable.submitted_for_approval": { icon: AlertTriangle, color: "text-purple-600 bg-purple-50" },
  "deliverable.qc_approved": { icon: Check, color: "text-green-600 bg-green-50" },
  "deliverable.feedback_requested": { icon: Zap, color: "text-rose-600 bg-rose-50" },
  "milestone.approaching": { icon: Clock, color: "text-orange-600 bg-orange-50" },
  "project.phase_changed": { icon: ArrowRight, color: "text-teal-600 bg-teal-50" },
  "project.behind_schedule": { icon: AlertTriangle, color: "text-red-600 bg-red-50" },
  "financial.plan_task_impact": { icon: AlertTriangle, color: "text-amber-600 bg-amber-50" },
  "financial.edit_approved": { icon: Check, color: "text-emerald-600 bg-emerald-50" },
  "financial.edit_rejected": { icon: AlertTriangle, color: "text-red-600 bg-red-50" },
};

function getEventIcon(eventType: string) {
  return EVENT_ICONS[eventType] || { icon: Bell, color: "text-muted-foreground bg-muted" };
}

export function ProjectNotificationsTab({ projectName }: { projectName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showRead, setShowRead] = useState(false);

  const { data, isLoading } = useQuery<{ notifications: any[]; unreadCount: number }>({
    queryKey: ["project-notifications", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/notifications?search=${encodeURIComponent(projectName)}&limit=100`);
      if (!res.ok) return { notifications: [], unreadCount: 0 };
      const data = await res.json();
      const items = data.items || data.notifications || data || [];
      return {
        notifications: items,
        unreadCount: items.filter((n: any) => !n.isRead && !n.is_read).length,
      };
    },
    enabled: !!projectName,
    refetchInterval: 30000,
  });

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await engFetch(`/api/notifications/mark-read`, {
        method: "POST",
        body: JSON.stringify({ notificationIds: [id] }),
      });
      if (!res.ok) throw new Error("Failed to mark as read");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.isRead && !n.is_read);
      if (unread.length === 0) return;
      const res = await engFetch(`/api/notifications/mark-read`, {
        method: "POST",
        body: JSON.stringify({ notificationIds: unread.map(n => n.id) }),
      });
      if (!res.ok) throw new Error("Failed to mark all as read");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "All notifications marked as read" });
      queryClient.invalidateQueries({ queryKey: ["project-notifications"] });
    },
  });

  const displayed = showRead ? notifications : notifications.filter(n => !n.isRead && !n.is_read);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="project-notifications-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Project Notifications</span>
        {unreadCount > 0 && (
          <Badge variant="destructive" className="text-xs" data-testid="badge-unread-count">{unreadCount} unread</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setShowRead(!showRead)}
            data-testid="button-toggle-read"
          >
            {showRead ? "Hide read" : "Show all"}
          </Button>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={markAllReadMutation.isPending}
              onClick={() => markAllReadMutation.mutate()}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {displayed.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {showRead ? "No notifications for this project" : "No unread notifications"}
            </p>
          </CardContent>
        </Card>
      )}

      <ScrollArea className="max-h-[600px]">
        <div className="space-y-1.5">
          {displayed.map((n: any) => {
            const isRead = n.isRead || n.is_read;
            const eventType = n.eventType || n.event_type || "";
            const { icon: Icon, color } = getEventIcon(eventType);
            const createdAt = n.createdAt || n.created_at;

            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  isRead ? "bg-background opacity-60" : "bg-blue-50/50 border-blue-100 hover:bg-blue-50"
                }`}
                onClick={() => !isRead && markReadMutation.mutate(n.id)}
                data-testid={`notification-${n.id}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${isRead ? "" : "font-medium"}`}>{n.title || n.message || "Notification"}</p>
                  {n.body && n.body !== n.title && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {createdAt ? new Date(createdAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                    {eventType && ` · ${eventType.replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}`}
                  </p>
                </div>
                {!isRead && (
                  <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

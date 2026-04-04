/**
 * HomeDashboardV2 — Wave 1 Step 4
 *
 * Cross-role attention cockpit for the Home department.
 * Reads from GET /api/home/summary.
 * Shows: my tasks, pending approvals, alerts, recent activity.
 *
 * Shown when department_shell feature flag is on.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  AlertCircle, AlertTriangle, CheckCircle, Clock, Info, ListTodo, ShieldCheck,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface HomeSummary {
  myTasks: {
    overdue: number;
    dueToday: number;
    inProgress: number;
    total: number;
  };
  myApprovals: {
    pending: number;
    urgent: number;
  };
  alerts: Array<{
    type: string;
    message: string;
    severity: "info" | "warning" | "error";
  }>;
  recentActivity: Array<{
    type: string;
    message: string;
    status: string;
    timestamp: string;
  }>;
}

const SEVERITY_STYLES = {
  info: { icon: Info, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  error: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50 border-red-200" },
};

export function HomeDashboardV2() {
  const { data, isLoading, isError } = useQuery<HomeSummary>({
    queryKey: ["home-summary"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/home/summary");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <Skeleton className="h-6 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return null;
  }

  return (
    <div className="space-y-4 mb-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Tasks Card */}
        <Link href="/my-work/tasks">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <ListTodo className="h-4 w-4" />
                  My Tasks
                </span>
                {data.myTasks.overdue > 0 && (
                  <Badge variant="destructive" className="text-xs">{data.myTasks.overdue} overdue</Badge>
                )}
              </div>
              <div className="text-2xl font-bold">{data.myTasks.total}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.myTasks.inProgress} in progress
                {data.myTasks.dueToday > 0 && ` · ${data.myTasks.dueToday} due today`}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Approvals Card */}
        <Link href="/my-work/approvals">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" />
                  Pending Approvals
                </span>
                {data.myApprovals.urgent > 0 && (
                  <Badge variant="destructive" className="text-xs">{data.myApprovals.urgent} urgent</Badge>
                )}
              </div>
              <div className="text-2xl font-bold">{data.myApprovals.pending}</div>
              <div className="text-xs text-muted-foreground mt-1">
                awaiting your decision
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Due Today Card */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Due Today</span>
            </div>
            <div className="text-2xl font-bold">{data.myTasks.dueToday}</div>
            <div className="text-xs text-muted-foreground mt-1">
              tasks need attention
            </div>
          </CardContent>
        </Card>

        {/* Health Card */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">In Progress</span>
            </div>
            <div className="text-2xl font-bold">{data.myTasks.inProgress}</div>
            <div className="text-xs text-muted-foreground mt-1">
              active work items
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, i) => {
            const style = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
            const Icon = style.icon;
            return (
              <div key={i} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", style.bg)}>
                <Icon className={cn("h-4 w-4 shrink-0", style.color)} />
                {alert.message}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

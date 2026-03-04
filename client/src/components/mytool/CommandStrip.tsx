import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Zap,
  AlertTriangle,
  Clock,
  Shield,
  ChevronRight,
} from "lucide-react";

interface SidebarTask {
  id: number;
  title: string;
  nextStep: string | null;
  priority: string;
  status: string;
  dueAt: string | null;
  projectName: string | null;
  blockedReason: string | null;
  pinnedToday: boolean;
}

const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const dotColor: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-slate-400",
};

function CommandStrip({ onTaskClick }: { onTaskClick?: (taskId: number) => void }) {
  const { data: allTasks = [] } = useQuery<SidebarTask[]>({
    queryKey: ["/api/mytool/tasks"],
    select: (data: any[]) => data.map((t: any) => ({
      id: t.id,
      title: t.title,
      nextStep: t.nextStep || t.next_step || null,
      priority: t.priority,
      status: t.status,
      dueAt: t.dueAt || t.due_at || null,
      projectName: t.projectName || t.project_name || null,
      blockedReason: t.blockedReason || t.blocked_reason || null,
      pinnedToday: t.pinnedToday || t.pinned_today || false,
    })),
    staleTime: 30_000,
  });

  const nextActions = allTasks
    .filter(t => t.status !== "done" && t.status !== "cancelled" && t.nextStep?.trim())
    .sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2))
    .slice(0, 5);

  const blocked = allTasks.filter(t => t.status === "blocked");
  const overdue = allTasks.filter(t => {
    if (t.status === "done" || t.status === "cancelled" || !t.dueAt) return false;
    return new Date(t.dueAt) < new Date(new Date().toDateString());
  });

  const approvals = allTasks.filter(t => t.status === "waiting");

  const hasContent = nextActions.length > 0 || blocked.length > 0 || overdue.length > 0 || approvals.length > 0;
  if (!hasContent) return null;

  return (
    <div
      className="flex items-stretch gap-2 px-4 py-2 bg-muted/30 border-b border-border/40 overflow-x-auto"
      data-testid="coo-command-strip"
    >
      {nextActions.length > 0 && (
        <div className="flex items-center gap-2 pr-3 border-r border-border/40 shrink-0">
          <div className="flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Next</span>
          </div>
          <div className="flex items-center gap-1.5">
            {nextActions.map(t => (
              <button
                key={t.id}
                onClick={() => onTaskClick?.(t.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-background border border-border/50 hover:border-border hover:shadow-sm transition-all text-[11px] max-w-[180px] truncate"
                title={`${t.title}\n→ ${t.nextStep}`}
                data-testid={`strip-next-${t.id}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[t.priority] || "bg-blue-500"}`} />
                <span className="truncate">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="flex items-center gap-2 pr-3 border-r border-border/40 shrink-0">
          <div className="flex items-center gap-1">
            <Shield className="h-3.5 w-3.5 text-indigo-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Waiting</span>
            <Badge variant="secondary" className="text-[9px] h-4 px-1">{approvals.length}</Badge>
          </div>
          <div className="flex items-center gap-1">
            {approvals.slice(0, 3).map(t => (
              <button
                key={t.id}
                onClick={() => onTaskClick?.(t.id)}
                className="px-2 py-1 rounded-md bg-indigo-50 border border-indigo-200/50/30 text-[11px] text-indigo-700 truncate max-w-[160px] hover:shadow-sm transition-all"
                data-testid={`strip-waiting-${t.id}`}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="flex items-center gap-2 pr-3 border-r border-border/40 shrink-0">
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-red-600">Blocked</span>
            <Badge variant="destructive" className="text-[9px] h-4 px-1">{blocked.length}</Badge>
          </div>
          <div className="flex items-center gap-1">
            {blocked.slice(0, 3).map(t => (
              <button
                key={t.id}
                onClick={() => onTaskClick?.(t.id)}
                className="px-2 py-1 rounded-md bg-red-50 border border-red-200/50/30 text-[11px] text-red-700 truncate max-w-[160px] hover:shadow-sm transition-all"
                data-testid={`strip-blocked-${t.id}`}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-red-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-red-600">Overdue</span>
            <Badge variant="destructive" className="text-[9px] h-4 px-1">{overdue.length}</Badge>
          </div>
          <div className="flex items-center gap-1">
            {overdue.slice(0, 3).map(t => (
              <button
                key={t.id}
                onClick={() => onTaskClick?.(t.id)}
                className="px-2 py-1 rounded-md bg-red-50 border border-red-200/50/30 text-[11px] text-red-700 truncate max-w-[160px] hover:shadow-sm transition-all"
                data-testid={`strip-overdue-${t.id}`}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(CommandStrip);

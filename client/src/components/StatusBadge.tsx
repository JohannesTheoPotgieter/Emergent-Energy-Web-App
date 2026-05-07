import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProjectStatusLabels, RagStatusLabels, TaskStatusLabels } from "@shared/constants/statuses";

type StatusType = "project" | "task" | "rag";

const styles: Record<StatusType, Record<string, string>> = {
  project: {
    active: "bg-emerald-100 text-emerald-700 border-emerald-200",
    on_hold: "bg-amber-100 text-amber-700 border-amber-200",
    completed: "bg-blue-100 text-blue-700 border-blue-200",
    cancelled: "bg-slate-100 text-slate-700 border-slate-200",
  },
  task: {
    todo: "bg-slate-100 text-slate-700 border-slate-200",
    in_progress: "bg-amber-100 text-amber-700 border-amber-200",
    blocked: "bg-red-100 text-red-700 border-red-200",
    done: "bg-emerald-100 text-emerald-700 border-emerald-200",
    cancelled: "bg-slate-100 text-slate-700 border-slate-200",
  },
  rag: {
    red: "bg-red-100 text-red-700 border-red-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    green: "bg-emerald-100 text-emerald-700 border-emerald-200",
    unknown: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

const labels: Record<StatusType, Record<string, string>> = {
  project: ProjectStatusLabels,
  task: TaskStatusLabels,
  rag: RagStatusLabels,
};

export function StatusBadge({ status, type, className }: { status: string | null | undefined; type: StatusType; className?: string }) {
  const normalized = String(status || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return (
    <Badge variant="outline" className={cn(styles[type][normalized] || "bg-muted text-foreground", className)}>
      {labels[type][normalized] || status || "Unknown"}
    </Badge>
  );
}

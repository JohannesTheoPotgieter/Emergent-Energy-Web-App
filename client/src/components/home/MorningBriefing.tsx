import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Target,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  buildMyWorkPreviewItems,
  selectHomeExceptionPreview,
  type HomeWorkPreviewItem,
  type HomePreviewReason,
  type ExceptionResponse,
} from "@/lib/home-launchpad";

const token = () => localStorage.getItem("auth_token") || "";

const REASON_STYLES: Record<HomePreviewReason, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "bg-red-100 text-red-700 border-red-200" },
  blocked: { label: "Blocked", className: "bg-amber-100 text-amber-700 border-amber-200" },
  dueSoon: { label: "Due Soon", className: "bg-blue-100 text-blue-700 border-blue-200" },
  approval: { label: "Approval", className: "bg-violet-100 text-violet-700 border-violet-200" },
  next: { label: "Next", className: "bg-slate-100 text-slate-700 border-slate-200" },
};

function WorkItem({ item }: { item: HomeWorkPreviewItem }) {
  const style = REASON_STYLES[item.reason];
  return (
    <Link href={item.href}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-muted/60 group cursor-pointer min-h-[44px]">
        <Badge
          variant="outline"
          className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${style.className}`}
        >
          {style.label}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {[item.sourceLabel, item.projectName].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    </Link>
  );
}

function ExceptionSummary({ total, bySeverity }: { total: number; bySeverity: Record<string, number> }) {
  if (total === 0) return null;

  const parts: { label: string; count: number; className: string }[] = [];
  if (bySeverity.critical) parts.push({ label: "critical", count: bySeverity.critical, className: "text-red-700" });
  if (bySeverity.high) parts.push({ label: "high", count: bySeverity.high, className: "text-amber-700" });
  if (bySeverity.medium) parts.push({ label: "medium", count: bySeverity.medium, className: "text-yellow-700" });
  if (bySeverity.low) parts.push({ label: "low", count: bySeverity.low, className: "text-slate-600" });

  return (
    <div className="border-t border-border/50 mt-1 pt-3 px-3">
      <Link href="/exceptions">
        <div className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer group">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            <span className="font-medium text-foreground">{total}</span> exception{total !== 1 ? "s" : ""} need attention
          </span>
          {parts.length > 0 && (
            <span className="text-xs">
              ({parts.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && " · "}
                  <span className={p.className}>{p.count} {p.label}</span>
                </span>
              ))})
            </span>
          )}
          <ArrowRight className="w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>
      </Link>
    </div>
  );
}

export function MorningBriefing() {
  const { data: allTaskData, isLoading: tasksLoading } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", {
        headers: { Authorization: `Bearer ${token()}` },
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: exceptionData, isLoading: exceptionsLoading } = useQuery<ExceptionResponse>({
    queryKey: ["/api/exceptions", "home-preview"],
    queryFn: async () => {
      const res = await fetch("/api/exceptions", {
        headers: { Authorization: `Bearer ${token()}` },
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const workItems = useMemo(() => buildMyWorkPreviewItems(allTaskData, 5), [allTaskData]);
  const exceptionPreview = useMemo(() => selectHomeExceptionPreview(exceptionData, 3), [exceptionData]);

  const isLoading = tasksLoading || exceptionsLoading;
  const hasItems = workItems.length > 0;
  const hasExceptions = exceptionPreview.summary.total > 0;

  return (
    <Card className="border-border/60 mb-6" data-testid="card-morning-briefing">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Your Focus</h2>
          </div>
          <Link href="/my-work">
            <span className="text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer">
              View all
            </span>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !hasItems && !hasExceptions ? (
          <div className="flex items-center gap-3 py-6 justify-center text-muted-foreground">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <p className="text-sm">You're clear — no urgent items right now.</p>
          </div>
        ) : (
          <>
            {hasItems && (
              <div className="space-y-0.5">
                {workItems.map((item) => (
                  <WorkItem key={item.itemKey} item={item} />
                ))}
              </div>
            )}
            <ExceptionSummary
              total={exceptionPreview.summary.total}
              bySeverity={exceptionPreview.summary.bySeverity}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

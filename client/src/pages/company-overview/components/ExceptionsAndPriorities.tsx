import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  AlertTriangle,
  Flame,
  ArrowRight,
  Clock,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface ExceptionItem {
  title: string;
  severity: "critical" | "high" | "medium";
  department: string;
  project: string | null;
  owner: string | null;
  age: number;
  dueDate: string | null;
  status: string;
}

interface PriorityItem {
  id: number;
  title: string;
  department: string | null;
  owner: string | null;
  dueDate: string | null;
  status: string;
  severity: string | null;
  health: string | null;
  progress: number | null;
}

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-amber-100 text-amber-700 border-amber-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
};

const HEALTH_DOT: Record<string, string> = {
  critical: "bg-red-500",
  at_risk: "bg-amber-500",
  healthy: "bg-emerald-500",
};

export function ExceptionsAndPriorities({
  exceptions,
  priorities,
  isLoading,
}: {
  exceptions: ExceptionItem[] | null;
  priorities: PriorityItem[] | null;
  isLoading: boolean;
}) {
  // Task #139: consume the canonical admin gate from useAuth so this
  // component honours both user.role and the company_role storage fallback,
  // keeping a single source of truth (ADMIN_ROLES in shared/schema/users.ts).
  const { isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-5">
              <Skeleton className="h-5 w-40 mb-4" />
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-10 w-full mb-2" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Top Risks / Exceptions */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-semibold text-foreground">Top Risks / Exceptions</h3>
              {exceptions && exceptions.length > 0 && (
                <Badge variant="destructive" className="text-[10px]">{exceptions.length}</Badge>
              )}
            </div>
            <Link href="/gates/exceptions">
              <span className="text-xs text-primary hover:underline font-medium cursor-pointer flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>

          {!exceptions || exceptions.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No critical exceptions</p>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {exceptions.map((ex, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors">
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 mt-0.5 shrink-0 ${SEV_BADGE[ex.severity]}`}>
                    {ex.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{ex.title}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                      <span>{ex.department}</span>
                      {ex.project && <span>· {ex.project}</span>}
                      {ex.owner && <span>· {ex.owner}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                    <Clock className="w-3 h-3" />
                    <span>{ex.age}d</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Company Priorities */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Company Priorities</h3>
              {priorities && priorities.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">{priorities.length}</Badge>
              )}
            </div>
            <Link href="/priorities">
              <span className="text-xs text-primary hover:underline font-medium cursor-pointer flex items-center gap-1">
                {isAdmin ? "Manage" : "View all"} <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>

          {!priorities || priorities.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {isAdmin ? "No active priorities. Add priorities to track." : "No active priorities."}
            </p>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {priorities.map((p) => {
                const healthDot = HEALTH_DOT[p.health || "healthy"] || HEALTH_DOT.healthy;
                const isOverdue = p.dueDate && p.dueDate < new Date().toISOString().slice(0, 10);
                const daysRemaining = p.dueDate
                  ? Math.ceil((new Date(p.dueDate).getTime() - Date.now()) / 86400000)
                  : null;

                return (
                  <Link key={p.id} href={`/priorities/${p.id}`}>
                    <div className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
                      <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${healthDot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{p.title}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          {p.department && <span>{p.department}</span>}
                          {p.owner && <span>· {p.owner}</span>}
                          {p.severity === "critical" && (
                            <Badge variant="destructive" className="text-[9px] px-1 py-0">Critical</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        {p.progress != null && (
                          <span className="text-[10px] font-mono text-muted-foreground">{p.progress}%</span>
                        )}
                        {daysRemaining != null && (
                          <span className={`text-[10px] ${isOverdue ? "text-red-600 font-medium" : daysRemaining <= 7 ? "text-amber-600" : "text-muted-foreground"}`}>
                            {isOverdue ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useMemo } from "react";
import { AlertTriangle, ArrowUpRight, Building2, Flag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { departmentLabel, DEPARTMENT_OPTIONS } from "@shared/config/priorities";
import type { PriorityRow } from "@/lib/priority-types";

interface DepartmentDashboardProps {
  priorities: PriorityRow[];
  onSelectDepartment: (key: string) => void;
}

interface DeptSummary {
  key: string;
  label: string;
  total: number;
  critical: number;
  atRisk: number;
  escalated: number;
  blocked: number;
  stale: number;
  escalationRate: number;
  topStale: PriorityRow | null;
  topBlocked: PriorityRow | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function staleness(priority: PriorityRow): number {
  const ref = priority.lastReviewedAt || priority.updatedAt || null;
  return daysSince(ref) ?? 0;
}

export function DepartmentDashboard({ priorities, onSelectDepartment }: DepartmentDashboardProps) {
  const summaries = useMemo<DeptSummary[]>(() => {
    const buckets = new Map<string, PriorityRow[]>();
    for (const p of priorities) {
      const key = p.departmentKey || "_unassigned";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(p);
    }
    const out: DeptSummary[] = [];
    for (const [key, list] of buckets) {
      const critical = list.filter((p) => p.effectiveHealth === "critical").length;
      const atRisk = list.filter((p) => p.effectiveHealth === "at_risk").length;
      const escalated = list.filter((p) => p.escalated).length;
      const blocked = list.filter((p) => p.blockerCount > 0).length;
      const stale = list.filter((p) => staleness(p) > 30).length;
      const topStale = [...list].sort((a, b) => staleness(b) - staleness(a))[0] || null;
      const topBlocked = [...list].sort((a, b) => (b.blockerCount || 0) - (a.blockerCount || 0))[0] || null;
      out.push({
        key,
        label: key === "_unassigned" ? "Unassigned" : departmentLabel(key),
        total: list.length,
        critical,
        atRisk,
        escalated,
        blocked,
        stale,
        escalationRate: list.length === 0 ? 0 : Math.round((escalated / list.length) * 100),
        topStale,
        topBlocked: topBlocked && (topBlocked.blockerCount || 0) > 0 ? topBlocked : null,
      });
    }
    out.sort((a, b) => {
      if (b.critical !== a.critical) return b.critical - a.critical;
      if (b.escalated !== a.escalated) return b.escalated - a.escalated;
      return b.total - a.total;
    });
    return out;
  }, [priorities]);

  if (summaries.length === 0) return null;

  return (
    <div className="mb-4" data-testid="department-dashboard">
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Department dashboard
        </h3>
        <span className="text-xs text-muted-foreground">
          {summaries.length} {summaries.length === 1 ? "department" : "departments"}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {summaries.map((s) => {
          const healthTone =
            s.critical > 0 ? "border-red-200" :
              s.atRisk > 0 ? "border-amber-200" :
                "border-emerald-200";
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelectDepartment(s.key === "_unassigned" ? "" : s.key)}
              className="text-left"
              data-testid={`dept-summary-${s.key}`}
            >
              <Card className={`${healthTone} hover:shadow-md transition-shadow cursor-pointer`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground truncate">{s.label}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Open</div>
                      <div className="font-semibold text-foreground tabular-nums">{s.total}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-red-600 uppercase" title="Health = Off track">Off track</div>
                      <div className={`font-semibold tabular-nums ${s.critical > 0 ? "text-red-600" : "text-muted-foreground"}`}>{s.critical}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-orange-600 uppercase">Escalated</div>
                      <div className={`font-semibold tabular-nums ${s.escalated > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
                        {s.escalated} <span className="text-[10px] text-muted-foreground">({s.escalationRate}%)</span>
                      </div>
                    </div>
                  </div>
                  {(s.topBlocked || s.topStale) && (
                    <div className="space-y-1 pt-1 border-t">
                      {s.topBlocked && (
                        <div className="flex items-center gap-1 text-[11px]">
                          <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                          <span className="text-muted-foreground">Top blocked:</span>
                          <span className="truncate font-medium">{s.topBlocked.title}</span>
                          <span className="text-red-600 ml-auto shrink-0">
                            {s.topBlocked.blockerCount}
                          </span>
                        </div>
                      )}
                      {s.topStale && staleness(s.topStale) > 14 && (
                        <div className="flex items-center gap-1 text-[11px]">
                          <Flag className="w-3 h-3 text-amber-500 shrink-0" />
                          <span className="text-muted-foreground">Most stale:</span>
                          <span className="truncate font-medium">{s.topStale.title}</span>
                          <span className="text-amber-600 ml-auto shrink-0">
                            {staleness(s.topStale)}d
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        Click a card to filter the list below to that department.
      </p>
    </div>
  );
}

// Type guard so the page can show the dashboard only when there is at
// least one priority across at least one department. Exported in case
// other consumers want to surface the same insight in a different shell.
export function hasAnyDepartmentPriorities(priorities: PriorityRow[]): boolean {
  return priorities.some((p) => (p.departmentKey || "_unassigned") in DEPARTMENT_OPTIONS || true);
}

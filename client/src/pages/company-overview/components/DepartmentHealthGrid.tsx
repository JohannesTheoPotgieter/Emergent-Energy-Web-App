import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Briefcase,
  FolderOpen,
  Wrench,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  Info,
} from "lucide-react";
import type { Department, RagStatus, DepartmentScore, KpiScore } from "@shared/config/kpi-registry";

const HIDDEN_KPI_KEYS = new Set([
  "pd_signed_pipeline_vs_target",
  "fin_revenue_vs_target",
  "fin_cash_collected_vs_target",
  "fin_cos_vs_target",
  "fin_gross_margin_vs_target",
  "hse_site_audit_pass_rate",
  "hse_toolbox_compliance",
  "hse_safety_file_completeness",
]);

const DEPT_ICONS: Record<Department, React.ReactNode> = {
  "Project Development": <Briefcase className="w-4 h-4" />,
  "Project Delivery": <FolderOpen className="w-4 h-4" />,
  "Engineering": <Wrench className="w-4 h-4" />,
  "HSE": <ShieldCheck className="w-4 h-4" />,
  "Quality": <CheckCircle2 className="w-4 h-4" />,
  "Finance": <DollarSign className="w-4 h-4" />,
};

const DEPT_LINKS: Record<Department, string> = {
  "Project Development": "/pd",
  "Project Delivery": "/gates",
  "Engineering": "/engineering",
  "HSE": "/hse",
  "Quality": "/quality",
  "Finance": "/cashflow",
};

const RAG_COLORS: Record<RagStatus, { bg: string; text: string; border: string; dot: string }> = {
  green: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
  red: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
  // "grey" = no data / unknown. Per T1.x audit Surprise 1 a department
  // with no data should not render as red.
  grey: { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200", dot: "bg-slate-400" },
};

function KpiChip({ kpi }: { kpi: KpiScore }) {
  if (kpi.score == null) {
    return (
      <span className="text-[10px] text-muted-foreground/60 truncate" title={`${kpi.kpiName}: no data`}>
        {kpi.kpiName}: —
      </span>
    );
  }
  const color = kpi.score >= 85 ? "text-emerald-600" : kpi.score >= 70 ? "text-amber-600" : "text-red-600";
  return (
    <span className={`text-[10px] truncate ${color}`}>
      <span title={`${kpi.kpiName}: ${Math.round(kpi.score)}/100`}>
        {kpi.kpiName.replace(/ \(.*\)/, "").slice(0, 22)}
      </span>
      <span className="text-muted-foreground"> · </span>
      {Math.round(kpi.score)}
    </span>
  );
}

export function DepartmentHealthGrid({
  scores,
  isLoading,
}: {
  scores: DepartmentScore[] | null;
  isLoading: boolean;
}) {
  if (isLoading || !scores) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-32 mb-3" />
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {scores.map((ds) => {
        const rag = RAG_COLORS[ds.rag];
        const visibleKpis = ds.kpis.filter((k) => !HIDDEN_KPI_KEYS.has(k.kpiKey));
        const topKpis = visibleKpis.slice(0, 3);
        const worstKpi = [...visibleKpis]
          .filter((k) => k.score != null)
          .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))[0];

        return (
          <Link key={ds.department} href={DEPT_LINKS[ds.department]}>
            <Card className={`border-border/50 hover:shadow-sm transition-all cursor-pointer ${ds.rag === "red" ? "border-l-4 border-l-red-500" : ds.rag === "amber" ? "border-l-4 border-l-amber-400" : ds.rag === "grey" ? "border-l-4 border-l-slate-300" : "border-l-4 border-l-emerald-500"}`}>
              <CardContent className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{DEPT_ICONS[ds.department]}</span>
                    <span className="text-sm font-semibold text-foreground">{ds.department}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {ds.provisional && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-300 text-amber-600">
                        Provisional
                      </Badge>
                    )}
                    <span className={`w-2.5 h-2.5 rounded-full ${rag.dot}`} />
                  </div>
                </div>

                {/* Score */}
                <div className="flex items-baseline gap-1.5 mb-3">
                  <span className={`text-xl font-bold font-mono ${rag.text}`}>
                    {ds.score ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">/100</span>
                </div>

                {/* Top 3 KPI chips */}
                <div className="space-y-0.5 mb-2">
                  {topKpis.map((kpi) => (
                    <KpiChip key={kpi.kpiKey} kpi={kpi} />
                  ))}
                  {topKpis.length === 0 && (
                    <span className="text-[10px] text-muted-foreground">No trusted KPI models visible</span>
                  )}
                </div>

                {/* Worst blocker */}
                {worstKpi && worstKpi.score != null && worstKpi.score < 70 && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/30">
                    <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                    <span className="text-[10px] text-red-600 truncate">
                      {worstKpi.kpiName}: {Math.round(worstKpi.score)}/100
                    </span>
                  </div>
                )}

                {/* No data state */}
                {!ds.dataAvailable && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/30">
                    <Info className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-[10px] text-muted-foreground">
                      Data coverage in progress
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

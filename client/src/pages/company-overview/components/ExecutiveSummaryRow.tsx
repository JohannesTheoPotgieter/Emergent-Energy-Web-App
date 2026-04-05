import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Activity,
  TrendingUp,
  FolderOpen,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import type { RagStatus } from "@shared/config/kpi-registry";

interface ExecutiveSummaryData {
  companyHealthScore: number | null;
  companyHealthRag: RagStatus;
  revenueVsTarget: {
    actual: number;
    target: number;
    pct: number;
    grossMarginPct: number;
  };
  portfolioHealth: {
    total: number;
    onTrack: number;
    atRisk: number;
    offTrack: number;
    pct: number;
  };
  attentionNeeded: {
    blockedGates: number;
    overdueItems: number;
    missingUpdates: number;
    redDepartmentKpis: number;
    total: number;
  };
}

const RAG_COLORS: Record<RagStatus, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const RAG_TEXT: Record<RagStatus, string> = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-red-700",
};

const money = (n: number) =>
  `R ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function ExecutiveSummaryRow({
  data,
  isLoading,
}: {
  data: ExecutiveSummaryData | null;
  isLoading: boolean;
}) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Company Health Score */}
      <Link href="/execution-board">
        <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <Activity className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Company Health</span>
              <span className={`w-2 h-2 rounded-full ml-auto ${RAG_COLORS[data.companyHealthRag]}`} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold font-mono ${RAG_TEXT[data.companyHealthRag]}`}>
                {data.companyHealthScore ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Weighted department score
            </p>
          </CardContent>
        </Card>
      </Link>

      {/* Revenue / Margin vs Target */}
      <Link href="/cashflow">
        <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Revenue / Margin</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-foreground">
                {money(data.revenueVsTarget.actual)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[11px] text-muted-foreground">
                {data.revenueVsTarget.pct}% of target
              </span>
              <Badge variant="secondary" className="text-[10px]">
                GM (FYTD) {data.revenueVsTarget.grossMarginPct}%
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Link>

      {/* Portfolio Delivery Health */}
      <Link href="/gates">
        <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <FolderOpen className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Portfolio Health</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-foreground">
                {data.portfolioHealth.pct}%
              </span>
              <span className="text-xs text-muted-foreground">on track</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[11px] text-emerald-600">{data.portfolioHealth.onTrack}G</span>
              <span className="text-[11px] text-amber-600">{data.portfolioHealth.atRisk}A</span>
              <span className="text-[11px] text-red-600">{data.portfolioHealth.offTrack}R</span>
              <span className="text-[11px] text-muted-foreground ml-auto">{data.portfolioHealth.total} projects</span>
            </div>
          </CardContent>
        </Card>
      </Link>

      {/* Attention Needed */}
      <Link href="/gates/exceptions">
        <Card className={`border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group ${data.attentionNeeded.total > 0 ? "border-l-4 border-l-red-500" : ""}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Attention Needed</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold font-mono ${data.attentionNeeded.total > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {data.attentionNeeded.total}
              </span>
              <span className="text-xs text-muted-foreground">items</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
              {data.attentionNeeded.blockedGates > 0 && <span>{data.attentionNeeded.blockedGates} blocked</span>}
              {data.attentionNeeded.overdueItems > 0 && <span>{data.attentionNeeded.overdueItems} overdue</span>}
              {data.attentionNeeded.missingUpdates > 0 && <span>{data.attentionNeeded.missingUpdates} no update</span>}
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

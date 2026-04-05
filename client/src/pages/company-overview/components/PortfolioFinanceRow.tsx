import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  FolderOpen,
  DollarSign,
  AlertTriangle,
  Calendar,
  ArrowRight,
  Ban,
  Milestone,
  CheckCircle2,
} from "lucide-react";

interface PortfolioSnapshot {
  activeProjects: number;
  onTrack: number;
  atRisk: number;
  offTrack: number;
  blockedGates: number;
  upcomingMilestones: number;
  practicalCompletionDue: number;
  handoversDue: number;
}

interface FinanceSnapshot {
  revenueFytd: number;
  revenueTarget: number;
  cosFytd: number;
  cosTarget: number;
  grossMarginPct: number;
  collectionRate: number;
  overdueDebtors: number;
  overdueDebtorCount: number;
}

const money = (n: number) =>
  `R ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function StatLine({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className={`text-sm font-semibold font-mono ${color || "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

export function PortfolioFinanceRow({
  portfolio,
  finance,
  isLoading,
}: {
  portfolio: PortfolioSnapshot | null;
  finance: FinanceSnapshot | null;
  isLoading: boolean;
}) {
  if (isLoading || !portfolio || !finance) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-5">
              <Skeleton className="h-5 w-40 mb-4" />
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full mb-2" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const revPct = finance.revenueTarget > 0
    ? Math.round((finance.revenueFytd / finance.revenueTarget) * 100)
    : 0;
  const cosPct = finance.cosTarget > 0
    ? Math.round((finance.cosFytd / finance.cosTarget) * 100)
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Portfolio Delivery Snapshot */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Portfolio Delivery</h3>
            </div>
            <Link href="/gates">
              <span className="text-xs text-primary hover:underline font-medium cursor-pointer flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="divide-y divide-border/30">
            <StatLine icon={<FolderOpen className="w-3.5 h-3.5" />} label="Active Projects" value={portfolio.activeProjects} />
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">Status</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">{portfolio.onTrack} On Track</Badge>
                <Badge variant="secondary" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{portfolio.atRisk} At Risk</Badge>
                <Badge variant="secondary" className="text-[10px] bg-red-50 text-red-700 border-red-200">{portfolio.offTrack} Off Track</Badge>
              </div>
            </div>
            <StatLine
              icon={<Ban className="w-3.5 h-3.5" />}
              label="Blocked Gates"
              value={portfolio.blockedGates}
              color={portfolio.blockedGates > 0 ? "text-red-600" : undefined}
            />
            <StatLine icon={<Milestone className="w-3.5 h-3.5" />} label="Upcoming Milestones (14d)" value={portfolio.upcomingMilestones} />
            <StatLine icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Practical Completion Due (month)" value={portfolio.practicalCompletionDue} />
            <StatLine icon={<Calendar className="w-3.5 h-3.5" />} label="Handovers Due (month)" value={portfolio.handoversDue} />
          </div>
        </CardContent>
      </Card>

      {/* Financial Snapshot */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Financial Snapshot</h3>
              <Badge variant="secondary" className="text-[10px]">FYTD</Badge>
            </div>
            <Link href="/cashflow">
              <span className="text-xs text-primary hover:underline font-medium cursor-pointer flex items-center gap-1">
                Detail <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="divide-y divide-border/30">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">Revenue FYTD</span>
              <div className="text-right">
                <span className="text-sm font-semibold font-mono text-foreground">{money(finance.revenueFytd)}</span>
                <span className="text-[10px] text-muted-foreground ml-1.5">/ {money(finance.revenueTarget)}</span>
                <Badge variant="secondary" className={`text-[10px] ml-1.5 ${revPct >= 80 ? "bg-emerald-50 text-emerald-700" : revPct >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                  {revPct}%
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">COS FYTD</span>
              <div className="text-right">
                <span className="text-sm font-semibold font-mono text-foreground">{money(finance.cosFytd)}</span>
                <span className="text-[10px] text-muted-foreground ml-1.5">/ {money(finance.cosTarget)}</span>
              </div>
            </div>
            <StatLine
              icon={<span />}
              label="Gross Margin % (FYTD)"
              value={`${finance.grossMarginPct}%`}
              color={finance.grossMarginPct >= 15 ? "text-emerald-600" : finance.grossMarginPct >= 10 ? "text-amber-600" : "text-red-600"}
            />
            <StatLine icon={<span />} label="Collection Rate" value={`${finance.collectionRate}%`} />
            <StatLine
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              label="Overdue Debtors"
              value={money(finance.overdueDebtors)}
              color={finance.overdueDebtors > 0 ? "text-red-600" : undefined}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

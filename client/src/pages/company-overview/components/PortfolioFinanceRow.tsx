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

interface PhaseEntry {
  code: string;
  label: string;
  count: number;
}

interface ScheduleHealth {
  avgActualPct: number | null;
  avgExpectedPct: number | null;
  scheduleDelta: number | null;
  trackedItems: number;
}

interface PortfolioSnapshot {
  activeProjects: number;
  onTrack: number;
  atRisk: number;
  offTrack: number;
  blockedGates: number;
  upcomingMilestones: number;
  practicalCompletionDue: number;
  handoversDue: number;
  phaseDistribution?: PhaseEntry[];
  scheduleHealth?: ScheduleHealth;
}

interface FinanceSnapshot {
  cashReceivedFytd?: number;
  cashPaidFytd?: number;
  realisedRevenueFytd?: number;
  realisedCostFytd?: number;
  realisedGrossMarginPct?: number;
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
            {portfolio.scheduleHealth && portfolio.scheduleHealth.trackedItems > 0 && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-muted-foreground">Schedule Health</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {portfolio.scheduleHealth.avgActualPct}% actual
                  </span>
                  <span className="text-xs text-muted-foreground">vs</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {portfolio.scheduleHealth.avgExpectedPct}% expected
                  </span>
                  {portfolio.scheduleHealth.scheduleDelta != null && (
                    <Badge
                      variant="secondary"
                      className={`text-[10px] ${
                        portfolio.scheduleHealth.scheduleDelta >= 0
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200"
                      }`}
                    >
                      {portfolio.scheduleHealth.scheduleDelta >= 0 ? "+" : ""}{portfolio.scheduleHealth.scheduleDelta}%
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
          {portfolio.phaseDistribution && portfolio.phaseDistribution.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Projects by Phase</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {portfolio.phaseDistribution.map((p) => (
                  <Badge key={p.code} variant="outline" className="text-[10px] px-1.5 py-0.5 font-normal">
                    {p.label} <span className="font-semibold ml-1">{p.count}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Financial Snapshot */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Financial Snapshot</h3>
            </div>
            <Link href="/cashflow">
              <span className="text-xs text-primary hover:underline font-medium cursor-pointer flex items-center gap-1">
                Detail <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="divide-y divide-border/30">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">Revenue Realised FYTD</span>
              <div className="text-right">
                <span className="text-sm font-semibold font-mono text-foreground">{money(finance.realisedRevenueFytd ?? finance.revenueFytd)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">COS Realised FYTD</span>
              <div className="text-right">
                <span className="text-sm font-semibold font-mono text-foreground">{money(finance.realisedCostFytd ?? finance.cosFytd)}</span>
              </div>
            </div>
            <StatLine
              icon={<span />}
              label="Gross Margin %"
              value={`${finance.realisedGrossMarginPct ?? finance.grossMarginPct}%`}
            />
            <StatLine icon={<span />} label="Cash Collection Rate" value={`${finance.collectionRate}%`} />
            <StatLine icon={<span />} label="Cash Received FYTD" value={money(finance.cashReceivedFytd ?? finance.revenueFytd)} />
            <StatLine icon={<span />} label="Cash Paid FYTD" value={money(finance.cashPaidFytd ?? finance.cosFytd)} />
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

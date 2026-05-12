/**
 * B5: Budget baseline vs actual comparison strip.
 * Shows the latest locked baseline alongside current actuals.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Lock, TrendingDown, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface BudgetBaseline {
  id: number;
  version: number;
  revenueBaseline: string | null;
  cosBaseline: string | null;
  marginBaseline: string | null;
  changeLocked: boolean;
  approvedDate: string | null;
}

interface Props {
  projectId: number;
  actualRevenue?: number;
  actualCos?: number;
}

function money(v: number | null | undefined): string {
  if (!v || !Number.isFinite(v)) return "—";
  return `R ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function delta(actual: number, baseline: number): { pct: string; color: string; icon: typeof TrendingUp } {
  if (!baseline) return { pct: "—", color: "text-muted-foreground", icon: TrendingUp };
  const diff = ((actual - baseline) / baseline) * 100;
  if (diff > 5) return { pct: `+${diff.toFixed(1)}%`, color: "text-red-600", icon: TrendingUp };
  if (diff < -5) return { pct: `${diff.toFixed(1)}%`, color: "text-amber-600", icon: TrendingDown };
  return { pct: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`, color: "text-emerald-600", icon: TrendingUp };
}

export function BudgetBaselineStrip({ projectId, actualRevenue, actualCos }: Props) {
  const { data: baselines = [] } = useQuery<BudgetBaseline[]>({
    queryKey: ["budget-baselines", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/budget-baselines?projectId=${projectId}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const locked = baselines.find(b => b.changeLocked);
  if (!locked) return null;

  const revBaseline = locked.revenueBaseline ? Number(locked.revenueBaseline) : 0;
  const cosBaseline = locked.cosBaseline ? Number(locked.cosBaseline) : 0;
  const marginBaseline = locked.marginBaseline ? Number(locked.marginBaseline) : 0;

  const revDelta = actualRevenue ? delta(actualRevenue, revBaseline) : null;
  const cosDelta = actualCos ? delta(actualCos, cosBaseline) : null;

  return (
    <div className="rounded-lg border bg-card p-3" data-testid="budget-baseline-strip">
      <div className="flex items-center gap-2 mb-2">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Baseline v{locked.version}
        </span>
        <Badge variant="default" className="text-[9px] h-4 bg-green-100 text-green-700">Locked</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-xs">
        <div>
          <span className="text-muted-foreground">Revenue Baseline</span>
          <div className="font-medium mt-0.5">{money(revBaseline)}</div>
          {revDelta && (
            <span className={`text-[10px] ${revDelta.color}`}>{revDelta.pct} vs actual</span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">COS Baseline</span>
          <div className="font-medium mt-0.5">{money(cosBaseline)}</div>
          {cosDelta && (
            <span className={`text-[10px] ${cosDelta.color}`}>{cosDelta.pct} vs actual</span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Margin Baseline</span>
          <div className="font-medium mt-0.5">{money(marginBaseline)}</div>
        </div>
      </div>
    </div>
  );
}

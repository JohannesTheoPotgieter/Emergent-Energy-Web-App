import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface SummaryCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ElementType;
  className?: string;
}

export function SummaryCard({ title, value, subValue, trend, trendValue, icon: Icon, className }: SummaryCardProps) {
  return (
    <Card className={cn("overflow-hidden border-border/50", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
        <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/60" />}
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold font-mono tracking-tight text-foreground">{value}</div>
        {(subValue || trend) && (
          <div className="flex items-center gap-2 mt-1.5">
            {trend && (
              <span className={cn(
                "flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded",
                trend === "up" && "bg-emerald-50 text-emerald-700",
                trend === "down" && "bg-rose-50 text-rose-700",
                trend === "neutral" && "bg-muted text-muted-foreground"
              )}>
                {trend === "up" && <ArrowUpRight className="w-3 h-3 mr-0.5" />}
                {trend === "down" && <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                {trend === "neutral" && <Minus className="w-3 h-3 mr-0.5" />}
                {trendValue}
              </span>
            )}
            {subValue && (
              <p className="text-xs text-muted-foreground">
                {subValue}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
    <Card className={cn("overflow-hidden border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tracking-tight text-foreground">{value}</div>
        {(subValue || trend) && (
          <div className="flex items-center gap-2 mt-1">
            {trend && (
              <span className={cn(
                "flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full",
                trend === "up" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                trend === "down" && "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
                trend === "neutral" && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
              )}>
                {trend === "up" && <ArrowUpRight className="w-3 h-3 mr-1" />}
                {trend === "down" && <ArrowDownRight className="w-3 h-3 mr-1" />}
                {trend === "neutral" && <Minus className="w-3 h-3 mr-1" />}
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

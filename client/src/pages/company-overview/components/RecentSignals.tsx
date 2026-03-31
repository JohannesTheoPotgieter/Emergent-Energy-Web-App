import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Ban,
  Clock,
  AlertTriangle,
  MessageSquare,
} from "lucide-react";

interface Signal {
  type: string;
  title: string;
  project: string | null;
  date: string;
  department: string | null;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  blocked_gate: <Ban className="w-3.5 h-3.5 text-red-500" />,
  overdue_action: <Clock className="w-3.5 h-3.5 text-amber-500" />,
  missing_update: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
  microsoft: <MessageSquare className="w-3.5 h-3.5 text-blue-500" />,
};

const TYPE_LABELS: Record<string, string> = {
  blocked_gate: "Blocked",
  overdue_action: "Overdue",
  missing_update: "No Update",
  microsoft: "Signal",
};

function formatRelativeDate(dateStr: string): string {
  const diff = Math.ceil((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 7) return `${diff}d ago`;
  return dateStr;
}

export function RecentSignals({
  signals,
  isLoading,
}: {
  signals: Signal[] | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-5">
          <Skeleton className="h-5 w-40 mb-4" />
          {Array.from({ length: 4 }).map((_, j) => (
            <Skeleton key={j} className="h-8 w-full mb-2" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Recent Changes / Signals</h3>
          <Badge variant="secondary" className="text-[10px]">7 days</Badge>
        </div>

        {!signals || signals.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No significant signals this week</p>
        ) : (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {signals.map((sig, i) => (
              <div key={i} className="flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/30">
                <span className="mt-0.5 shrink-0">{TYPE_ICONS[sig.type] || <Activity className="w-3.5 h-3.5 text-muted-foreground" />}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate">{sig.title}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    {sig.project && <span>{sig.project}</span>}
                    {sig.department && <span>· {sig.department}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                    {TYPE_LABELS[sig.type] || sig.type}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{formatRelativeDate(sig.date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

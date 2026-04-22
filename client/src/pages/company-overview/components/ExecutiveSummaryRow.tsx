import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  FolderOpen,
  AlertTriangle,
  Ban,
  CalendarClock,
} from "lucide-react";

interface TrustedTopStripData {
  activeProjects: number;
  blockedGates: number;
  overdueItems: number;
  missingUpdates: number;
}

export function ExecutiveSummaryRow({
  data,
  isLoading,
}: {
  data: TrustedTopStripData | null;
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
      <Link href="/gates">
        <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <FolderOpen className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Active Projects</span>
            </div>
            <span className="text-2xl font-bold font-mono text-foreground">{data.activeProjects}</span>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Project delivery workspace
            </p>
          </CardContent>
        </Card>
      </Link>

      <Link href="/gates/blocked">
        <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <Ban className="w-4 h-4 text-red-500" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Blocked Gates</span>
            </div>
            <span className={`text-2xl font-bold font-mono ${data.blockedGates > 0 ? "text-red-600" : "text-emerald-600"}`}>{data.blockedGates}</span>
            <p className="text-[11px] text-muted-foreground mt-1.5">Gate blockers requiring escalation</p>
          </CardContent>
        </Card>
      </Link>

      <Link href="/gates/exceptions">
        <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Overdue Items</span>
            </div>
            <span className={`text-2xl font-bold font-mono ${data.overdueItems > 0 ? "text-red-600" : "text-emerald-600"}`}>{data.overdueItems}</span>
            <p className="text-[11px] text-muted-foreground mt-1.5">Tasks past due date</p>
          </CardContent>
        </Card>
      </Link>

      <Link href="/gates/client-updates">
        <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
              <CalendarClock className="w-4 h-4 text-amber-500" />
              <span className="text-[11px] uppercase tracking-wide font-medium">Missing Weekly Updates</span>
            </div>
            <span className={`text-2xl font-bold font-mono ${data.missingUpdates > 0 ? "text-amber-600" : "text-emerald-600"}`}>{data.missingUpdates}</span>
            <p className="text-[11px] text-muted-foreground mt-1.5">No client update in 7+ days</p>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

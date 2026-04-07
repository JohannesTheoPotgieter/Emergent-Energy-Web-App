import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Clock3, XCircle } from "lucide-react";

export type ImportHealthResponse = {
  lastImportTime: string;
  lastImportStatus: "success" | "partial" | "failed";
  errorCount: number;
  pendingValidations: number;
  importHistory: Array<{ timestamp: string; status: "success" | "partial" | "failed"; recordsProcessed: number; errors: number }>;
};

function relativeTime(ts?: string) {
  if (!ts) return "Unknown";
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffHours = Math.floor(diffMs / 36e5);
  if (diffHours < 1) return "Less than an hour ago";
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function ImportHealthWidget({ data }: { data?: ImportHealthResponse }) {
  const isStale = data?.lastImportTime ? Date.now() - new Date(data.lastImportTime).getTime() > 24 * 60 * 60 * 1000 : false;
  const status = data?.lastImportStatus ?? "failed";
  const statusTone = status === "success" ? "bg-green-100 text-green-700" : status === "partial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";

  return (
    <Card className={`border-border shadow-sm ${isStale ? "border-amber-300" : ""}`}>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-blue-500" />
              Import Health
            </h3>
            <p className="text-sm text-muted-foreground">Last run {relativeTime(data?.lastImportTime)}</p>
          </div>
          <Badge className={statusTone}>{status}</Badge>
        </div>

        {isStale && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <AlertTriangle className="h-4 w-4" />
            Last import is older than 24 hours.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link href="/smart-import?tab=errors">
            <Button variant="outline" className="w-full justify-between" role="link" aria-label="Open import errors">
              <span className="flex items-center gap-2 text-sm"><XCircle className="h-4 w-4 text-red-500" />Errors</span>
              <span className="font-semibold">{data?.errorCount ?? 0}</span>
            </Button>
          </Link>
          <Link href="/smart-import?tab=validation">
            <Button variant="outline" className="w-full justify-between" role="link" aria-label="Open pending validations">
              <span className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-amber-500" />Pending validations</span>
              <span className="font-semibold">{data?.pendingValidations ?? 0}</span>
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

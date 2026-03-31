import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, DollarSign, Loader2 } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
    return headers;
}

async function loadQueue() {
  const res = await fetch("/api/financial-reviews/pending", {
    headers: getAuthHeaders(),
    credentials: "include",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || "Could not load financial review queue.");
  }
  return body;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  IN_REVIEW: "bg-blue-100 text-blue-700",
};

export default function FinancialReviewQueuePage() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery<{ items: any[] }>({
    queryKey: ["financial-review-queue"],
    queryFn: loadQueue,
    retry: false,
  });

  const items = data?.items || [];

  return (
    <PageShell title="Financial Review Queue" icon={DollarSign}>
      <div className="space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading financial reviews...
          </div>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-sm text-red-700 space-y-2">
              <div className="font-semibold inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Could not load financial review queue.
              </div>
              <p>{(error as Error).message}</p>
              <button
                className="text-sm underline font-medium"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                {isRefetching ? "Retrying..." : "Retry"}
              </button>
            </CardContent>
          </Card>
        )}

        {items.map((item: any) => {
          const review = item.review || item;
          const variance = Number(review.snapshotVariancePct || 0);
          return (
            <Card key={review.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{item.projectName || "—"}</p>
                    <Badge className={`text-[10px] ${STATUS_COLORS[review.status] || ""}`}>
                      {review.status?.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">v{review.version}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>PM: {item.pm || "—"}</span>
                    {review.reviewDate && <span>Review: {review.reviewDate}</span>}
                    <span>
                      Variance: <span className={Math.abs(variance) > 10 ? "text-red-600 font-medium" : ""}>
                        {variance.toFixed(1)}%
                      </span>
                    </span>
                    <span>Procurement: {((Number(review.snapshotProcurementReadiness || 0)) * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <Link href={`/project/${encodeURIComponent(item.projectName || "")}?tab=readiness-gate`}>
                  <Button size="sm" variant="outline" className="text-xs shrink-0">
                    Review
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })}

        {!error && !isLoading && items.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No pending financial reviews.
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

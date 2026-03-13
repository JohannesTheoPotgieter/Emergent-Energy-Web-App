import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

async function loadQueue() {
  const res = await fetch("/api/pd-pm-handover/submitted", { credentials: "include" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ||
        "Could not load PM review queue. Likely reason: temporary server or network issue. How to fix: refresh and retry. If it persists, contact your admin.",
    );
  }
  return body;
}

export default function PmHandoverReviewPage() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery<{ items: any[] }>({
    queryKey: ["pm-handover-review"],
    queryFn: loadQueue,
    retry: false,
  });

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">PM Handover Review Queue</h1>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading review queue...</p> : null}

      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700 space-y-2">
            <div className="font-semibold inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Could not load PM review queue.
            </div>
            <p>{(error as Error).message}</p>
            <button className="text-sm underline font-medium" onClick={() => refetch()} disabled={isRefetching}>
              {isRefetching ? "Retrying..." : "Retry queue load"}
            </button>
          </CardContent>
        </Card>
      ) : null}

      {(data?.items || []).map((i) => (
        <div key={i.project_id} className="border rounded p-3 flex items-center justify-between">
          <div>
            <p className="font-medium">{i.project_name}</p>
            <p className="text-xs text-muted-foreground">Status: {i.status} · PD: {i.pd || "—"} · PM: {i.pm || "—"}</p>
          </div>
          <Link href={`/pd/handover/${i.project_id}`} className="text-blue-600 underline">Review handover</Link>
        </div>
      ))}

      {!error && !isLoading && (data?.items || []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No submitted or recently rejected handovers are waiting for PM review.</p>
      ) : null}
    </div>
  );
}

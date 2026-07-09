import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { BatteryCharging, CheckCircle2, Loader2 } from "lucide-react";

async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return res.json();
}

interface BessItem {
  id: number;
  title: string;
  status: string;
  countersignedByUserId: number | null;
}

interface BessResponse {
  applies: boolean;
  progress: { total: number; closed: number; countersigned: number; complete: boolean };
  items: BessItem[];
}

/**
 * BESS 7-check panel (Task 1.3). Surfaces the mandatory BESS commissioning
 * checklist for hybrid/battery jobs, with the CM countersignature action that
 * gates each item's closure.
 */
export function BessSevenCheckPanel({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<BessResponse>({
    queryKey: ["bess-seven-check", projectId],
    queryFn: () => qFetch(`/api/commissioning/project/${projectId}/bess-seven-check`),
    enabled: !!projectId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["bess-seven-check", projectId] });

  const seedMutation = useMutation({
    mutationFn: () => qFetch(`/api/commissioning/project/${projectId}/bess-seven-check/seed`, { method: "POST" }),
    onSuccess: () => { invalidate(); toast({ title: "BESS 7-check ready" }); },
    onError: (err: Error) => toast({ title: "Couldn't seed", description: err.message, variant: "destructive" }),
  });

  const countersignMutation = useMutation({
    mutationFn: (id: number) => qFetch(`/api/commissioning/${id}/countersign`, { method: "POST" }),
    onSuccess: () => { invalidate(); toast({ title: "Countersigned" }); },
    onError: (err: Error) => toast({ title: "Countersign failed", description: err.message, variant: "destructive" }),
  });

  // Only hybrid/BESS projects show the panel.
  if (isLoading || !data?.applies) return null;

  return (
    <Card className="border-border" data-testid="bess-seven-check">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10"><BatteryCharging className="h-4 w-4 text-blue-600" /></div>
          BESS 7-Check
          <Badge variant="outline" className="ml-1 text-[10px]" data-testid="bess-progress">
            {data.progress.closed}/{data.progress.total} closed
          </Badge>
          {data.progress.complete && <Badge className="bg-emerald-600 text-[10px]">Complete</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.items.length === 0 ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">The 7 checks have not been created for this project yet.</span>
            <Button size="sm" variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="bess-seed">
              {seedMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null} Create 7-check
            </Button>
          </div>
        ) : (
          <div className="space-y-2" data-testid="bess-items">
            {data.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm" data-testid={`bess-item-${item.id}`}>
                <span className="flex-1 min-w-0 truncate">{item.title}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">{item.status}</Badge>
                {item.countersignedByUserId != null ? (
                  <span className="text-emerald-600 flex items-center gap-1 text-xs shrink-0" data-testid={`bess-countersigned-${item.id}`}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Countersigned
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs shrink-0"
                    onClick={() => countersignMutation.mutate(item.id)}
                    disabled={countersignMutation.isPending || (item.status !== "approved" && item.status !== "closed")}
                    data-testid={`bess-countersign-${item.id}`}
                    title={item.status !== "approved" && item.status !== "closed" ? "The Engineering Lead must approve the check first" : "Construction Manager countersignature"}
                  >
                    Countersign
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

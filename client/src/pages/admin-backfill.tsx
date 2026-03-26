import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { useToast } from "@/hooks/use-toast";
import { Database, CheckCircle2, AlertTriangle, Loader2, Play } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { apiRequest } from "@/lib/queryClient";

interface BackfillStatus {
  tableCounts: Record<string, number>;
  enrichedChecks: Record<string, number>;
  checkedAt: string;
}

export default function AdminBackfillPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading, isError, error, refetch } = useQuery<BackfillStatus>({
    queryKey: ["/api/admin/backfill/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/backfill/status");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const opportunityBackfill = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/backfill/opportunities-from-pd-tickets");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/backfill/status"] });
      toast({ title: "Opportunities backfill complete", description: data.message });
    },
    onError: (err: Error) => toast({ title: "Backfill failed", description: err.message, variant: "destructive" }),
  });

  const siteBackfill = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/backfill/sites-from-projects");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/backfill/status"] });
      toast({ title: "Sites backfill complete", description: data.message });
    },
    onError: (err: Error) => toast({ title: "Backfill failed", description: err.message, variant: "destructive" }),
  });

  const tables = status?.tableCounts ?? {};
  const enriched = status?.enrichedChecks ?? {};

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4 md:p-6"><PageError title="Unable to load backfill status" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-admin-backfill">
      <SectionHeader
        icon={<Database className="h-5 w-5" />}
        eyebrow="Admin"
        title="Data Migration Status"
        description="Check new table populations and run backfill operations"
      />

      {/* Table counts */}
      <div>
        <h3 className="text-sm font-semibold mb-3">New Tables</h3>
        {isLoading && <p className="text-sm text-muted-foreground">Checking...</p>}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {Object.entries(tables).map(([table, count]) => (
            <Card key={table}>
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs font-mono truncate">{table}</span>
                {count === -1 ? (
                  <Badge variant="destructive" className="text-[10px]">Missing</Badge>
                ) : count === 0 ? (
                  <Badge variant="secondary" className="text-[10px]">Empty</Badge>
                ) : (
                  <Badge variant="default" className="text-[10px] bg-green-100 text-green-700">{count} rows</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Enrichment checks */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Enrichment Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {Object.entries(enriched).map(([check, count]) => (
            <Card key={check}>
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs">{check.replace(/_/g, " ")}</span>
                {count === -1 ? (
                  <Badge variant="destructive" className="text-[10px]">Column missing</Badge>
                ) : count === 0 ? (
                  <Badge variant="secondary" className="text-[10px]">No data</Badge>
                ) : (
                  <Badge variant="default" className="text-[10px] bg-green-100 text-green-700">{count} records</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Backfill actions */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Backfill Actions</h3>
        <div className="space-y-3">
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Create Sites from Projects</p>
                <p className="text-xs text-muted-foreground">Extracts unique client locations from project records and creates site entries. Links projects to their sites.</p>
              </div>
              <Button
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => siteBackfill.mutate()}
                disabled={siteBackfill.isPending}
              >
                {siteBackfill.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Create Opportunities from PD Tickets</p>
                <p className="text-xs text-muted-foreground">Creates opportunity records from PD tickets with client data. Links tickets to their opportunities.</p>
              </div>
              <Button
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => opportunityBackfill.mutate()}
                disabled={opportunityBackfill.isPending}
              >
                {opportunityBackfill.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {status && (
        <p className="text-[10px] text-muted-foreground text-right">
          Last checked: {new Date(status.checkedAt).toLocaleString()}
        </p>
      )}
    </PageShell>
  );
}

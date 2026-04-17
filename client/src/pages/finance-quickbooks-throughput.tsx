import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  Building2,
  Link2,
  Users,
  Activity,
  History,
} from "lucide-react";
import { apiRequest, invalidateDashboardQueries } from "@/lib/queryClient";
import { FinanceShell } from "@/components/layout/FinanceShell";

const CustomerMappingView = lazy(() => import("@/pages/finance-quickbooks-customer-mapping"));
const LinksView = lazy(() => import("@/pages/finance-quickbooks-links"));
const SuppliersView = lazy(() => import("@/pages/subcontractor-dashboard"));

type IntegrationHealthState = "healthy" | "stale" | "failing" | "unknown";

interface QuickBooksStatus {
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiry: string | null;
  refreshTokenExpiry: string | null;
  sandbox: boolean;
  health: IntegrationHealthState;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  lastFailureCode: string | null;
  lastFailureReason: string | null;
  isStale: boolean;
  ageMs: number | null;
  staleAfterMs: number;
}

function formatRelativeAge(ageMs: number | null): string {
  if (ageMs === null || ageMs < 0) return "—";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function healthBadgeClass(state: IntegrationHealthState): string {
  switch (state) {
    case "healthy":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "stale":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "failing":
      return "bg-rose-100 text-rose-700 border-rose-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function ConnectionTab({ status }: { status: QuickBooksStatus | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isConnected = status?.connected ?? false;

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quickbooks/disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
      toast({ title: "QuickBooks disconnected" });
    },
    onError: (err: Error) => {
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: pnlReport } = useQuery<any>({
    queryKey: ["/api/quickbooks/reports/pnl-throughput"],
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/reports/pnl?startDate=${iso(start)}&endDate=${iso(end)}`,
      );
      return res.json();
    },
    enabled: isConnected,
  });

  const summaryRow = pnlReport?.Rows?.Row?.find?.((r: any) => r?.Summary);
  const netIncome =
    summaryRow?.Summary?.ColData?.[summaryRow.Summary.ColData.length - 1]?.value ?? "—";

  return (
    <div className="space-y-4">
      {!isConnected ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">QuickBooks is not connected</p>
                <p className="text-xs text-amber-700 mt-1">
                  Click Connect to authorize this workspace. You'll be redirected to Intuit.
                </p>
                <Button
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => {
                    window.location.href = "/api/quickbooks/auth";
                  }}
                >
                  <Plug className="h-4 w-4" /> Connect to QuickBooks
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card
            className={
              status?.health === "failing"
                ? "border-rose-200 bg-rose-50/40"
                : status?.isStale || status?.health === "stale"
                  ? "border-amber-200 bg-amber-50/40"
                  : "border-emerald-200 bg-emerald-50/40"
            }
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {status?.health === "failing" ? (
                  <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                ) : status?.isStale || status?.health === "stale" ? (
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">Integration health</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${healthBadgeClass(status?.health ?? "unknown")}`}
                    >
                      {status?.health ?? "unknown"}
                    </Badge>
                    {status?.isStale && status?.health !== "failing" && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                        stale data
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Last successful sync</div>
                      <div className="font-medium">
                        {status?.lastSuccessfulSyncAt
                          ? `${formatDateTime(status.lastSuccessfulSyncAt)} (${formatRelativeAge(status.ageMs)})`
                          : "never"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last failed sync</div>
                      <div className="font-medium">
                        {status?.lastFailedSyncAt ? formatDateTime(status.lastFailedSyncAt) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last failure reason</div>
                      <div className="font-medium truncate" title={status?.lastFailureReason ?? undefined}>
                        {status?.lastFailureCode
                          ? `${status.lastFailureCode}${status.lastFailureReason ? ` — ${status.lastFailureReason}` : ""}`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Company</div>
                <div className="text-sm font-medium truncate">{status?.companyName ?? "—"}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Realm ID</div>
                <div className="text-sm font-medium truncate">{status?.realmId ?? "—"}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Access token expiry</div>
                <div className="text-sm font-medium">{formatDateTime(status?.tokenExpiry)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">3-mo Net Income (QB P&L)</div>
                <div className="text-sm font-medium">{netIncome}</div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="gap-1.5"
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              Disconnect
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface SyncLogEvent {
  id: number;
  runAt: string;
  status: "ok" | "error" | "running";
  kind: string | null;
  message: string | null;
  recordCount: number | null;
}

function SyncLogTab() {
  const { data, isLoading } = useQuery<{ events: SyncLogEvent[] }>({
    queryKey: ["/api/quickbooks/sync-log"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/sync-log");
      return res.json();
    },
  });

  const events = data?.events ?? [];

  if (isLoading) return <PageSkeleton lines={5} />;

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        {events.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No sync events recorded yet. Trigger a sync from the Connection tab.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">When</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Records</th>
                <th className="text-left px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(evt.runAt)}</td>
                  <td className="px-3 py-2">{evt.kind ?? "—"}</td>
                  <td className="px-3 py-2">
                    {evt.status === "ok" ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                      </Badge>
                    ) : evt.status === "error" ? (
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Error
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{evt.recordCount ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[400px] truncate">
                    {evt.message ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinanceQuickBooksThroughputPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("connection");

  const { data: status, isLoading: statusLoading } = useQuery<QuickBooksStatus>({
    queryKey: ["/api/quickbooks/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/status");
      return res.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quickbooks/sync-now");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "QuickBooks sync triggered", description: "Pulling latest bills, invoices, customers and vendors." });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cos-tracker"] });
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-tracker"] });
      invalidateDashboardQueries(queryClient);
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Surface OAuth callback result as a toast, then strip the query string.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("quickbooks");
    if (!flag) return;
    if (flag === "connected") {
      toast({ title: "QuickBooks connected", description: "OAuth flow completed." });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
    } else if (flag === "error") {
      toast({
        title: "QuickBooks connection failed",
        description: params.get("message") || "See logs for details.",
        variant: "destructive",
      });
    }
    params.delete("quickbooks");
    params.delete("message");
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [toast, queryClient]);

  if (statusLoading) return <FinanceShell><PageSkeleton lines={5} /></FinanceShell>;

  const isConnected = status?.connected ?? false;

  return (
    <FinanceShell>
      <div className="space-y-4">
        {/* Header — connection state + Sync Now */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Plug className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-base font-semibold">QuickBooks Throughput</div>
                <div className="text-xs text-muted-foreground">
                  {isConnected
                    ? `Connected to ${status?.companyName ?? "QuickBooks"} · Last sync ${status?.lastSuccessfulSyncAt ? formatRelativeAge(status.ageMs) : "never"}`
                    : "Not connected"}
                </div>
              </div>
            </div>
            {isConnected && (
              <Button
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="gap-1.5"
                data-testid="qb-sync-now"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Sync Now
              </Button>
            )}
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto p-1 bg-muted/60">
            <TabsTrigger value="connection" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Connection
            </TabsTrigger>
            <TabsTrigger value="mapping" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Mapping
            </TabsTrigger>
            <TabsTrigger value="reconciliation" className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" /> Reconciliation
            </TabsTrigger>
            <TabsTrigger value="suppliers" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Suppliers
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5">
              <History className="h-3.5 w-3.5" /> Sync Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="mt-4">
            <ConnectionTab status={status} />
          </TabsContent>

          <TabsContent value="mapping" className="mt-4">
            <Suspense fallback={<PageSkeleton lines={5} />}>
              <div className="qb-throughput-embed">
                <CustomerMappingView />
              </div>
            </Suspense>
          </TabsContent>

          <TabsContent value="reconciliation" className="mt-4">
            <Suspense fallback={<PageSkeleton lines={5} />}>
              <div className="qb-throughput-embed">
                <LinksView />
              </div>
            </Suspense>
          </TabsContent>

          <TabsContent value="suppliers" className="mt-4">
            <Suspense fallback={<PageSkeleton lines={5} />}>
              <div className="qb-throughput-embed">
                <SuppliersView />
              </div>
            </Suspense>
          </TabsContent>

          <TabsContent value="log" className="mt-4">
            <SyncLogTab />
          </TabsContent>
        </Tabs>
      </div>
    </FinanceShell>
  );
}

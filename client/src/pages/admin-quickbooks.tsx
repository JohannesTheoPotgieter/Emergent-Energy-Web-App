import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Loader2, Plug, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatRand } from "@/lib/safeMoney";
import { ReportTrustNotice } from "@/components/reports/ReportTrustNotice";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

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
  daysUntilRefreshTokenExpiry: number | null;
  refreshTokenExpiryState: "ok" | "expiring_soon" | "critical" | "expired" | "unknown";
  reconnectRequired: boolean;
  reconnectPath: string;
}

function refreshExpiryClass(state: QuickBooksStatus["refreshTokenExpiryState"]): string {
  switch (state) {
    case "expired":
    case "critical":
      return "text-rose-700";
    case "expiring_soon":
      return "text-amber-700";
    default:
      return "text-muted-foreground";
  }
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

interface QuickBooksQueryResponse<T> {
  QueryResponse?: {
    Invoice?: T[];
    Customer?: T[];
    Vendor?: T[];
    Bill?: T[];
    maxResults?: number;
    totalCount?: number;
  };
}

interface QbInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: { name?: string; value?: string };
}

interface QbCustomer {
  Id: string;
  DisplayName?: string;
  Active?: boolean;
}

/**
 * All amounts on this page are rendered in ZAR (South African Rand).
 * The Emergent Energy finance context is ZA-domiciled, and mixing USD with
 * the rest of the finance pages (all ZAR) was actively misleading.
 * If a future multi-currency QB company is onboarded, read the home
 * currency from QB CompanyInfo and switch on that instead.
 */
function formatCurrency(value?: number | null): string {
  return formatRand(value);
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export default function AdminQuickBooksPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  // Task #30 — Page-level admin guard. Previously the page rendered for any
  // authenticated user and relied on individual button-level permission
  // checks (which were inconsistent). Now non-admins are redirected to the
  // home page and never see admin-only OAuth controls.
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      setLocation("/");
    }
  }, [authLoading, isAdmin, setLocation]);
  const isUnauthorized = !authLoading && !isAdmin;

  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<QuickBooksStatus>({
    queryKey: ["/api/quickbooks/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/status");
      return res.json();
    },
    enabled: !isUnauthorized,
  });

  const isConnected = status?.connected ?? false;

  const { data: invoicesResp } = useQuery<QuickBooksQueryResponse<QbInvoice>>({
    queryKey: ["/api/quickbooks/invoices"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/invoices");
      return res.json();
    },
    enabled: isConnected,
  });

  const { data: customersResp } = useQuery<QuickBooksQueryResponse<QbCustomer>>({
    queryKey: ["/api/quickbooks/customers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/customers");
      return res.json();
    },
    enabled: isConnected,
  });

  const pnlDates = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { startDate: iso(start), endDate: iso(end) };
  }, []);

  const { data: pnlReport } = useQuery<any>({
    queryKey: ["/api/quickbooks/reports/pnl", pnlDates.startDate, pnlDates.endDate],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/reports/pnl?startDate=${pnlDates.startDate}&endDate=${pnlDates.endDate}`,
      );
      return res.json();
    },
    enabled: isConnected,
  });

  // F-4 — Pending QB cascade proposal counts + oldest age, surfaced as a
  // banner so stale paid-date / mapping proposals don't sit invisible and
  // silently drift the COS Tracker out of sync with QB.
  const { data: proposalSummary } = useQuery<{
    pending: number;
    agedOver7Days: number;
    agedOver14Days: number;
    agedOver30Days: number;
    oldestAgeDays: number | null;
    oldestCreatedAt: string | null;
  }>({
    queryKey: ["/api/quickbooks/cascade-proposals/summary"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/cascade-proposals/summary");
      return res.json();
    },
    enabled: isConnected,
    staleTime: 60_000,
  });

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

  // Surface OAuth callback result as a toast, then strip the query string.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("quickbooks");
    if (!flag) return;
    if (flag === "connected") {
      toast({ title: "QuickBooks connected", description: "OAuth flow completed successfully." });
      refetchStatus();
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
  }, [toast, refetchStatus]);

  if (isUnauthorized) {
    return (
      <PageShell className="p-4 md:p-6">
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          QuickBooks admin actions are restricted to CEO / COO admins. Redirecting…
        </div>
      </PageShell>
    );
  }

  if (statusLoading) return <PageSkeleton lines={5} />;

  const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
  const customerCount = customersResp?.QueryResponse?.Customer?.length ?? 0;

  const pnlRows: Array<{ label: string; amount: string }> = [];
  const header = pnlReport?.Header;
  if (header) {
    pnlRows.push({ label: "Report period", amount: `${header.StartPeriod ?? ""} → ${header.EndPeriod ?? ""}` });
  }
  const summaryRow = pnlReport?.Rows?.Row?.find?.((r: any) => r?.group === "NetIncome" || r?.Summary);
  if (summaryRow?.Summary?.ColData?.length) {
    const cols = summaryRow.Summary.ColData;
    pnlRows.push({
      label: String(cols[0]?.value ?? "Net Income"),
      amount: String(cols[cols.length - 1]?.value ?? "—"),
    });
  }

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-admin-quickbooks">
      <SectionHeader
        icon={<Plug className="h-5 w-5" />}
        eyebrow="Admin"
        title="QuickBooks Online Integration"
        description="OAuth2 connection for invoices, customers, vendors and P&L reporting"
        actions={
          isConnected ? (
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
                <RefreshCw className="h-4 w-4" />
              )}
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                window.location.href = "/api/quickbooks/auth";
              }}
            >
              <Plug className="h-4 w-4" />
              Connect to QuickBooks
            </Button>
          )
        }
      />

      {status && isConnected && (
        <Card
          className={
            status.health === "failing"
              ? "border-rose-200 bg-rose-50/40"
              : status.isStale || status.health === "stale"
                ? "border-amber-200 bg-amber-50/40"
                : "border-emerald-200 bg-emerald-50/40"
          }
          data-testid="qb-health-summary"
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {status.health === "failing" ? (
                <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              ) : status.isStale || status.health === "stale" ? (
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Integration health</span>
                  <Badge variant="outline" className={`text-[10px] ${healthBadgeClass(status.health)}`}>
                    {status.health}
                  </Badge>
                  {status.isStale && status.health !== "failing" && (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                      stale data
                    </Badge>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Last successful sync</div>
                    <div className="font-medium" data-testid="qb-last-success">
                      {status.lastSuccessfulSyncAt
                        ? `${formatDateTime(status.lastSuccessfulSyncAt)} (${formatRelativeAge(status.ageMs)})`
                        : "never"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Last failed sync</div>
                    <div className="font-medium" data-testid="qb-last-failure">
                      {status.lastFailedSyncAt ? formatDateTime(status.lastFailedSyncAt) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Last failure reason</div>
                    <div className="font-medium truncate" title={status.lastFailureReason ?? undefined}>
                      {status.lastFailureCode
                        ? `${status.lastFailureCode}${status.lastFailureReason ? ` — ${status.lastFailureReason}` : ""}`
                        : "—"}
                    </div>
                  </div>
                </div>
                {status.daysUntilRefreshTokenExpiry !== null && (
                  <p
                    className={`mt-2 text-xs font-medium ${refreshExpiryClass(status.refreshTokenExpiryState)}`}
                    data-testid="qb-refresh-token-expiry"
                  >
                    {status.daysUntilRefreshTokenExpiry <= 0
                      ? "Refresh token EXPIRED — re-authorise to restore syncing."
                      : `Refresh token expires in ${status.daysUntilRefreshTokenExpiry} day${status.daysUntilRefreshTokenExpiry === 1 ? "" : "s"}.`}
                  </p>
                )}
                {status.reconnectRequired && (
                  <div className="mt-2 flex flex-col gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
                    <p className="text-xs text-rose-800">
                      QuickBooks needs re-authorisation — its refresh token was revoked or has expired, so
                      new data isn't syncing. Reconciliation data below is shown as of the last successful
                      sync above.
                    </p>
                    <Button
                      size="sm"
                      className="gap-1.5 self-start"
                      onClick={() => {
                        window.location.href = status.reconnectPath;
                      }}
                      data-testid="qb-reconnect"
                    >
                      <Plug className="h-4 w-4" /> Reconnect QuickBooks
                    </Button>
                  </div>
                )}
                {status.isStale && (
                  <p className="mt-2 text-xs text-amber-700">
                    QuickBooks data shown below may be stale (no successful sync in{" "}
                    {Math.round(status.staleAfterMs / 60_000)} minutes). Refresh or re-connect if the
                    reconciliation view looks wrong.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* F-4 — Pending QB cascade proposal banner. Surfaces unresolved
          paid-date / mapping proposals before they silently drift the COS
          Tracker out of sync with QB. Only renders when there's load. */}
      {isConnected && proposalSummary && proposalSummary.pending > 0 && (
        <Card
          className={
            proposalSummary.agedOver14Days > 0
              ? "border-rose-200 bg-rose-50/40"
              : proposalSummary.agedOver7Days > 0
                ? "border-amber-200 bg-amber-50/40"
                : "border-sky-200 bg-sky-50/40"
          }
          data-testid="qb-proposal-summary"
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle
                className={
                  proposalSummary.agedOver14Days > 0
                    ? "h-5 w-5 text-rose-500 shrink-0 mt-0.5"
                    : proposalSummary.agedOver7Days > 0
                      ? "h-5 w-5 text-amber-500 shrink-0 mt-0.5"
                      : "h-5 w-5 text-sky-500 shrink-0 mt-0.5"
                }
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">QuickBooks cascade proposals waiting review</span>
                  <Badge variant="outline" className="text-[10px]">
                    {proposalSummary.pending} pending
                  </Badge>
                  {proposalSummary.agedOver7Days > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                      {proposalSummary.agedOver7Days} &gt; 7d
                    </Badge>
                  )}
                  {proposalSummary.agedOver14Days > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">
                      {proposalSummary.agedOver14Days} &gt; 14d
                    </Badge>
                  )}
                  {proposalSummary.agedOver30Days > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-rose-100 text-rose-800 border-rose-300">
                      {proposalSummary.agedOver30Days} &gt; 30d
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  These are field-level differences QuickBooks reported (e.g. bill paid, vendor mapping, amount
                  drift) that need an operator to accept or decline. The COS Tracker stays out of sync until each
                  is resolved.
                  {proposalSummary.oldestAgeDays !== null && proposalSummary.oldestAgeDays > 0 && (
                    <>
                      {" "}Oldest pending: <span className="font-medium">{proposalSummary.oldestAgeDays} day{proposalSummary.oldestAgeDays === 1 ? "" : "s"}</span>.
                    </>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              {isConnected ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
              <span className="text-xs text-muted-foreground">Connection</span>
            </div>
            <div className="text-sm font-medium">{isConnected ? "Connected" : "Not connected"}</div>
          </CardContent>
        </Card>
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
      </div>

      {!isConnected && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">QuickBooks is not connected</p>
                <p className="text-xs text-amber-700 mt-1">
                  Click <strong>Connect to QuickBooks</strong> to authorize this workspace. You will
                  be redirected to Intuit to approve access to the Accounting scope.
                </p>
                <p className="text-xs text-amber-600 mt-2">
                  Required env vars (set these in Replit → Tools → Secrets):{" "}
                  <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">QUICKBOOKS_CLIENT_ID</code>,{" "}
                  <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">QUICKBOOKS_CLIENT_SECRET</code>,{" "}
                  <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">QUICKBOOKS_REDIRECT_URI</code>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isConnected && status && (
        <ReportTrustNotice
          sourceLabel="QuickBooks Online (read-only view)"
          lastUpdatedAt={status.lastSuccessfulSyncAt}
          note="QuickBooks is reconciliation evidence, not operational truth. Cost lines and revenue lines in this app are the source of truth. Amounts shown on this page are rendered in ZAR for the SA finance context."
        />
      )}

      {isConnected && (
        <>
          <div>
            <h3 className="text-sm font-semibold mb-3">Recent invoices</h3>
            {invoices.length === 0 ? (
              <p className="text-xs text-muted-foreground">No invoices returned.</p>
            ) : (
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Invoice #</th>
                        <th className="text-left px-3 py-2 font-medium">Date</th>
                        <th className="text-left px-3 py-2 font-medium">Customer</th>
                        <th className="text-right px-3 py-2 font-medium">Total</th>
                        <th className="text-right px-3 py-2 font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.slice(0, 25).map((invoice) => (
                        <tr key={invoice.Id} className="border-t">
                          <td className="px-3 py-2">{invoice.DocNumber ?? invoice.Id}</td>
                          <td className="px-3 py-2">{invoice.TxnDate ?? "—"}</td>
                          <td className="px-3 py-2">{invoice.CustomerRef?.name ?? "—"}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(invoice.TotalAmt)}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(invoice.Balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Active customers</div>
                <div className="text-2xl font-semibold mt-1">{customerCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Profit & Loss ({pnlDates.startDate} → {pnlDates.endDate})</div>
                {pnlRows.length === 0 ? (
                  <div className="text-sm mt-1 text-muted-foreground">Report not available.</div>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {pnlRows.map((row) => (
                      <li key={row.label} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="font-medium">{row.amount}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}

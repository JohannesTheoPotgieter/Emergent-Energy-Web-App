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

interface QuickBooksStatus {
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiry: string | null;
  refreshTokenExpiry: string | null;
  sandbox: boolean;
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

function formatCurrency(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
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
            {status?.sandbox && (
              <Badge variant="outline" className="mt-1 text-[10px]">Sandbox</Badge>
            )}
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
                  Required env vars: <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">QUICKBOOKS_CLIENT_ID</code>,
                  {" "}
                  <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">QUICKBOOKS_CLIENT_SECRET</code>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
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

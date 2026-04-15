import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import { Link2, Link2Off, Plug, Search, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { isApiError } from "@/lib/api-error";
import { formatRand } from "@/lib/safeMoney";
import { ReportTrustNotice } from "@/components/reports/ReportTrustNotice";

interface QbBillRaw {
  Id: string;
  DocNumber?: string | null;
  TxnDate?: string | null;
  TotalAmt?: number | null;
  Balance?: number | null;
  VendorRef?: { name?: string | null; value?: string | null };
}

interface AppCostLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  description: string | null;
}

interface QuickBooksLinkRow {
  id: number;
  projectId: number | null;
  appEntityId: number;
  qbEntityId: string;
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbAmount: string | null;
  qbCounterpartyName: string | null;
  matchType: string;
  confirmedAt: string;
  confirmedBy: number | null;
}

interface QuickBooksStatus {
  connected: boolean;
  companyName: string | null;
  sandbox: boolean;
  lastSuccessfulSyncAt?: string | null;
  lastFailedSyncAt?: string | null;
  lastFailureReason?: string | null;
  isStale?: boolean;
}

// Delegate to the shared ZAR formatter so every QB/finance page renders
// amounts consistently for the SA finance context.
const formatCurrency = (value?: number | string | null) => formatRand(value);

export default function FinanceQuickBooksLinksPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedBill, setSelectedBill] = useState<QbBillRaw | null>(null);
  const [costLineSearch, setCostLineSearch] = useState("");

  const { data: status, isLoading: statusLoading } = useQuery<QuickBooksStatus>({
    queryKey: ["/api/quickbooks/status"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/status")).json(),
  });

  const { data: billsResp } = useQuery<{ QueryResponse?: { Bill?: QbBillRaw[] } }>({
    queryKey: ["/api/quickbooks/bills"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/bills")).json(),
    enabled: !!status?.connected,
  });

  const { data: linksResp } = useQuery<{ links: QuickBooksLinkRow[] }>({
    queryKey: ["/api/quickbooks/links"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/links")).json(),
    enabled: !!status?.connected,
  });

  const { data: costLineSearchResp, isFetching: costLineSearching } = useQuery<{
    costLines: AppCostLineSummary[];
  }>({
    queryKey: ["/api/quickbooks/cost-lines/search", costLineSearch],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/cost-lines/search?q=${encodeURIComponent(costLineSearch)}&limit=25`,
      );
      return res.json();
    },
    enabled: !!selectedBill,
  });

  const linkMutation = useMutation({
    mutationFn: async (input: { costLineId: number; projectId: number; bill: QbBillRaw }) => {
      const res = await apiRequest("POST", "/api/quickbooks/links", {
        projectId: input.projectId,
        costLineId: input.costLineId,
        bill: input.bill,
        matchType: "manual",
      });
      return res.json();
    },
    onSuccess: () => {
      setSelectedBill(null);
      setCostLineSearch("");
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      toast({ title: "Link created" });
    },
    onError: (err: Error) => {
      const title = isApiError(err) && err.status === 409 ? "Link conflict" : "Link failed";
      toast({ title, description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await apiRequest("DELETE", `/api/quickbooks/links/${linkId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      toast({ title: "Link removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Unlink failed", description: err.message, variant: "destructive" });
    },
  });

  const bills = billsResp?.QueryResponse?.Bill ?? [];
  const links = linksResp?.links ?? [];

  // Build a set of QB IDs that already have a link to hide them from the "unlinked" list.
  const linkedQbIds = useMemo(() => new Set(links.map((l) => l.qbEntityId)), [links]);
  const unlinkedBills = useMemo(() => bills.filter((b) => !linkedQbIds.has(b.Id)), [bills, linkedQbIds]);

  if (statusLoading) return <PageSkeleton lines={6} />;

  if (!status?.connected) {
    return (
      <PageShell className="p-4 md:p-6">
        <SectionHeader
          icon={<Plug className="h-5 w-5" />}
          eyebrow="Finance"
          title="QuickBooks Bill Linking"
          description="Link QuickBooks supplier bills to project cost lines across the portfolio"
        />
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-4 text-xs text-amber-800">
            QuickBooks is not connected. Connect it in{" "}
            <a href="/admin/quickbooks" className="underline font-medium">
              Admin → QuickBooks
            </a>
            {" "}to start linking.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-finance-quickbooks-links">
      <SectionHeader
        icon={<Plug className="h-5 w-5" />}
        eyebrow="Finance"
        title="QuickBooks Bill Linking"
        description="Link QuickBooks supplier bills to project cost lines across the portfolio"
      />

      <ReportTrustNotice
        sourceLabel="QuickBooks bills (evidence) ↔ normalized_cost_lines (truth)"
        lastUpdatedAt={status.lastSuccessfulSyncAt ?? null}
        note="A QuickBooks 'bill' is a supplier invoice the company owes. App cost lines remain the source of truth for COS recognition — linking only attaches QB bill evidence to a cost line, it does not move money or realise COS."
      />

      {/* Step 1: pick a bill */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          1. Pick a QuickBooks bill <Badge variant="outline">{unlinkedBills.length}</Badge>
          {status.sandbox && <Badge variant="outline" className="text-[10px]">Sandbox</Badge>}
        </h3>
        {unlinkedBills.length === 0 ? (
          <p className="text-xs text-muted-foreground">No unlinked QB bills.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto max-h-80">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Bill #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Vendor</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                    <th className="px-2 py-1.5 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {unlinkedBills.map((bill) => {
                    const isSelected = selectedBill?.Id === bill.Id;
                    return (
                      <tr
                        key={bill.Id}
                        className={`border-t cursor-pointer ${isSelected ? "bg-sky-50/70" : "hover:bg-muted/40"}`}
                        onClick={() => setSelectedBill(isSelected ? null : bill)}
                      >
                        <td className="px-2 py-1.5 font-medium">{bill.DocNumber ?? bill.Id}</td>
                        <td className="px-2 py-1.5">{bill.TxnDate ?? "—"}</td>
                        <td className="px-2 py-1.5">{bill.VendorRef?.name ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(bill.TotalAmt)}</td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(bill.Balance)}</td>
                        <td className="px-2 py-1.5">
                          {isSelected ? (
                            <Badge className="text-[9px] bg-sky-100 text-sky-800">Selected</Badge>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Step 2: pick an app cost line */}
      {selectedBill && (
        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            2. Pick a project cost line to link{" "}
            <Badge variant="outline">{costLineSearchResp?.costLines.length ?? 0}</Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] ml-auto"
              onClick={() => {
                setSelectedBill(null);
                setCostLineSearch("");
              }}
            >
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </h3>
          <Card>
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Search className="h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search by invoice #, supplier, project name, or description"
                  value={costLineSearch}
                  onChange={(e) => setCostLineSearch(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              {costLineSearching && (
                <div className="text-xs text-muted-foreground">Searching…</div>
              )}
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Project</th>
                      <th className="px-2 py-1.5 text-left">Invoice #</th>
                      <th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">Supplier</th>
                      <th className="px-2 py-1.5 text-right">Amount</th>
                      <th className="px-2 py-1.5 text-left"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(costLineSearchResp?.costLines ?? []).map((cost) => {
                      const exactMatch =
                        (cost.invoiceNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase() ===
                        (selectedBill.DocNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
                      return (
                        <tr key={cost.id} className="border-t hover:bg-muted/40">
                          <td className="px-2 py-1.5">{cost.projectName ?? `#${cost.projectId}`}</td>
                          <td className="px-2 py-1.5 font-medium">
                            {cost.invoiceNumber ?? "—"}
                            {exactMatch && (
                              <Badge className="ml-1 text-[9px] bg-green-100 text-green-700">
                                match
                              </Badge>
                            )}
                          </td>
                          <td className="px-2 py-1.5">{cost.invoiceDate ?? "—"}</td>
                          <td className="px-2 py-1.5">{cost.counterpartyName ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right">
                            {formatCurrency(cost.amountExVat)}
                          </td>
                          <td className="px-2 py-1.5">
                            <Button
                              size="sm"
                              className="h-6 text-[10px] gap-1"
                              disabled={linkMutation.isPending}
                              onClick={() =>
                                linkMutation.mutate({
                                  costLineId: cost.id,
                                  projectId: cost.projectId,
                                  bill: selectedBill,
                                })
                              }
                            >
                              <Link2 className="h-3 w-3" /> Link
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {!costLineSearching && (costLineSearchResp?.costLines.length ?? 0) === 0 && (
                      <tr>
                        <td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">
                          {costLineSearch
                            ? "No cost lines match."
                            : "Type to search (or leave blank for most recent 50)."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-muted-foreground border-t pt-2">
                Linking <span className="font-medium">{selectedBill.DocNumber ?? selectedBill.Id}</span>
                {" "}({formatCurrency(selectedBill.TotalAmt)} · {selectedBill.VendorRef?.name ?? "—"})
                {" "}— snapshot will be stored on the link row.
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Existing links */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          Existing links <Badge variant="outline">{links.length}</Badge>
        </h3>
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">No links yet.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Match</th>
                    <th className="px-2 py-1.5 text-left">Project</th>
                    <th className="px-2 py-1.5 text-left">App cost line</th>
                    <th className="px-2 py-1.5 text-left">QB bill</th>
                    <th className="px-2 py-1.5 text-left">Vendor</th>
                    <th className="px-2 py-1.5 text-right">QB amount</th>
                    <th className="px-2 py-1.5 text-left">Confirmed</th>
                    <th className="px-2 py-1.5 text-left">By</th>
                    <th className="px-2 py-1.5 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id} className="border-t">
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className="text-[9px]">
                          {link.matchType}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        {link.projectId ? `#${link.projectId}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 font-mono">#{link.appEntityId}</td>
                      <td className="px-2 py-1.5">
                        {link.qbDocNumber ?? link.qbEntityId}
                        {link.qbTxnDate && (
                          <span className="block text-[10px] text-muted-foreground">
                            {link.qbTxnDate}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{link.qbCounterpartyName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(link.qbAmount)}
                      </td>
                      <td
                        className="px-2 py-1.5"
                        title={new Date(link.confirmedAt).toLocaleString()}
                      >
                        {new Date(link.confirmedAt).toLocaleDateString()}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {link.confirmedBy !== null ? `user #${link.confirmedBy}` : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] gap-1 text-muted-foreground"
                          onClick={() => unlinkMutation.mutate(link.id)}
                          disabled={unlinkMutation.isPending}
                        >
                          <Link2Off className="h-3 w-3" /> Unlink
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

    </PageShell>
  );
}

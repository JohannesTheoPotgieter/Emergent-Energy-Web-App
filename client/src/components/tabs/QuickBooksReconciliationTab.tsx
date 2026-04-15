import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Link2Off,
  Plug,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ===== Types (mirror server/services/quickbooks-reconciliation-service.ts) =====

interface QuickBooksBillSummary {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  balance: number | null;
  vendorName: string | null;
  vendorId: string | null;
}

interface AppCostLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  cosRealised: boolean | null;
  paidDateConfirmed: boolean | null;
  status: string | null;
  description: string | null;
  poNumber: string | null;
}

type ReconciliationMatchType =
  | "linked"
  | "auto_exact"
  | "auto_fuzzy"
  | "app_only"
  | "qb_only";

interface ReconciliationRow {
  matchType: ReconciliationMatchType;
  costLine: AppCostLineSummary | null;
  bill: QuickBooksBillSummary | null;
  amountVariance: number | null;
  hasWarning: boolean;
  link: { id: number } | null;
}

interface ReconciliationResult {
  projectId: number;
  generatedAt: string;
  summary: {
    linkedCount: number;
    autoExactCount: number;
    autoFuzzyCount: number;
    appOnlyCount: number;
    qbOnlyCount: number;
    totalAppAmount: number;
    totalQbAmount: number;
    amountVariance: number;
  };
  rows: ReconciliationRow[];
}

interface QuickBooksStatus {
  connected: boolean;
  companyName: string | null;
  sandbox: boolean;
}

// ===== Helpers =====

function formatCurrency(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function matchTypeLabel(t: ReconciliationMatchType): string {
  switch (t) {
    case "linked":
      return "Linked";
    case "auto_exact":
      return "Auto — exact";
    case "auto_fuzzy":
      return "Auto — fuzzy";
    case "app_only":
      return "App only";
    case "qb_only":
      return "QB only";
  }
}

function matchTypeBadgeClass(t: ReconciliationMatchType): string {
  switch (t) {
    case "linked":
      return "bg-emerald-100 text-emerald-700";
    case "auto_exact":
      return "bg-green-50 text-green-700";
    case "auto_fuzzy":
      return "bg-amber-50 text-amber-700";
    case "app_only":
      return "bg-sky-50 text-sky-700";
    case "qb_only":
      return "bg-purple-50 text-purple-700";
  }
}

// ===== Revenue types (mirror server service) =====

interface QuickBooksInvoiceSummary {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  balance: number | null;
  customerName: string | null;
  customerId: string | null;
}

interface AppRevenueLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  amountExVat: number | null;
  status: string | null;
  milestoneName: string | null;
  description: string | null;
}

interface RevenueReconciliationRow {
  matchType: ReconciliationMatchType;
  revenueLine: AppRevenueLineSummary | null;
  invoice: QuickBooksInvoiceSummary | null;
  amountVariance: number | null;
  hasWarning: boolean;
  link: { id: number } | null;
}

interface RevenueReconciliationResult {
  projectId: number;
  mapping: {
    id: number;
    qbCustomerId: string;
    qbCustomerName: string | null;
  } | null;
  summary: ReconciliationResult["summary"];
  rows: RevenueReconciliationRow[];
  generatedAt: string;
}

type ReconMode = "cost" | "revenue";

// ===== Component =====

interface Props {
  projectId: number;
  projectName: string;
}

export function QuickBooksReconciliationTab({ projectId, projectName }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = useState<ReconMode>("cost");

  // Default to a 90-day window ending today so the QB query is bounded.
  const defaultRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { startDate: iso(start), endDate: iso(end) };
  }, []);
  const [startDate, setStartDate] = useState<string>(defaultRange.startDate);
  const [endDate, setEndDate] = useState<string>(defaultRange.endDate);

  // Row being manually linked (app-only). The user then clicks a QB-only bill to link it.
  const [pendingLinkCostLineId, setPendingLinkCostLineId] = useState<number | null>(null);

  const { data: status } = useQuery<QuickBooksStatus>({
    queryKey: ["/api/quickbooks/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/status");
      return res.json();
    },
  });

  const reconQuery = useQuery<ReconciliationResult>({
    queryKey: [
      "/api/quickbooks/projects/cos-reconciliation",
      projectId,
      startDate,
      endDate,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const qs = params.toString();
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/projects/${projectId}/cos-reconciliation${qs ? `?${qs}` : ""}`,
      );
      return res.json();
    },
    enabled: !!status?.connected && mode === "cost",
  });

  const revenueReconQuery = useQuery<RevenueReconciliationResult>({
    queryKey: [
      "/api/quickbooks/projects/revenue-reconciliation",
      projectId,
      startDate,
      endDate,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const qs = params.toString();
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/projects/${projectId}/revenue-reconciliation${qs ? `?${qs}` : ""}`,
      );
      return res.json();
    },
    enabled: !!status?.connected && mode === "revenue",
  });

  const invalidateRecon = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/quickbooks/projects/cos-reconciliation", projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/quickbooks/projects/revenue-reconciliation", projectId],
    });
  };

  const linkInvoiceMutation = useMutation({
    mutationFn: async (input: {
      revenueLineId: number;
      invoice: QuickBooksInvoiceSummary;
    }) => {
      const res = await apiRequest("POST", "/api/quickbooks/revenue-links", {
        projectId,
        revenueLineId: input.revenueLineId,
        invoice: input.invoice,
        matchType: "manual",
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateRecon();
      toast({ title: "Linked to QuickBooks invoice" });
    },
    onError: (err: Error) => {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (input: { costLineId: number; bill: QuickBooksBillSummary }) => {
      const res = await apiRequest("POST", "/api/quickbooks/links", {
        projectId,
        costLineId: input.costLineId,
        bill: input.bill,
        matchType: "manual",
      });
      return res.json();
    },
    onSuccess: () => {
      setPendingLinkCostLineId(null);
      invalidateRecon();
      toast({ title: "Linked to QuickBooks bill" });
    },
    onError: (err: Error) => {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await apiRequest("DELETE", `/api/quickbooks/links/${linkId}`);
      return res.json();
    },
    onSuccess: () => {
      invalidateRecon();
      toast({ title: "Link removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Unlink failed", description: err.message, variant: "destructive" });
    },
  });

  // NOTE: the "Mark COS Realised" affordance used to call
  // POST /api/quickbooks/cost-lines/:id/mark-realised. That endpoint
  // bypassed the canonical finance control path (COS period lock,
  // invoice-evidence checks, audit trail, metric refresh) and has been
  // disabled. Use the COS Tracker page to realise a cost line.

  const rows = reconQuery.data?.rows ?? [];
  const summary = reconQuery.data?.summary;

  const { linked, appOnly, qbOnly } = useMemo(() => {
    const linked: ReconciliationRow[] = [];
    const appOnly: ReconciliationRow[] = [];
    const qbOnly: ReconciliationRow[] = [];
    for (const row of rows) {
      if (row.matchType === "app_only") appOnly.push(row);
      else if (row.matchType === "qb_only") qbOnly.push(row);
      else linked.push(row);
    }
    return { linked, appOnly, qbOnly };
  }, [rows]);

  if (!status?.connected) {
    return (
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-4 flex items-start gap-3">
          <Plug className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-medium text-amber-800">QuickBooks is not connected</div>
            <p className="text-xs text-amber-700 mt-1">
              Connect QuickBooks in{" "}
              <a href="/admin/quickbooks" className="underline font-medium">
                Admin → QuickBooks
              </a>
              {" "}to reconcile invoices against this project's cost lines.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="qb-recon-tab">
      {/* Mode toggle */}
      <div className="flex items-center gap-1.5" data-testid="qb-recon-mode">
        <Button
          size="sm"
          variant={mode === "cost" ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => setMode("cost")}
        >
          Cost Lines ↔ QB Bills
        </Button>
        <Button
          size="sm"
          variant={mode === "revenue" ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => setMode("revenue")}
        >
          Revenue Lines ↔ QB Invoices
        </Button>
        <div className="flex-1" />
        <a
          href="/finance/quickbooks-customer-mapping"
          className="text-[10px] text-muted-foreground underline hover:text-foreground"
        >
          Manage customer mapping
        </a>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">Start date</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">End date</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reconQuery.refetch()}
            disabled={reconQuery.isFetching}
            className="gap-1.5"
          >
            {reconQuery.isFetching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh
          </Button>
          <div className="flex-1" />
          <div className="text-xs text-muted-foreground">
            Project: <span className="font-medium">{projectName}</span>
            {status?.companyName && (
              <>
                {" · "}QB company: <span className="font-medium">{status.companyName}</span>
                {status.sandbox && (
                  <Badge variant="outline" className="ml-1 text-[9px]">Sandbox</Badge>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <SummaryCard label="Linked" value={summary.linkedCount} tone="emerald" />
          <SummaryCard label="Auto exact" value={summary.autoExactCount} tone="green" />
          <SummaryCard label="Auto fuzzy" value={summary.autoFuzzyCount} tone="amber" />
          <SummaryCard label="App only" value={summary.appOnlyCount} tone="sky" />
          <SummaryCard label="QB only" value={summary.qbOnlyCount} tone="purple" />
          <SummaryCard
            label="Variance"
            value={formatCurrency(summary.amountVariance)}
            tone={Math.abs(summary.amountVariance) < 1 ? "green" : "red"}
          />
        </div>
      )}

      {mode === "cost" && reconQuery.isLoading && (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Running reconciliation…
        </div>
      )}

      {mode === "cost" && reconQuery.isError && (
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="p-4 text-xs text-red-700">
            Reconciliation failed:{" "}
            {reconQuery.error instanceof Error ? reconQuery.error.message : "unknown error"}
          </CardContent>
        </Card>
      )}

      {mode === "cost" && reconQuery.data && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            No cost lines or QuickBooks bills found in the selected window.
            Try widening the date range or confirm QuickBooks has data for this period.
          </CardContent>
        </Card>
      )}

      {mode === "cost" && pendingLinkCostLineId !== null && (
        <Card className="border-sky-200 bg-sky-50/40">
          <CardContent className="p-3 text-xs flex items-center gap-2">
            <Link2 className="h-4 w-4 text-sky-600" />
            <span>
              Select a QB-only bill below to link to cost line{" "}
              <span className="font-mono font-semibold">#{pendingLinkCostLineId}</span>.
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={() => setPendingLinkCostLineId(null)}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {mode === "cost" && (<>
      {/* Linked / auto-matched rows */}
      <section>
        <h3 className="text-sm font-semibold mb-2">
          Matched <span className="text-muted-foreground font-normal">({linked.length})</span>
        </h3>
        {linked.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">No matches yet.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Match</th>
                    <th className="px-2 py-1.5 text-left">App invoice</th>
                    <th className="px-2 py-1.5 text-left">Supplier</th>
                    <th className="px-2 py-1.5 text-right">App amount</th>
                    <th className="px-2 py-1.5 text-left">QB invoice</th>
                    <th className="px-2 py-1.5 text-right">QB amount</th>
                    <th className="px-2 py-1.5 text-right">Variance</th>
                    <th className="px-2 py-1.5 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((row, i) => (
                    <tr key={`${row.costLine?.id ?? "x"}-${row.bill?.id ?? "x"}-${i}`} className="border-t">
                      <td className="px-2 py-1.5">
                        <Badge className={`text-[9px] ${matchTypeBadgeClass(row.matchType)}`}>
                          {matchTypeLabel(row.matchType)}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{row.costLine?.invoiceNumber ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(row.costLine?.invoiceDate)} · #{row.costLine?.id}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">{row.costLine?.counterpartyName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.costLine?.amountExVat)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{row.bill?.docNumber ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(row.bill?.txnDate)} · {row.bill?.vendorName ?? ""}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.bill?.totalAmount)}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right font-mono ${row.amountVariance && Math.abs(row.amountVariance) > 1 ? "text-red-600" : ""}`}
                      >
                        {row.amountVariance === null ? "—" : formatCurrency(row.amountVariance)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          {row.matchType !== "linked" && row.costLine && row.bill && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] gap-1"
                              onClick={() =>
                                linkMutation.mutate({
                                  costLineId: row.costLine!.id,
                                  bill: row.bill!,
                                })
                              }
                              disabled={linkMutation.isPending}
                            >
                              <Link2 className="h-3 w-3" /> Confirm
                            </Button>
                          )}
                          {row.matchType === "linked" && row.link && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] gap-1 text-muted-foreground"
                              onClick={() => unlinkMutation.mutate(row.link!.id)}
                              disabled={unlinkMutation.isPending}
                            >
                              <Link2Off className="h-3 w-3" /> Unlink
                            </Button>
                          )}
                          {row.costLine && !row.costLine.cosRealised && row.bill && (
                            <span
                              className="text-[10px] text-muted-foreground italic"
                              title="Marking a cost line as COS-realised is only allowed through the COS Tracker (canonical finance control path)."
                            >
                              Mark in COS Tracker
                            </span>
                          )}
                          {row.costLine?.cosRealised && (
                            <Badge className="text-[9px] bg-emerald-100 text-emerald-700">
                              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Realised
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* App-only */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          App only <Badge variant="outline">{appOnly.length}</Badge>
          <span className="text-[10px] text-muted-foreground font-normal">
            cost lines with no matching QB bill
          </span>
        </h3>
        {appOnly.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">All cost lines have a QB match.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Invoice</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Supplier</th>
                    <th className="px-2 py-1.5 text-left">Description</th>
                    <th className="px-2 py-1.5 text-right">Amount</th>
                    <th className="px-2 py-1.5 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {appOnly.map((row) => (
                    <tr
                      key={row.costLine!.id}
                      className={`border-t ${pendingLinkCostLineId === row.costLine!.id ? "bg-sky-50/60" : ""}`}
                    >
                      <td className="px-2 py-1.5 font-medium">
                        {row.costLine?.invoiceNumber ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">{formatDate(row.costLine?.invoiceDate)}</td>
                      <td className="px-2 py-1.5">{row.costLine?.counterpartyName ?? "—"}</td>
                      <td className="px-2 py-1.5 truncate max-w-[240px]">
                        {row.costLine?.description ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.costLine?.amountExVat)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1"
                          onClick={() =>
                            setPendingLinkCostLineId(
                              pendingLinkCostLineId === row.costLine!.id
                                ? null
                                : row.costLine!.id,
                            )
                          }
                        >
                          <Link2 className="h-3 w-3" /> Link to QB bill
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

      {/* QB-only */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          QB only <Badge variant="outline">{qbOnly.length}</Badge>
          <span className="text-[10px] text-muted-foreground font-normal">
            QB bills with no cost line captured
          </span>
        </h3>
        {qbOnly.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">No unlinked QB bills.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">QB bill #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Vendor</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                    <th className="px-2 py-1.5 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {qbOnly.map((row) => (
                    <tr key={row.bill!.id} className="border-t">
                      <td className="px-2 py-1.5 font-medium">{row.bill?.docNumber ?? "—"}</td>
                      <td className="px-2 py-1.5">{formatDate(row.bill?.txnDate)}</td>
                      <td className="px-2 py-1.5">{row.bill?.vendorName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.bill?.totalAmount)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.bill?.balance)}
                      </td>
                      <td className="px-2 py-1.5">
                        {pendingLinkCostLineId !== null ? (
                          <Button
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            onClick={() =>
                              linkMutation.mutate({
                                costLineId: pendingLinkCostLineId,
                                bill: row.bill!,
                              })
                            }
                            disabled={linkMutation.isPending}
                          >
                            <Link2 className="h-3 w-3" /> Link to #{pendingLinkCostLineId}
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Pick an app-only cost line first
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>
      </>)}

      {mode === "revenue" && (
        <RevenueReconView
          projectId={projectId}
          query={revenueReconQuery}
          onLink={(input) => linkInvoiceMutation.mutate(input)}
          linking={linkInvoiceMutation.isPending}
        />
      )}
    </div>
  );
}

// ===== Revenue mode sub-view =====

function RevenueReconView({
  projectId,
  query,
  onLink,
  linking,
}: {
  projectId: number;
  query: ReturnType<typeof useQuery<RevenueReconciliationResult>>;
  onLink: (input: { revenueLineId: number; invoice: QuickBooksInvoiceSummary }) => void;
  linking: boolean;
}) {
  const [pendingRevId, setPendingRevId] = useState<number | null>(null);
  void projectId;

  if (query.isLoading) {
    return (
      <div className="text-xs text-muted-foreground py-6 text-center">
        Running revenue reconciliation…
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardContent className="p-4 text-xs text-red-700">
          Revenue reconciliation failed:{" "}
          {query.error instanceof Error ? query.error.message : "unknown error"}
        </CardContent>
      </Card>
    );
  }

  const data = query.data;
  if (!data) return null;

  // No customer mapping → CTA.
  if (!data.mapping) {
    return (
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-4 flex items-start gap-3">
          <Link2 className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <div className="font-medium text-amber-800">
              No QuickBooks customer mapped for this project
            </div>
            <p className="text-amber-700 mt-1">
              Map this project to a QB customer to auto-scope invoice reconciliation.
              Until then you'll only see app-side revenue lines (no QB match).
            </p>
            <div className="mt-2">
              <a
                href="/finance/quickbooks-customer-mapping"
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline"
              >
                <Link2 className="h-3 w-3" /> Map a customer
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows;
  const linked: RevenueReconciliationRow[] = [];
  const appOnly: RevenueReconciliationRow[] = [];
  const qbOnly: RevenueReconciliationRow[] = [];
  for (const r of rows) {
    if (r.matchType === "app_only") appOnly.push(r);
    else if (r.matchType === "qb_only") qbOnly.push(r);
    else linked.push(r);
  }
  const summary = data.summary;

  return (
    <div className="space-y-3">
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="p-3 text-xs flex items-center gap-2">
          <Link2 className="h-4 w-4 text-emerald-600" />
          Mapped to QB customer{" "}
          <span className="font-semibold">{data.mapping.qbCustomerName ?? "—"}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            QB #{data.mapping.qbCustomerId}
          </span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <SummaryCard label="Linked" value={summary.linkedCount} tone="emerald" />
        <SummaryCard label="Auto exact" value={summary.autoExactCount} tone="green" />
        <SummaryCard label="Auto fuzzy" value={summary.autoFuzzyCount} tone="amber" />
        <SummaryCard label="App only" value={summary.appOnlyCount} tone="sky" />
        <SummaryCard label="QB only" value={summary.qbOnlyCount} tone="purple" />
        <SummaryCard
          label="Variance"
          value={formatCurrency(summary.amountVariance)}
          tone={Math.abs(summary.amountVariance) < 1 ? "green" : "red"}
        />
      </div>

      {pendingRevId !== null && (
        <Card className="border-sky-200 bg-sky-50/40">
          <CardContent className="p-3 text-xs flex items-center gap-2">
            <Link2 className="h-4 w-4 text-sky-600" />
            <span>
              Select a QB invoice below to link to revenue line{" "}
              <span className="font-mono font-semibold">#{pendingRevId}</span>.
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={() => setPendingRevId(null)}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Matched */}
      <section>
        <h3 className="text-sm font-semibold mb-2">
          Matched <span className="text-muted-foreground font-normal">({linked.length})</span>
        </h3>
        {linked.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">No invoice matches yet.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Match</th>
                    <th className="px-2 py-1.5 text-left">App invoice</th>
                    <th className="px-2 py-1.5 text-left">Milestone</th>
                    <th className="px-2 py-1.5 text-right">App amount</th>
                    <th className="px-2 py-1.5 text-left">QB invoice</th>
                    <th className="px-2 py-1.5 text-right">QB amount</th>
                    <th className="px-2 py-1.5 text-right">Variance</th>
                    <th className="px-2 py-1.5 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((row, i) => (
                    <tr
                      key={`${row.revenueLine?.id ?? "x"}-${row.invoice?.id ?? "x"}-${i}`}
                      className="border-t"
                    >
                      <td className="px-2 py-1.5">
                        <Badge className={`text-[9px] ${matchTypeBadgeClass(row.matchType)}`}>
                          {matchTypeLabel(row.matchType)}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{row.revenueLine?.invoiceNumber ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(row.revenueLine?.invoiceDate)} · #{row.revenueLine?.id}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 truncate max-w-[180px]">
                        {row.revenueLine?.milestoneName ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.revenueLine?.amountExVat)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{row.invoice?.docNumber ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(row.invoice?.txnDate)} · {row.invoice?.customerName ?? ""}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.invoice?.totalAmount)}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right font-mono ${row.amountVariance && Math.abs(row.amountVariance) > 1 ? "text-red-600" : ""}`}
                      >
                        {row.amountVariance === null ? "—" : formatCurrency(row.amountVariance)}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.matchType !== "linked" && row.revenueLine && row.invoice && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1"
                            onClick={() =>
                              onLink({
                                revenueLineId: row.revenueLine!.id,
                                invoice: row.invoice!,
                              })
                            }
                            disabled={linking}
                          >
                            <Link2 className="h-3 w-3" /> Confirm
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* App-only */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          App only <Badge variant="outline">{appOnly.length}</Badge>
          <span className="text-[10px] text-muted-foreground font-normal">
            revenue lines with no matching QB invoice
          </span>
        </h3>
        {appOnly.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">All revenue lines have a QB match.</p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Invoice #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Milestone</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5 text-right">Amount</th>
                    <th className="px-2 py-1.5 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {appOnly.map((row) => (
                    <tr
                      key={row.revenueLine!.id}
                      className={`border-t ${pendingRevId === row.revenueLine!.id ? "bg-sky-50/60" : ""}`}
                    >
                      <td className="px-2 py-1.5 font-medium">
                        {row.revenueLine?.invoiceNumber ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">{formatDate(row.revenueLine?.invoiceDate)}</td>
                      <td className="px-2 py-1.5 truncate max-w-[180px]">
                        {row.revenueLine?.milestoneName ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className="text-[9px]">
                          {row.revenueLine?.status ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.revenueLine?.amountExVat)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1"
                          onClick={() =>
                            setPendingRevId(
                              pendingRevId === row.revenueLine!.id
                                ? null
                                : row.revenueLine!.id,
                            )
                          }
                        >
                          <Link2 className="h-3 w-3" /> Link to QB invoice
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

      {/* QB-only — thanks to the customer mapping, these are legitimate "missing in app" candidates */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          QB only <Badge variant="outline">{qbOnly.length}</Badge>
          <span className="text-[10px] text-muted-foreground font-normal">
            invoices in QuickBooks that aren't captured as app revenue lines
          </span>
        </h3>
        {qbOnly.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">
            No unmatched QB invoices for this customer.
          </p>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">QB invoice #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Customer</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                    <th className="px-2 py-1.5 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {qbOnly.map((row) => (
                    <tr key={row.invoice!.id} className="border-t">
                      <td className="px-2 py-1.5 font-medium">{row.invoice?.docNumber ?? "—"}</td>
                      <td className="px-2 py-1.5">{formatDate(row.invoice?.txnDate)}</td>
                      <td className="px-2 py-1.5">{row.invoice?.customerName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.invoice?.totalAmount)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {formatCurrency(row.invoice?.balance)}
                      </td>
                      <td className="px-2 py-1.5">
                        {pendingRevId !== null ? (
                          <Button
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            onClick={() =>
                              onLink({
                                revenueLineId: pendingRevId,
                                invoice: row.invoice!,
                              })
                            }
                            disabled={linking}
                          >
                            <Link2 className="h-3 w-3" /> Link to #{pendingRevId}
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            Pick an app-only revenue line first
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

// ===== Small summary card =====

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "emerald" | "green" | "amber" | "sky" | "purple" | "red";
}) {
  const toneClass = {
    emerald: "text-emerald-700",
    green: "text-green-700",
    amber: "text-amber-700",
    sky: "text-sky-700",
    purple: "text-purple-700",
    red: "text-red-700",
  }[tone];
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default QuickBooksReconciliationTab;

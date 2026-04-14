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

// ===== Component =====

interface Props {
  projectId: number;
  projectName: string;
}

export function QuickBooksReconciliationTab({ projectId, projectName }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

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
    enabled: !!status?.connected,
  });

  const invalidateRecon = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/quickbooks/projects/cos-reconciliation", projectId],
    });
  };

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

  const markRealisedMutation = useMutation({
    mutationFn: async (costLineId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/cost-lines/${costLineId}/mark-realised`,
      );
      return res.json();
    },
    onSuccess: () => {
      invalidateRecon();
      queryClient.invalidateQueries({ queryKey: ["normalized-cost-lines"] });
      toast({ title: "Cost line marked as COS-realised" });
    },
    onError: (err: Error) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    },
  });

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

      {reconQuery.isLoading && (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Running reconciliation…
        </div>
      )}

      {reconQuery.isError && (
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="p-4 text-xs text-red-700">
            Reconciliation failed:{" "}
            {reconQuery.error instanceof Error ? reconQuery.error.message : "unknown error"}
          </CardContent>
        </Card>
      )}

      {pendingLinkCostLineId !== null && (
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
                            <Button
                              size="sm"
                              className="h-6 text-[10px] gap-1"
                              onClick={() => markRealisedMutation.mutate(row.costLine!.id)}
                              disabled={markRealisedMutation.isPending}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Mark COS
                            </Button>
                          )}
                          {row.costLine?.cosRealised && (
                            <Badge className="text-[9px] bg-emerald-100 text-emerald-700">
                              Realised
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

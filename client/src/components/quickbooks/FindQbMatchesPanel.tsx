/**
 * "Find QB Matches" panel — fuzzy invoice-level linking review UI.
 *
 * Drops into the existing Finance → QuickBooks Bill Linking page (and any
 * other reconciliation surface). Self-contained: pick an app cost / revenue
 * line, click Find QB Matches, review confidence-banded candidates, and
 * approve / reject / manually link.
 *
 * Suggestions never auto-approve — even 100% confidence requires explicit
 * approval. Permission gates are enforced server-side; the UI also disables
 * approve/reject/manual when the API returns 403 so the operator gets a
 * clear "you can review but not approve" experience.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  X,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isApiError } from "@/lib/api-error";
import { formatRand } from "@/lib/safeMoney";

type Scope = "cost" | "revenue";

interface AppCostSearchRow {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  description: string | null;
}

interface AppRevenueSearchRow {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number | null;
  description: string | null;
  milestoneName: string | null;
}

interface ScoredCandidate {
  qbEntityId: string;
  qbEntityType: "bill" | "invoice";
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbCounterpartyName: string | null;
  qbCounterpartyId: string | null;
  qbAmountExVat: number | null;
  qbBalance: number | null;
  qbPaymentStatus: string | null;
  confidence: number;
  reasons: string[];
  warnings: string[];
  qbAlreadyLinkedElsewhere: boolean;
}

interface FindResponse {
  suggestionId: number;
  scope: Scope;
  app: {
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountExVat: number | null;
    counterpartyName: string | null;
    poNumber: string | null;
    projectId: number | null;
  };
  warnings: { no_po: boolean; already_linked: boolean };
  candidates: ScoredCandidate[];
}

const WARNING_LABEL: Record<string, string> = {
  no_po: "Invoice has no PO — red flag",
  already_linked: "App invoice is already linked to a QB doc",
  amount_mismatch: "Amount mismatch",
  vendor_mismatch: "Vendor / customer mismatch",
  vendor_not_matched: "Vendor / customer not matched",
  date_mismatch: "Invoice dates differ",
  qb_already_linked_elsewhere: "QB doc already linked to another app row",
  qb_payment_inconsistent: "QB marks paid but balance is non-zero",
  qb_amount_unknown: "QB document has no amount",
};

function bandColour(confidence: number): string {
  if (confidence >= 90) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (confidence >= 70) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-rose-100 text-rose-700 border-rose-200";
}

function bandLabel(confidence: number): string {
  if (confidence >= 90) return "High";
  if (confidence >= 70) return "Medium";
  return "Low";
}

function paymentStatusBadge(status: string | null): { label: string; cls: string } {
  switch (status) {
    case "paid":
      return { label: "Paid", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    case "partial":
      return { label: "Partial", cls: "bg-amber-100 text-amber-700 border-amber-200" };
    case "unpaid":
      return { label: "Unpaid", cls: "bg-rose-100 text-rose-700 border-rose-200" };
    default:
      return { label: "Unknown", cls: "bg-slate-100 text-slate-600 border-slate-200" };
  }
}

export interface FindQbMatchesPanelProps {
  defaultScope?: Scope;
}

export function FindQbMatchesPanel({ defaultScope = "cost" }: FindQbMatchesPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [appLineSearch, setAppLineSearch] = useState("");
  const [selectedAppLine, setSelectedAppLine] = useState<{
    id: number;
    invoiceNumber: string | null;
    counterpartyName: string | null;
    amountExVat: number | null;
    invoiceDate: string | null;
    projectId: number | null;
  } | null>(null);
  const [findResult, setFindResult] = useState<FindResponse | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [manualQbId, setManualQbId] = useState("");
  const [mapCounterparty, setMapCounterparty] = useState(true);

  // -------- Search the app side (reuses existing endpoints) -------------
  const costSearch = useQuery<{ costLines: AppCostSearchRow[] }>({
    queryKey: ["/api/quickbooks/cost-lines/search", "fuzzy", appLineSearch],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/cost-lines/search?q=${encodeURIComponent(appLineSearch)}&limit=25`,
      );
      return res.json();
    },
    enabled: scope === "cost" && !findResult,
  });

  const revenueSearch = useQuery<{ revenueLines: AppRevenueSearchRow[] }>({
    queryKey: ["/api/quickbooks/revenue-lines/search", "fuzzy", appLineSearch],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/revenue-lines/search?q=${encodeURIComponent(appLineSearch)}&limit=25`,
      );
      return res.json();
    },
    enabled: scope === "revenue" && !findResult,
  });

  const appRows = useMemo(() => {
    if (scope === "cost") {
      return (costSearch.data?.costLines ?? []).map((c) => ({
        id: c.id,
        invoiceNumber: c.invoiceNumber,
        counterpartyName: c.counterpartyName,
        amountExVat: c.amountExVat,
        invoiceDate: c.invoiceDate,
        projectName: c.projectName,
        projectId: c.projectId,
      }));
    }
    return (revenueSearch.data?.revenueLines ?? []).map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      counterpartyName: r.milestoneName,
      amountExVat: r.amountExVat,
      invoiceDate: r.invoiceDate,
      projectName: r.projectName,
      projectId: r.projectId,
    }));
  }, [scope, costSearch.data, revenueSearch.data]);

  // -------- Mutations ----------------------------------------------------

  const findMut = useMutation({
    mutationFn: async (appLineId: number) => {
      const body =
        scope === "cost"
          ? { scope: "cost", costLineId: appLineId }
          : { scope: "revenue", revenueLineId: appLineId };
      const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/find", body);
      return (await res.json()) as FindResponse;
    },
    onSuccess: (data) => setFindResult(data),
    onError: (err: Error) => {
      const description =
        isApiError(err) && err.status === 409
          ? "QuickBooks isn't connected — connect it in Admin → QuickBooks first."
          : err.message;
      toast({ title: "Find matches failed", description, variant: "destructive" });
    },
  });

  const approveMut = useMutation({
    mutationFn: async (vars: {
      suggestionId: number;
      candidateIndex: number;
      notes?: string;
      mapVendor?: boolean;
      mapCustomer?: boolean;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/${vars.suggestionId}/approve`,
        {
          candidateIndex: vars.candidateIndex,
          notes: vars.notes,
          mapVendor: vars.mapVendor,
          mapCustomer: vars.mapCustomer,
        },
      );
      return res.json();
    },
    onSuccess: (data: { linkId: number }) => {
      toast({ title: "Match approved", description: `Link #${data.linkId} created.` });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      setFindResult(null);
      setSelectedAppLine(null);
      setAppLineSearch("");
      setMapCounterparty(true);
    },
    onError: (err: Error) => {
      const isConflict = isApiError(err) && err.status === 409;
      toast({
        title: isConflict ? "Already linked" : "Approve failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const rejectMut = useMutation({
    mutationFn: async (vars: { suggestionId: number; reason: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/${vars.suggestionId}/reject`,
        { reason: vars.reason },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Suggestion rejected" });
      setFindResult(null);
      setRejectReason("");
      setSelectedAppLine(null);
      setAppLineSearch("");
      setMapCounterparty(true);
    },
    onError: (err: Error) => {
      toast({ title: "Reject failed", description: err.message, variant: "destructive" });
    },
  });

  const manualMut = useMutation({
    mutationFn: async (vars: { qbEntityId: string; appEntityId: number }) => {
      const res = await apiRequest("POST", "/api/quickbooks/invoice-matches/manual-link", {
        scope,
        appEntityId: vars.appEntityId,
        qbEntityId: vars.qbEntityId,
        notes: "manual_override via Find QB Matches",
      });
      return res.json();
    },
    onSuccess: (data: { linkId: number }) => {
      toast({ title: "Manual link created", description: `Link #${data.linkId}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      setFindResult(null);
      setManualQbId("");
      setSelectedAppLine(null);
      setAppLineSearch("");
    },
    onError: (err: Error) => {
      const isPerm = isApiError(err) && err.status === 403;
      toast({
        title: isPerm ? "Not allowed" : "Manual link failed",
        description: isPerm
          ? "Manual override requires the financials override permission."
          : err.message,
        variant: "destructive",
      });
    },
  });

  // -------- Render -------------------------------------------------------

  const showSearch = !selectedAppLine && !findResult;
  const showFind = !!selectedAppLine && !findResult;

  return (
    <Card data-testid="panel-find-qb-matches">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Find QB Matches</h3>
          <Badge variant="outline" className="text-[10px] uppercase">
            Fuzzy linking · review &amp; approve
          </Badge>
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant={scope === "cost" ? "default" : "outline"}
              className="h-7 text-[10px]"
              onClick={() => {
                setScope("cost");
                setSelectedAppLine(null);
                setFindResult(null);
              }}
              data-testid="button-scope-cost"
            >
              Cost lines (bills)
            </Button>
            <Button
              size="sm"
              variant={scope === "revenue" ? "default" : "outline"}
              className="h-7 text-[10px]"
              onClick={() => {
                setScope("revenue");
                setSelectedAppLine(null);
                setFindResult(null);
              }}
              data-testid="button-scope-revenue"
            >
              Revenue lines (invoices)
            </Button>
          </div>
        </div>

        {showSearch && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Search className="h-3 w-3 text-muted-foreground" />
              <Input
                placeholder={
                  scope === "cost"
                    ? "Search project / supplier / invoice # / amount"
                    : "Search project / milestone / invoice #"
                }
                value={appLineSearch}
                onChange={(e) => setAppLineSearch(e.target.value)}
                className="h-8 text-xs"
                data-testid="input-find-search"
              />
            </div>
            <div className="overflow-x-auto max-h-72 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Project</th>
                    <th className="px-2 py-1.5 text-left">Invoice #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">
                      {scope === "cost" ? "Supplier" : "Milestone"}
                    </th>
                    <th className="px-2 py-1.5 text-right">Amount ex-VAT</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {appRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">
                        Type to search.
                      </td>
                    </tr>
                  )}
                  {appRows.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-muted/40">
                      <td className="px-2 py-1.5">{row.projectName ?? `#${row.projectId}`}</td>
                      <td className="px-2 py-1.5 font-medium">{row.invoiceNumber ?? "—"}</td>
                      <td className="px-2 py-1.5">{row.invoiceDate ?? "—"}</td>
                      <td className="px-2 py-1.5">{row.counterpartyName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{formatRand(row.amountExVat)}</td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          className="h-6 text-[10px]"
                          disabled={findMut.isPending}
                          data-testid={`button-find-matches-${row.id}`}
                          onClick={() => {
                            setSelectedAppLine({
                              id: row.id,
                              invoiceNumber: row.invoiceNumber,
                              counterpartyName: row.counterpartyName,
                              amountExVat: row.amountExVat,
                              invoiceDate: row.invoiceDate,
                              projectId: row.projectId,
                            });
                            findMut.mutate(row.id);
                          }}
                        >
                          {findMut.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}{" "}
                          Find QB Matches
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showFind && (
          <div className="text-xs text-muted-foreground py-3 flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Searching QuickBooks…
          </div>
        )}

        {findResult && (
          <FindResults
            result={findResult}
            onClose={() => {
              setFindResult(null);
              setSelectedAppLine(null);
              setAppLineSearch("");
              setMapCounterparty(true);
            }}
            onApprove={(candidateIndex) =>
              approveMut.mutate({
                suggestionId: findResult.suggestionId,
                candidateIndex,
                notes: undefined,
                mapVendor: scope === "cost" ? mapCounterparty : undefined,
                mapCustomer: scope === "revenue" ? mapCounterparty : undefined,
              })
            }
            approvePending={approveMut.isPending}
            mapCounterparty={mapCounterparty}
            setMapCounterparty={setMapCounterparty}
            onReject={() => {
              if (!rejectReason.trim()) {
                toast({
                  title: "Reason required",
                  description: "Add a short reason before rejecting.",
                  variant: "destructive",
                });
                return;
              }
              rejectMut.mutate({
                suggestionId: findResult.suggestionId,
                reason: rejectReason.trim(),
              });
            }}
            rejectReason={rejectReason}
            setRejectReason={setRejectReason}
            rejectPending={rejectMut.isPending}
            onManualLink={() => {
              const trimmed = manualQbId.trim();
              if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
                toast({
                  title: "Invalid QB id",
                  description: "QB Bill / Invoice IDs are alphanumeric (with - or _).",
                  variant: "destructive",
                });
                return;
              }
              manualMut.mutate({
                qbEntityId: trimmed,
                appEntityId: findResult.app.id,
              });
            }}
            manualQbId={manualQbId}
            setManualQbId={setManualQbId}
            manualPending={manualMut.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FindResults({
  result,
  onClose,
  onApprove,
  approvePending,
  mapCounterparty,
  setMapCounterparty,
  onReject,
  rejectReason,
  setRejectReason,
  rejectPending,
  onManualLink,
  manualQbId,
  setManualQbId,
  manualPending,
}: {
  result: FindResponse;
  onClose: () => void;
  onApprove: (candidateIndex: number) => void;
  approvePending: boolean;
  mapCounterparty: boolean;
  setMapCounterparty: (b: boolean) => void;
  onReject: () => void;
  rejectReason: string;
  setRejectReason: (s: string) => void;
  rejectPending: boolean;
  onManualLink: () => void;
  manualQbId: string;
  setManualQbId: (s: string) => void;
  manualPending: boolean;
}) {
  const appWarnings: string[] = [];
  if (result.warnings.no_po) appWarnings.push("no_po");
  if (result.warnings.already_linked) appWarnings.push("already_linked");

  return (
    <div className="space-y-3" data-testid="results-find-qb-matches">
      <div className="flex items-start justify-between gap-2 border-b pb-2">
        <div className="text-xs">
          <div className="font-semibold flex items-center gap-2">
            App invoice
            <Badge variant="outline" className="text-[9px] uppercase">
              {result.scope === "cost" ? "Cost" : "Revenue"}
            </Badge>
          </div>
          <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-muted-foreground">
            <span>
              # <span className="font-mono text-foreground">{result.app.invoiceNumber ?? "—"}</span>
            </span>
            <span>
              Date <span className="text-foreground">{result.app.invoiceDate ?? "—"}</span>
            </span>
            <span>
              Amount{" "}
              <span className="text-foreground">{formatRand(result.app.amountExVat)}</span>
            </span>
            <span>
              {result.scope === "cost" ? "Supplier" : "Project"}{" "}
              <span className="text-foreground">{result.app.counterpartyName ?? "—"}</span>
            </span>
            {result.scope === "cost" && (
              <span>
                PO{" "}
                <span className="text-foreground">{result.app.poNumber ?? "—"}</span>
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px]"
          onClick={onClose}
          data-testid="button-close-find-results"
        >
          <X className="h-3 w-3 mr-1" /> Close
        </Button>
      </div>

      {appWarnings.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
          <ul className="list-disc list-inside space-y-0.5">
            {appWarnings.map((w) => (
              <li key={w}>{WARNING_LABEL[w] ?? w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.candidates.some((c) => c.qbCounterpartyId) && (
        <div className="flex items-center gap-2 text-xs text-slate-700" data-testid="mapping-upsert-toggle">
          <Checkbox
            id="map-counterparty"
            checked={mapCounterparty}
            onCheckedChange={(v) => setMapCounterparty(!!v)}
          />
          <label htmlFor="map-counterparty" className="cursor-pointer select-none">
            {result.scope === "cost"
              ? "Update vendor mapping when approving"
              : "Update customer mapping when approving"}
          </label>
        </div>
      )}

      {result.candidates.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-600">
          No QB candidates with any overlap on invoice number, amount or counterparty. Try the
          manual link below if you know the QB id.
        </div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
              <tr>
                <th className="px-2 py-1.5 text-left">Confidence</th>
                <th className="px-2 py-1.5 text-left">QB Doc #</th>
                <th className="px-2 py-1.5 text-left">QB Date</th>
                <th className="px-2 py-1.5 text-left">QB Counterparty</th>
                <th className="px-2 py-1.5 text-right">QB Amount</th>
                <th className="px-2 py-1.5 text-left">Payment</th>
                <th className="px-2 py-1.5 text-left">Reasons / Warnings</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {result.candidates.map((c, i) => {
                const pay = paymentStatusBadge(c.qbPaymentStatus);
                return (
                  <tr
                    key={c.qbEntityId + i}
                    className="border-t hover:bg-muted/30 align-top"
                    data-testid={`row-candidate-${i}`}
                  >
                    <td className="px-2 py-1.5">
                      <Badge className={`text-[10px] ${bandColour(c.confidence)}`}>
                        {c.confidence}% · {bandLabel(c.confidence)}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 font-medium">{c.qbDocNumber ?? c.qbEntityId}</td>
                    <td className="px-2 py-1.5">{c.qbTxnDate ?? "—"}</td>
                    <td className="px-2 py-1.5">{c.qbCounterpartyName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{formatRand(c.qbAmountExVat)}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant="outline" className={`text-[10px] ${pay.cls}`}>
                        {pay.label}
                      </Badge>
                      {c.qbBalance !== null && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Bal {formatRand(c.qbBalance)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <ul className="space-y-0.5">
                        {c.reasons.map((r, idx) => (
                          <li key={`r-${idx}`} className="text-[10px] flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> {r}
                          </li>
                        ))}
                        {c.warnings.map((w, idx) => (
                          <li
                            key={`w-${idx}`}
                            className="text-[10px] flex items-center gap-1 text-amber-800"
                          >
                            <ShieldAlert className="h-3 w-3" /> {WARNING_LABEL[w] ?? w}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-2 py-1.5">
                      <Button
                        size="sm"
                        className="h-6 text-[10px]"
                        disabled={
                          approvePending ||
                          c.qbAlreadyLinkedElsewhere ||
                          result.warnings.already_linked
                        }
                        onClick={() => onApprove(i)}
                        data-testid={`button-approve-${i}`}
                      >
                        {approvePending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Link2 className="h-3 w-3" />
                        )}{" "}
                        Approve
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject + manual-link controls — always visible alongside the table */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded border border-rose-200 bg-rose-50/40 p-3 space-y-2">
          <div className="flex items-center gap-1 text-xs font-medium text-rose-800">
            <ThumbsDown className="h-3.5 w-3.5" /> Reject all suggestions
          </div>
          <Label className="text-[10px] text-rose-900">Reason</Label>
          <Input
            placeholder="e.g. all candidates relate to a different project"
            className="h-7 text-xs"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            data-testid="input-reject-reason"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px]"
            onClick={onReject}
            disabled={rejectPending}
            data-testid="button-reject-suggestion"
          >
            {rejectPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}{" "}
            Record rejection
          </Button>
        </div>

        <div className="rounded border border-sky-200 bg-sky-50/40 p-3 space-y-2">
          <div className="flex items-center gap-1 text-xs font-medium text-sky-800">
            <Link2 className="h-3.5 w-3.5" /> Manual link (override)
          </div>
          <Label className="text-[10px] text-sky-900">QB {result.scope === "cost" ? "Bill" : "Invoice"} Id</Label>
          <Input
            placeholder="e.g. 12345"
            className="h-7 text-xs font-mono"
            value={manualQbId}
            onChange={(e) => setManualQbId(e.target.value)}
            data-testid="input-manual-qb-id"
          />
          <p className="text-[10px] text-sky-900">
            Requires <span className="font-mono">financials:override</span>. The link uses
            authoritative QB data — finance values cannot be edited from here.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px]"
            onClick={onManualLink}
            disabled={manualPending}
            data-testid="button-manual-link"
          >
            {manualPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}{" "}
            Manual link
          </Button>
        </div>
      </div>
    </div>
  );
}

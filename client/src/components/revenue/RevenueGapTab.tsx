import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, fetchQueryFn } from "@/lib/queryClient";
import {
  AlertTriangle,
  Clock,
  Download,
  EyeOff,
  Eye,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  User as UserIcon,
  Trash2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface GapRow {
  bucket: "tracker_gap" | "unmapped_customer" | "unmapped_no_customer" | "matched" | "fuzzy";
  invoiceId: string | null;
  qbLineId: string | null;
  docNumber: string | null;
  txnDate: string | null;
  customerName: string | null;
  lineAmountExVat: number | null;
  classRefName: string | null;
  itemRefName: string | null;
  description: string | null;
  balance: number | null;
  resolvedProjectName: string | null;
  strategy: string;
  matchedFrom: string | null;
  isOverride: boolean;
  isIgnored: boolean;
  ignoreReason: string | null;
  ignoredByName: string | null;
  ignoredAt: string | null;
  closestRevenueLineId: number | null;
}

interface ProjectRollup {
  project: string;
  count: number;
  openCount: number;
  amount: number;
  openAmount: number;
}

interface RevenueProjectSuggestion {
  projectName: string;
  score: number;
  reasons: string[];
}

interface UnmappedCustomer {
  customerName: string;
  count: number;
  amount: number;
  sampleClasses: string[];
  sampleItems: string[];
  suggestions?: RevenueProjectSuggestion[];
}

type GapBucketTab = "tracker_gap" | "unmapped_customer" | "unmapped_no_customer";

function isGapBucketTab(v: string): v is GapBucketTab {
  return v === "tracker_gap" || v === "unmapped_customer" || v === "unmapped_no_customer";
}

interface CustomerOverride {
  id: number;
  customerRefName: string;
  projectName: string;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface RevenueGapResponse {
  generatedAt: string;
  window: { start: string; end: string };
  summary: {
    totalLineRows: number;
    totalAmountExVat: number;
    openTrackerGapCount: number;
    openTrackerGapAmountExVat: number;
    ignoredCount: number;
    ignoredAmountExVat: number;
    projectUniverseSize: number;
    customerOverridesActive: number;
  };
  byBucket: Record<string, { count: number; amount: number; openCount: number; openAmount: number }>;
  byProject: ProjectRollup[];
  unmappedCustomers: UnmappedCustomer[];
  customerOverrides: CustomerOverride[];
  rows: GapRow[];
}

function fmtRand(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "R 0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

function fmtRandExact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "R 0.00";
  return `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function defaultMonthRange(): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  return { start: "2025-09-01", end };
}

function downloadCsv(filename: string, rows: GapRow[]) {
  const headers = [
    "bucket",
    "project",
    "qb_doc_number",
    "qb_invoice_id",
    "qb_line_id",
    "txn_date",
    "customer",
    "amount_ex_vat",
    "class_ref",
    "item_ref",
    "description",
    "balance",
    "strategy",
    "is_override",
    "is_ignored",
    "ignore_reason",
  ];
  const escape = (v: any) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [headers.join(",")]
    .concat(
      rows.map((r) =>
        [
          r.bucket,
          r.resolvedProjectName ?? "",
          r.docNumber,
          r.invoiceId,
          r.qbLineId,
          r.txnDate,
          r.customerName,
          r.lineAmountExVat,
          r.classRefName,
          r.itemRefName,
          r.description,
          r.balance,
          r.strategy,
          r.isOverride ? "yes" : "",
          r.isIgnored ? "yes" : "",
          r.ignoreReason,
        ]
          .map(escape)
          .join(","),
      ),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function RevenueGapTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const initial = defaultMonthRange();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [bucket, setBucket] = useState<GapBucketTab>("tracker_gap");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<RevenueGapResponse>({
    queryKey: ["/api/revenue-tracker/tracker-gap", start, end],
    queryFn: fetchQueryFn(`/api/revenue-tracker/tracker-gap?start=${start}&end=${end}`),
    staleTime: 60_000,
    retry: false,
  });

  const ignoreMutation = useMutation({
    mutationFn: async (row: GapRow) => {
      const reason = window.prompt(
        `Mark this QB invoice as a known non-tracker item?\n\n${row.customerName ?? "(no customer)"} · ${fmtRandExact(row.lineAmountExVat)}\n\nEnter a short reason (e.g. "non-project sale, retainer billing"):`,
      );
      if (!reason || !reason.trim()) throw new Error("cancelled");
      return apiRequest("POST", "/api/revenue-tracker/tracker-gap/ignore", {
        qbInvoiceId: row.invoiceId,
        qbLineId: row.qbLineId,
        qbDocNumber: row.docNumber,
        customerName: row.customerName,
        lineAmountExVat: row.lineAmountExVat,
        resolvedProjectName: row.resolvedProjectName,
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      toast({ title: "Marked as ignored" });
      qc.invalidateQueries({ queryKey: ["/api/revenue-tracker/tracker-gap", start, end] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") {
        toast({ title: "Failed to ignore", description: msg, variant: "destructive" });
      }
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async ({ customerRefName, projectName, note }: { customerRefName: string; projectName: string; note?: string }) => {
      return apiRequest("POST", "/api/revenue-tracker/tracker-gap/customer-override", {
        customerRefName,
        projectName,
        note,
      });
    },
    onSuccess: () => {
      toast({ title: "Customer mapping saved" });
      qc.invalidateQueries({ queryKey: ["/api/revenue-tracker/tracker-gap", start, end] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Failed to save mapping", description: msg, variant: "destructive" });
    },
  });

  const overrideDeleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const reason = window.prompt("Reason for removing this customer→project mapping?\n\nThis will be recorded in the audit log.");
      if (!reason || !reason.trim()) throw new Error("cancelled");
      return apiRequest("DELETE", `/api/revenue-tracker/tracker-gap/customer-override/${id}`, { reason: reason.trim() });
    },
    onSuccess: () => {
      toast({ title: "Mapping removed" });
      qc.invalidateQueries({ queryKey: ["/api/revenue-tracker/tracker-gap", start, end] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") {
        toast({ title: "Failed to remove mapping", description: msg, variant: "destructive" });
      }
    },
  });

  const allProjects = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.rows ?? []) if (r.resolvedProjectName) set.add(r.resolvedProjectName);
    return [...set].sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.filter((r) => {
      if (r.bucket !== bucket) return false;
      if (!showIgnored && r.isIgnored) return false;
      if (projectFilter !== "all" && r.resolvedProjectName !== projectFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [r.customerName, r.docNumber, r.classRefName, r.itemRefName, r.description, r.resolvedProjectName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, bucket, showIgnored, projectFilter, search]);

  const filteredOpenAmount = useMemo(
    () => filteredRows.filter((r) => !r.isIgnored).reduce((a, r) => a + (r.lineAmountExVat ?? 0), 0),
    [filteredRows],
  );

  function handleApplySuggestion(customer: string, projectName: string, reasons: string) {
    if (!window.confirm(`Apply suggestion?\n\nMap QB customer "${customer}" → "${projectName}".\n\nWhy this was suggested:\n${reasons}\n\nThis will be recorded in the audit log.`)) return;
    overrideMutation.mutate({ customerRefName: customer, projectName, note: `Applied suggestion (${reasons})` });
  }

  function handleAddOverride(customer: string, suggestedProject?: string) {
    const projectName = window.prompt(
      `Map QB customer "${customer}" to which project name?\n\nMust match an existing project name exactly (case-insensitive on normalised key).`,
      suggestedProject ?? "",
    );
    if (!projectName || !projectName.trim()) return;
    const note = window.prompt("Reason for this mapping (mandatory — recorded in audit log).\nE.g. 'site lead confirmed' or 'corrected typo of customer'");
    if (!note || !note.trim()) return;
    overrideMutation.mutate({ customerRefName: customer, projectName: projectName.trim(), note: note.trim() });
  }

  return (
    <div className="space-y-3" data-testid="revenue-gap-tab">
      <Card className="shadow-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Start</label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 text-xs w-36" data-testid="input-rev-gap-start" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">End</label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 text-xs w-36" data-testid="input-rev-gap-end" />
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-rev-gap-refresh">
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Refresh</span>
            </Button>
            <div className="flex-1 min-w-[180px] relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search customer, doc#, item…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                data-testid="input-rev-gap-search"
              />
            </div>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="h-8 px-2 border rounded-md bg-background text-xs"
              data-testid="select-rev-gap-project"
            >
              <option value="all">All projects</option>
              {allProjects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => setShowIgnored((v) => !v)} data-testid="button-rev-gap-toggle-ignored">
              {showIgnored ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="ml-1.5">{showIgnored ? "Hide ignored" : "Show ignored"}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadCsv(`revenue-tracker-gap-${bucket}-${start}-${end}.csv`, filteredRows)}
              disabled={!filteredRows.length}
              data-testid="button-rev-gap-csv"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="ml-1.5">CSV</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryCard label="Open Tracker Gap" value={fmtRand(data.summary.openTrackerGapAmountExVat)} sub={`${data.summary.openTrackerGapCount} invoices`} accent="amber" />
          <SummaryCard label="Unmapped Customer" value={fmtRand(data.byBucket.unmapped_customer?.openAmount ?? 0)} sub={`${data.byBucket.unmapped_customer?.openCount ?? 0} invoices`} accent="rose" />
          <SummaryCard label="No Customer Tag" value={fmtRand(data.byBucket.unmapped_no_customer?.openAmount ?? 0)} sub={`${data.byBucket.unmapped_no_customer?.openCount ?? 0} invoices`} accent="slate" />
          <SummaryCard label="Matched (in tracker)" value={fmtRand(data.byBucket.matched?.openAmount ?? 0)} sub={`${data.byBucket.matched?.openCount ?? 0} invoices`} accent="emerald" />
        </div>
      )}

      {isLoading && (
        <Card><CardContent className="p-8 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Pulling QB invoices…</CardContent></Card>
      )}
      {isError && (
        <Card><CardContent className="p-6 text-sm text-destructive">
          Failed to load Revenue Tracker Gap report. This workspace requires the revenue-tracker edit permission and a connected QuickBooks integration.
        </CardContent></Card>
      )}

      {data && (
        <Tabs value={bucket} onValueChange={(v) => { if (isGapBucketTab(v)) setBucket(v); }}>
          <TabsList className="bg-muted/60">
            <TabsTrigger value="tracker_gap" data-testid="tab-rev-bucket-tracker-gap">
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Tracker Gap
              <Badge variant="outline" className="ml-2 text-[10px] border-amber-300 bg-amber-50 text-amber-700">
                {data.byBucket.tracker_gap?.openCount ?? 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="unmapped_customer" data-testid="tab-rev-bucket-unmapped-customer">
              <UserIcon className="h-3.5 w-3.5 mr-1.5" />
              Unmapped Customer
              <Badge variant="outline" className="ml-2 text-[10px] border-rose-300 bg-rose-50 text-rose-700">
                {data.byBucket.unmapped_customer?.openCount ?? 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="unmapped_no_customer" data-testid="tab-rev-bucket-no-customer">
              <X className="h-3.5 w-3.5 mr-1.5" />
              No Customer
              <Badge variant="outline" className="ml-2 text-[10px] border-slate-300 bg-slate-50 text-slate-700">
                {data.byBucket.unmapped_no_customer?.openCount ?? 0}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tracker_gap" className="mt-3 space-y-3">
            {data.byProject.length > 0 && (
              <Card>
                <CardHeader className="py-2 px-3 bg-muted/30 border-b">
                  <CardTitle className="text-xs font-semibold tracking-tight">Gap by Project (open only)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5">Project</th>
                        <th className="text-right px-3 py-1.5">Invoices</th>
                        <th className="text-right px-3 py-1.5">Open Gap (ex-VAT)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byProject.map((p) => (
                        <tr key={p.project} className="border-t border-border/60 hover:bg-muted/20 cursor-pointer" onClick={() => setProjectFilter(p.project)}>
                          <td className="px-3 py-1.5 font-medium">{p.project}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.openCount}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-amber-700">{fmtRandExact(p.openAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            <RowsTable
              rows={filteredRows}
              filteredOpenAmount={filteredOpenAmount}
              onIgnore={(r) => ignoreMutation.mutate(r)}
              showIgnoreAction
            />
          </TabsContent>

          <TabsContent value="unmapped_customer" className="mt-3 space-y-3">
            <Card>
              <CardHeader className="py-2 px-3 bg-muted/30 border-b">
                <CardTitle className="text-xs font-semibold tracking-tight">QB Customers with no project mapping</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead className="bg-muted/20 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-1.5">QB Customer</th>
                      <th className="text-right px-3 py-1.5">Invoices</th>
                      <th className="text-right px-3 py-1.5">Total (ex-VAT)</th>
                      <th className="text-left px-3 py-1.5">Sample classes / items</th>
                      <th className="text-right px-3 py-1.5 w-28">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unmappedCustomers.map((c) => (
                      <tr key={c.customerName} className="border-t border-border/60 hover:bg-muted/20">
                        <td className="px-3 py-1.5 font-medium align-top">{c.customerName}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums align-top">{c.count}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-rose-700 align-top">{fmtRandExact(c.amount)}</td>
                        <td className="px-3 py-1.5 text-muted-foreground align-top">
                          <div>{[...c.sampleClasses, ...c.sampleItems].slice(0, 3).join(" · ") || "—"}</div>
                          {c.suggestions && c.suggestions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {c.suggestions.map((s) => (
                                <button
                                  key={s.projectName}
                                  type="button"
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] hover:bg-emerald-100"
                                  title={s.reasons.join(" · ")}
                                  onClick={() => handleApplySuggestion(c.customerName, s.projectName, s.reasons.join("; "))}
                                  data-testid={`button-suggest-${c.customerName}-${s.projectName}`}
                                >
                                  <Link2 className="h-2.5 w-2.5" /> {s.projectName}
                                  <span className="text-[9px] opacity-70">·{s.score}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right align-top">
                          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => handleAddOverride(c.customerName, c.sampleClasses[0])} data-testid={`button-map-customer-${c.customerName}`}>
                            <Link2 className="h-3 w-3 mr-1" /> Map
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!data.unmappedCustomers.length && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No unmapped customers — every QB customer resolved to a project.</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {data.customerOverrides.length > 0 && (
              <Card>
                <CardHeader className="py-2 px-3 bg-muted/30 border-b">
                  <CardTitle className="text-xs font-semibold tracking-tight">Active customer → project mappings</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5">QB Customer</th>
                        <th className="text-left px-3 py-1.5">→ Project</th>
                        <th className="text-left px-3 py-1.5">Note</th>
                        <th className="text-left px-3 py-1.5">By</th>
                        <th className="text-right px-3 py-1.5 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.customerOverrides.map((o) => (
                        <tr key={o.id} className="border-t border-border/60">
                          <td className="px-3 py-1.5 font-medium">{o.customerRefName}</td>
                          <td className="px-3 py-1.5 text-emerald-700">{o.projectName}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{o.note ?? "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{o.createdByName ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => overrideDeleteMutation.mutate(o.id)} data-testid={`button-rev-remove-mapping-${o.id}`}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="unmapped_no_customer" className="mt-3">
            <RowsTable rows={filteredRows} filteredOpenAmount={filteredOpenAmount} onIgnore={(r) => ignoreMutation.mutate(r)} showIgnoreAction />
          </TabsContent>
        </Tabs>
      )}

      {data && (
        <p className="text-[10px] text-muted-foreground italic">
          Window {data.window.start} → {data.window.end}. Generated {new Date(data.generatedAt).toLocaleString()}. Tracker remains the source of truth — these QB invoices are not auto-inserted into normalized_revenue_lines. Revenue calculation (revenue_recognition_amount) is unchanged.
        </p>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: "amber" | "rose" | "slate" | "emerald" }) {
  const tones: Record<string, string> = {
    amber: "border-amber-200 bg-amber-50/40",
    rose: "border-rose-200 bg-rose-50/40",
    slate: "border-slate-200 bg-slate-50/40",
    emerald: "border-emerald-200 bg-emerald-50/40",
  };
  const valueTones: Record<string, string> = {
    amber: "text-amber-700",
    rose: "text-rose-700",
    slate: "text-slate-700",
    emerald: "text-emerald-700",
  };
  return (
    <Card className={`shadow-sm ${tones[accent]}`}>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold mt-0.5 ${valueTones[accent]}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

interface AuditEvent {
  id: number;
  action: string;
  actorRole: string | null;
  userName: string | null;
  userId: number | null;
  source: string | null;
  changes: Record<string, unknown> | null;
  projectName: string | null;
  createdAt: string;
}

function AuditHistoryDialog({ entityType, entityId, label, onClose }: { entityType: string; entityId: string; label: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ count: number; events: AuditEvent[] }>({
    queryKey: ["/api/revenue-tracker/audit-history", entityType, entityId],
    queryFn: fetchQueryFn(`/api/revenue-tracker/audit-history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`),
    staleTime: 30_000,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Audit history · {label}</DialogTitle>
        </DialogHeader>
        {isLoading && <div className="text-xs text-muted-foreground p-2">Loading…</div>}
        {data && data.count === 0 && <div className="text-xs text-muted-foreground p-2">No audit events recorded for this row.</div>}
        {data && data.count > 0 && (
          <ol className="space-y-2 max-h-[60vh] overflow-y-auto" data-testid="list-audit-history">
            {data.events.map((ev) => (
              <li key={ev.id} className="border border-border rounded-md p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{ev.action}</span>
                  <span className="text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-muted-foreground mt-0.5">{ev.userName ?? "system"} ({ev.actorRole ?? "—"}) · {ev.source ?? "—"}</div>
                {ev.changes && (
                  <pre className="mt-1 text-[10px] bg-muted/40 p-1.5 rounded overflow-x-auto">{JSON.stringify(ev.changes, null, 2)}</pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RowsTable({ rows, filteredOpenAmount, onIgnore, showIgnoreAction }: { rows: GapRow[]; filteredOpenAmount: number; onIgnore: (r: GapRow) => void; showIgnoreAction: boolean }) {
  const [auditTarget, setAuditTarget] = useState<{ entityType: string; entityId: string; label: string } | null>(null);
  return (
    <Card>
      <CardHeader className="py-2 px-3 bg-muted/30 border-b flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-semibold tracking-tight">{rows.length} rows · {fmtRandExact(filteredOpenAmount)} open</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-auto max-h-[60vh]">
        <table className="w-full text-xs">
          <thead className="bg-muted/20 text-muted-foreground sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5">Project</th>
              <th className="text-left px-3 py-1.5">Customer</th>
              <th className="text-left px-3 py-1.5">Date</th>
              <th className="text-left px-3 py-1.5">Doc #</th>
              <th className="text-left px-3 py-1.5">Item</th>
              <th className="text-right px-3 py-1.5">Amount (ex-VAT)</th>
              <th className="text-right px-3 py-1.5">Balance</th>
              <th className="text-left px-3 py-1.5">Strategy</th>
              {showIgnoreAction && <th className="text-right px-3 py-1.5 w-24">Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.invoiceId}-${r.qbLineId ?? i}`} className={`border-t border-border/60 ${r.isIgnored ? "opacity-50" : "hover:bg-muted/20"}`} data-testid={`row-rev-gap-${r.invoiceId}`}>
                <td className="px-3 py-1.5 font-medium">{r.resolvedProjectName ?? <span className="text-muted-foreground italic">unresolved</span>}</td>
                <td className="px-3 py-1.5">{r.customerName ?? "—"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {r.txnDate ?? "—"}
                  {r.txnDate && (
                    <Badge variant="outline" className="ml-1 text-[9px] border-slate-300 bg-slate-50 text-slate-600" title="QB Issue date — used as proxy because QB does not expose a settlement date on invoice line snapshots">
                      issue
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{r.docNumber ?? "—"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.itemRefName ?? r.classRefName ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtRandExact(r.lineAmountExVat)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {r.balance == null ? "—" : r.balance === 0 ? <span className="text-emerald-700">paid</span> : fmtRandExact(r.balance)}
                </td>
                <td className="px-3 py-1.5">
                  <Badge variant="outline" className="text-[10px]">{r.strategy}</Badge>
                  {r.isOverride && <Badge variant="outline" className="ml-1 text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700">override</Badge>}
                  {r.isIgnored && <Badge variant="outline" className="ml-1 text-[10px] border-slate-300 bg-slate-50 text-slate-600">ignored</Badge>}
                </td>
                {showIgnoreAction && (
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 mr-1"
                      title="Audit history"
                      onClick={() => r.invoiceId && setAuditTarget({ entityType: "qb_revenue_recon_ignore", entityId: `${r.invoiceId}:${r.qbLineId ?? "_"}`, label: r.docNumber ?? r.invoiceId })}
                      data-testid={`button-rev-audit-${r.invoiceId}`}
                    >
                      <Clock className="h-3 w-3" />
                    </Button>
                    {!r.isIgnored ? (
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => onIgnore(r)} data-testid={`button-rev-ignore-${r.invoiceId}`}>
                        <EyeOff className="h-3 w-3 mr-1" /> Ignore
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground" title={r.ignoreReason ?? undefined}>{r.ignoredByName ?? "ignored"}</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={showIgnoreAction ? 9 : 8} className="px-3 py-6 text-center text-muted-foreground">No rows match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
      {auditTarget && (
        <AuditHistoryDialog
          entityType={auditTarget.entityType}
          entityId={auditTarget.entityId}
          label={auditTarget.label}
          onClose={() => setAuditTarget(null)}
        />
      )}
    </Card>
  );
}

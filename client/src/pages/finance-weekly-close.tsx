/**
 * Weekly Close — the three close-action views the weekly finance meeting runs.
 *
 * Answer-first: three headline answers up top, then a tab per action. Everything
 * reads from canonical / existing endpoints; the only write is the payment
 * planner's apply, which goes through the existing audited, lock-aware
 * `expense-date-override` endpoint (inside <PaymentPlanner>).
 *
 * Cash ≠ revenue (§ 3.4): the cashflow + AR views are CASH (available, payables,
 * receivables owed) and the missing-invoice view is payables close-prep — none
 * is ever labelled or summed as recognised revenue.
 *
 *   1. Cashflow planner — "available this week" + what-if move-a-payment (R5).
 *   2. AR schedule      — overdue receivables (invoice raised, receipt-date
 *                         passed, unpaid, value > 0), sortable by age.
 *   3. Missing invoices — committed / expected costs with no captured invoice,
 *                         per project, with a derived chase urgency.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { FinanceShell } from "@/components/layout/FinanceShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/finance/KpiTile";
import { Money } from "@/components/ui/money";
import { PaymentPlanner } from "@/components/cashflow/payment-planner";
import { fetchQueryFn } from "@/lib/queryClient";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import { usePermission } from "@/hooks/use-permissions";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpDown,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileWarning,
  Loader2,
  Wallet,
} from "lucide-react";

// ── Shapes (subsets of existing endpoints) ────────────────────────────────────

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  availablePayment: number;
  hasAvailPayOverride: boolean;
}

interface OverdueRow {
  kind: "ar" | "ap";
  id: number;
  projectId: number;
  projectName: string;
  party: string;
  amount: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  status: string;
  bucket: string;
}
interface OverdueResponse { rows: OverdueRow[]; count: number }

type ChaseStatus = "overdue" | "due" | "scheduled";
interface MissingInvoiceRow {
  lineId: number;
  costLineId: number;
  projectId: number;
  projectName: string | null;
  category: string | null;
  description: string | null;
  poNumber: string | null;
  expectedAmount: number;
  forecastPaymentDate: string | null;
  daysOverdue: number;
  chase: ChaseStatus;
}
interface MissingInvoiceResponse {
  generatedAt: string;
  lines: MissingInvoiceRow[];
  summary: { total: number; value: number; overdue: number; due: number; scheduled: number; projects: number };
}

const todayIso = new Date().toISOString().slice(0, 10);

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? weekStart
    : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

// ── Chase + age badges (colour-blind-safe: icon + word, P4.1 tokens) ──────────

function ChaseBadge({ chase, daysOverdue }: { chase: ChaseStatus; daysOverdue: number }) {
  if (chase === "overdue") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-status-adverse/40 bg-status-adverse/10 text-status-adverse">
        <AlertOctagon className="h-3 w-3" aria-hidden="true" /> Chase{daysOverdue > 0 ? ` · ${daysOverdue}d` : ""}
      </Badge>
    );
  }
  if (chase === "due") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-status-drift/40 bg-status-drift/10 text-status-drift">
        <Clock className="h-3 w-3" aria-hidden="true" /> Due soon
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] border-border bg-muted/40 text-muted-foreground">
      <CalendarDays className="h-3 w-3" aria-hidden="true" /> Scheduled
    </Badge>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FinanceWeeklyClosePage() {
  const fyScope = useFinancialYearScope();
  const cashflowEdit = usePermission("cashflow", "edit");
  const [tab, setTab] = useState<"cashflow" | "ar" | "missing">("cashflow");
  const [arSortDesc, setArSortDesc] = useState(true);

  const cashflowQuery = useQuery<{ weeks: CashflowWeek[] }>({
    queryKey: ["/api/weekly-cashflow", "weekly-close"],
    queryFn: fetchQueryFn("/api/weekly-cashflow"),
    staleTime: 60_000,
  });
  const arQuery = useQuery<OverdueResponse>({
    queryKey: ["/api/finance/analysis/cashflow/overdue", "ar"],
    queryFn: fetchQueryFn("/api/finance/analysis/cashflow/overdue?mode=expected_date&side=ar"),
    staleTime: 60_000,
  });
  const missingQuery = useQuery<MissingInvoiceResponse>({
    queryKey: ["/api/cos-line-review/missing-invoices"],
    queryFn: fetchQueryFn("/api/cos-line-review/missing-invoices"),
    staleTime: 60_000,
  });

  const currentWeek = useMemo(() => {
    const weeks = cashflowQuery.data?.weeks ?? [];
    return (
      weeks.find((w) => w.weekStart <= todayIso && todayIso < w.weekEnd) ??
      weeks.find((w) => w.weekStart <= todayIso) ??
      null
    );
  }, [cashflowQuery.data]);

  const arRows = useMemo(() => {
    const rows = (arQuery.data?.rows ?? []).filter((r) => r.kind === "ar");
    return [...rows].sort((a, b) =>
      arSortDesc ? b.daysOverdue - a.daysOverdue : a.daysOverdue - b.daysOverdue,
    );
  }, [arQuery.data, arSortDesc]);
  const arTotal = useMemo(() => arRows.reduce((s, r) => s + (r.amount || 0), 0), [arRows]);

  const missing = missingQuery.data;

  return (
    <FinanceShell>
      <div className="space-y-4" data-testid="finance-weekly-close">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <CalendarClock className="h-5 w-5 text-brand-green" aria-hidden="true" />
            Weekly Close
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            The three close actions: pay the right things this week, chase what we're owed, and find
            the supplier invoices we're missing. Cash and revenue are kept separate.
          </p>
        </div>

        {/* The three answers */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="weekly-close-answers">
          <KpiTile
            data-testid="answer-available-this-week"
            label="Cash available this week"
            description={currentWeek ? `Week of ${weekLabel(currentWeek.weekStart)}` : undefined}
            value={currentWeek ? <Money value={currentWeek.availablePayment} /> : cashflowQuery.isLoading ? "…" : "—"}
            tone={currentWeek ? (currentWeek.availablePayment >= 0 ? "positive" : "critical") : "default"}
            supporting={currentWeek?.hasAvailPayOverride ? "Manual override in effect" : "Opening + inflows − outflows"}
            onClick={() => setTab("cashflow")}
          />
          <KpiTile
            data-testid="answer-overdue-ar"
            label="Owed to us · overdue"
            description="Receivables (cash in)"
            value={arQuery.data ? <Money value={arTotal} /> : arQuery.isLoading ? "…" : "—"}
            tone={arRows.length > 0 ? "warning" : "positive"}
            supporting={arQuery.data ? `${arRows.length} invoice${arRows.length === 1 ? "" : "s"} past due` : undefined}
            onClick={() => setTab("ar")}
          />
          <KpiTile
            data-testid="answer-missing-invoices"
            label="Missing supplier invoices"
            description="Committed / expected, no invoice"
            value={missing ? <Money value={missing.summary.value} /> : missingQuery.isLoading ? "…" : "—"}
            tone={missing && missing.summary.overdue > 0 ? "warning" : "default"}
            supporting={missing ? `${missing.summary.total} line${missing.summary.total === 1 ? "" : "s"} · ${missing.summary.overdue} to chase` : undefined}
            onClick={() => setTab("missing")}
          />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="cashflow" className="gap-1.5" data-testid="tab-cashflow">
              <Wallet className="h-3.5 w-3.5" /> Cashflow planner
            </TabsTrigger>
            <TabsTrigger value="ar" className="gap-1.5" data-testid="tab-ar">
              <CheckCircle2 className="h-3.5 w-3.5" /> AR schedule
            </TabsTrigger>
            <TabsTrigger value="missing" className="gap-1.5" data-testid="tab-missing">
              <FileWarning className="h-3.5 w-3.5" /> Missing invoices
            </TabsTrigger>
          </TabsList>

          {/* 1 — Cashflow planner (R5). Self-contained; what-if stays local until applied. */}
          <TabsContent value="cashflow" className="mt-3">
            <PaymentPlanner fyScope={fyScope} selectedProjects={[]} canEdit={cashflowEdit.allowed} />
          </TabsContent>

          {/* 2 — AR schedule (overdue receivables), sortable by age. */}
          <TabsContent value="ar" className="mt-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="text-sm">
                  Overdue receivables
                  <span className="ml-2 font-normal text-muted-foreground">
                    invoice raised · receipt date passed · unpaid
                  </span>
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">{arRows.length}</Badge>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {arQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : arQuery.isError ? (
                  <p className="py-8 text-center text-sm text-status-adverse">Could not load the AR schedule.</p>
                ) : arRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No overdue receivables. 🎉</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => setArSortDesc((d) => !d)}
                            data-testid="ar-sort-age"
                            title="Sort by overdue age"
                          >
                            Days overdue <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {arRows.slice(0, 200).map((r) => (
                        <TableRow key={`ar-${r.id}`} data-testid={`ar-row-${r.id}`}>
                          <TableCell className="font-medium">{r.projectName}</TableCell>
                          <TableCell className="text-muted-foreground">{r.party}</TableCell>
                          <TableCell className="font-mono text-xs">{r.invoiceNumber ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.dueDate ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono"><Money value={r.amount} /></TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="border-status-adverse/40 bg-status-adverse/10 text-status-adverse">
                              {r.daysOverdue}d
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3 — Missing supplier invoices, per project, with derived chase urgency. */}
          <TabsContent value="missing" className="mt-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="text-sm">
                  Missing supplier invoices
                  <span className="ml-2 font-normal text-muted-foreground">
                    committed / expected cost, no invoice captured
                  </span>
                </CardTitle>
                {missing && (
                  <span className="text-xs text-muted-foreground">
                    {missing.summary.total} across {missing.summary.projects} project{missing.summary.projects === 1 ? "" : "s"}
                  </span>
                )}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {missingQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : missingQuery.isError ? (
                  <p className="py-8 text-center text-sm text-status-adverse">Could not load missing invoices.</p>
                ) : !missing || missing.lines.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No missing supplier invoices. 🎉</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>PO</TableHead>
                        <TableHead>Expected pay</TableHead>
                        <TableHead className="text-right">Expected amount</TableHead>
                        <TableHead className="text-right">Chase</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {missing.lines.slice(0, 300).map((r) => (
                        <TableRow key={r.lineId} data-testid={`missing-invoice-row-${r.lineId}`}>
                          <TableCell className="font-medium">{r.projectName ?? "—"}</TableCell>
                          <TableCell className="max-w-[260px] truncate text-muted-foreground" title={r.description ?? undefined}>
                            {r.description ?? r.category ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.poNumber ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.forecastPaymentDate ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono"><Money value={r.expectedAmount} /></TableCell>
                          <TableCell className="text-right">
                            <ChaseBadge chase={r.chase} daysOverdue={r.daysOverdue} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  Chase urgency is derived from the expected payment date (no chase state is stored).
                  This is a payables close-prep list — not recognised revenue.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </FinanceShell>
  );
}

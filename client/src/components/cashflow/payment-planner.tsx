/**
 * R5 — Payment planner.
 *
 * A what-if tool that lets Finance tentatively move expense PAYMENT dates in
 * local React state and watch weekly cash-outflow totals re-bucket, then Apply
 * the moves through the EXISTING date-override endpoint
 * (`POST /api/weekly-cashflow/expense-date-override`). No finance calculation is
 * re-implemented here: payables (and their effective payment date) come straight
 * from the canonical `/api/weekly-cashflow/detail` endpoint, and persistence goes
 * only through the existing override route.
 *
 * Accessibility (HARD rule): status is never conveyed by colour alone — every
 * delta pairs a colour with an icon AND a text label.
 */
import { useMemo, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, parseISO, startOfWeek, addWeeks, addDays } from 'date-fns';
import {
  ArrowUp,
  ArrowDown,
  ArrowRight,
  CalendarClock,
  Loader2,
  Lock,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { formatZar, formatZarAriaLabel } from '@/lib/currency';
import type { FinancialYearScope } from '@/hooks/use-financial-year-scope';

const CASHFLOW_API_BASE = '/api/weekly-cashflow';
// How many ISO weeks (including the current one) the planner forecasts.
const PLANNER_WEEKS = 8;

/**
 * Outflow row shape returned by `/api/weekly-cashflow/detail`. `expenseId` is the
 * cost-line id used by the override endpoint; `expensePaymentDate` is the
 * EFFECTIVE payment date the server already resolves
 * (adminDateOverride ?? forecast ?? paid).
 */
interface PlannerOutflow {
  expenseId: number;
  projectName: string;
  expenseCategory: string;
  expenseLineItem: string;
  expensePaymentDate: string | null;
  expenseActualTotal: number;
  hasAdminOverride: boolean;
  adminDateOverrideReason: string | null;
  supplierName?: string | null;
}

interface DetailResponse {
  outflows?: PlannerOutflow[];
  inflows?: unknown;
}

/** Date-only ISO (YYYY-MM-DD) for the Monday that starts `date`'s ISO week. */
function isoWeekStart(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** The next `PLANNER_WEEKS` ISO week-start dates, beginning with this week. */
function buildWeekStarts(): string[] {
  const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
  return Array.from({ length: PLANNER_WEEKS }, (_, i) =>
    format(addWeeks(thisWeek, i), 'yyyy-MM-dd'),
  );
}

/** Bucket the ISO week start a date-only string belongs to, or null if unparseable. */
function weekStartForDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    return isoWeekStart(parseISO(iso));
  } catch {
    return null;
  }
}

function weekLabel(weekStart: string): string {
  try {
    const start = parseISO(weekStart);
    const end = addDays(start, 6);
    return `${format(start, 'dd MMM')} – ${format(end, 'dd MMM')}`;
  } catch {
    return weekStart;
  }
}

function Rand({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <span className={className} aria-label={formatZarAriaLabel(value)}>
      {formatZar(value)}
    </span>
  );
}

const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason (at least 3 characters).'),
});
type ReasonForm = z.infer<typeof reasonSchema>;

interface ApplyLineResult {
  expenseId: number;
  ok: boolean;
  locked: boolean;
  message?: string;
}

async function postExpenseDateOverride(body: {
  expenseId: number;
  dateOverride: string;
  reason: string;
}): Promise<ApplyLineResult> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const csrfToken = document.cookie
    .split('; ')
    .find((c) => c.startsWith('csrf-token='))
    ?.split('=')[1];
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`${CASHFLOW_API_BASE}/expense-date-override`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return { expenseId: body.expenseId, ok: false, locked: false, message: 'Network error' };
  }
  if (res.ok) return { expenseId: body.expenseId, ok: true, locked: false };
  const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  // 423 = period locked. Surface the server's lock message and keep the line pending.
  return {
    expenseId: body.expenseId,
    ok: false,
    locked: res.status === 423,
    message: json.message || json.error || `Failed (${res.status})`,
  };
}

export function PaymentPlanner({
  fyScope,
  selectedProjects,
  canEdit,
}: {
  fyScope: FinancialYearScope;
  selectedProjects: string[];
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Record<number, string>>({});
  const [lockMessages, setLockMessages] = useState<Record<number, string>>({});
  const [applyOpen, setApplyOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const weekStarts = useMemo(() => buildWeekStarts(), []);
  const projectParam = selectedProjects.length > 0 ? selectedProjects.join(',') : undefined;

  // Reuse the canonical detail endpoint for each upcoming ISO week. No finance
  // calc is duplicated — outflows (incl. effective payment date) come from the
  // server. One query per week so React Query caches/invalidates each week the
  // same way the in-page DetailRow does.
  const weekQueries = useQueries({
    queries: weekStarts.map((weekStart) => ({
      queryKey: [`${CASHFLOW_API_BASE}/detail`, weekStart, projectParam ?? 'all', fyScope.apiQueryString],
      queryFn: async (): Promise<DetailResponse> => {
        const params = new URLSearchParams({ week: weekStart });
        params.set('fy', fyScope.allData ? 'all' : String(fyScope.fy));
        if (projectParam) params.set('project', projectParam);
        const token = localStorage.getItem('auth_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${CASHFLOW_API_BASE}/detail?${params.toString()}`, {
          credentials: 'include',
          headers,
        });
        if (!res.ok) throw new Error('Failed to fetch cashflow detail');
        return res.json();
      },
    })),
  });

  const isLoading = weekQueries.some((q) => q.isLoading);

  // Merge outflows across the fetched weeks, deduped by expenseId. A line can
  // legitimately appear in only one week (its effective date), but if an
  // override has already shifted it we still want a single canonical row.
  const payables = useMemo(() => {
    const byId = new Map<number, PlannerOutflow>();
    for (const q of weekQueries) {
      for (const o of q.data?.outflows ?? []) {
        if (!Number.isFinite(o.expenseId)) continue;
        if (!byId.has(o.expenseId)) byId.set(o.expenseId, o);
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      const da = a.expensePaymentDate ?? '';
      const db = b.expensePaymentDate ?? '';
      return da.localeCompare(db);
    });
    // weekQueries identity changes every render; depend on the data payloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekQueries.map((q) => q.dataUpdatedAt).join(',')]);

  // Effective date for a payable under the tentative plan.
  const plannedDate = (p: PlannerOutflow): string | null => pending[p.expenseId] ?? p.expensePaymentDate;

  const currentWeekStart = weekStarts[0];
  const payingThisWeek = useMemo(
    () => payables.filter((p) => weekStartForDate(p.expensePaymentDate) === currentWeekStart),
    [payables, currentWeekStart],
  );
  const payingThisWeekTotal = payingThisWeek.reduce((s, p) => s + (p.expenseActualTotal || 0), 0);

  // Weekly outflow totals: CURRENT (server effective date) vs PLAN (tentative).
  const weekBuckets = useMemo(() => {
    const current: Record<string, number> = {};
    const plan: Record<string, number> = {};
    for (const ws of weekStarts) {
      current[ws] = 0;
      plan[ws] = 0;
    }
    for (const p of payables) {
      const amt = p.expenseActualTotal || 0;
      const curWs = weekStartForDate(p.expensePaymentDate);
      if (curWs && curWs in current) current[curWs] += amt;
      const planWs = weekStartForDate(plannedDate(p));
      if (planWs && planWs in plan) plan[planWs] += amt;
    }
    return weekStarts.map((ws) => ({
      weekStart: ws,
      current: current[ws],
      plan: plan[ws],
      delta: plan[ws] - current[ws],
    }));
    // plannedDate closes over `pending`; recompute when payables or pending change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payables, pending, weekStarts]);

  const pendingCount = Object.keys(pending).length;

  const setPayableDate = (expenseId: number, value: string, originalDate: string | null) => {
    setPending((prev) => {
      const next = { ...prev };
      // Clearing the input, or setting it back to the original, drops the change.
      if (!value || value === (originalDate ?? '')) {
        delete next[expenseId];
      } else {
        next[expenseId] = value;
      }
      return next;
    });
    // Editing a line clears any stale lock message for it.
    setLockMessages((prev) => {
      if (!(expenseId in prev)) return prev;
      const next = { ...prev };
      delete next[expenseId];
      return next;
    });
  };

  const discardChanges = () => {
    setPending({});
    setLockMessages({});
  };

  const form = useForm<ReasonForm>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  });

  const runApply = async (values: ReasonForm) => {
    const entries = Object.entries(pending) as Array<[string, string]>;
    if (entries.length === 0) return;
    setIsApplying(true);
    const succeeded: number[] = [];
    const nextLocks: Record<number, string> = {};
    const otherFailures: string[] = [];

    // Sequential — one POST per changed line, collecting per-line results so a
    // single locked period doesn't lose the rest of the pending plan.
    for (const [idStr, dateOverride] of entries) {
      const expenseId = Number(idStr);
      const result = await postExpenseDateOverride({
        expenseId,
        dateOverride,
        reason: values.reason.trim(),
      });
      if (result.ok) {
        succeeded.push(expenseId);
      } else if (result.locked) {
        nextLocks[expenseId] = result.message ?? 'This period is locked.';
      } else {
        otherFailures.push(result.message ?? `Line ${expenseId} failed.`);
      }
    }

    setIsApplying(false);

    // Clear successful lines from the pending map; keep locked/failed pending.
    if (succeeded.length > 0) {
      setPending((prev) => {
        const next = { ...prev };
        for (const id of succeeded) delete next[id];
        return next;
      });
    }
    setLockMessages(nextLocks);

    const lockedCount = Object.keys(nextLocks).length;
    const failedCount = otherFailures.length;

    if (succeeded.length > 0) {
      // Date overrides change which week a line buckets into — refresh the
      // cashflow series and the per-week detail caches the planner reads.
      queryClient.invalidateQueries({ queryKey: [CASHFLOW_API_BASE] });
      queryClient.invalidateQueries({ queryKey: [`${CASHFLOW_API_BASE}/detail`] });
    }

    if (lockedCount === 0 && failedCount === 0) {
      toast({
        title: 'Payment dates updated',
        description: `${succeeded.length} payment${succeeded.length === 1 ? '' : 's'} rescheduled.`,
      });
      form.reset();
      setApplyOpen(false);
    } else {
      // Keep the dialog open so the user sees which lines still need attention.
      const parts: string[] = [];
      if (succeeded.length > 0)
        parts.push(`${succeeded.length} saved`);
      if (lockedCount > 0) parts.push(`${lockedCount} in a locked period`);
      if (failedCount > 0) parts.push(`${failedCount} failed`);
      toast({
        title: 'Some payments could not be moved',
        description: `${parts.join(', ')}. Locked lines stay pending — see the highlighted rows.`,
        variant: 'destructive',
      });
      if (succeeded.length > 0) form.reset();
    }
  };

  return (
    <Card
      className="border border-border shadow-sm rounded-xl overflow-hidden"
      data-testid="card-payment-planner"
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Payment planner
          {pendingCount > 0 && (
            <Badge
              variant="outline"
              className="ml-1 gap-1 border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-medium"
              data-testid="planner-pending-count"
            >
              {pendingCount} pending change{pendingCount === 1 ? '' : 's'}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Move expense payment dates to smooth weekly cash outflows. Changes stay local until you
          apply them — applying writes a date override (with a reason) per line.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-10">
            <Loader2 className="h-4 w-4 animate-spin" data-testid="planner-spinner" />
            <span className="text-sm">Loading payables…</span>
          </div>
        ) : (
          <>
            {/* 1) Paying this week */}
            <section data-testid="planner-paying-this-week">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                  Paying this week
                  <span className="font-normal text-muted-foreground normal-case">
                    ({weekLabel(currentWeekStart)})
                  </span>
                </h3>
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-700"
                  data-testid="planner-paying-this-week-total"
                >
                  <ArrowDown className="h-3 w-3" aria-hidden="true" />
                  <span>Out this week:</span>
                  <Rand value={payingThisWeekTotal} />
                </span>
              </div>
              {payingThisWeek.length === 0 ? (
                <EmptyState
                  icon={Wallet}
                  title="Nothing due this week"
                  description="No expense payments fall in the current week. Use the planner below to pull a future payment forward, or wait for the next week."
                  className="my-2"
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table
                    className="w-full text-xs border-collapse"
                    data-testid="planner-paying-this-week-table"
                  >
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                          Project / Supplier
                        </th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                          Description
                        </th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                          Date
                        </th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payingThisWeek.map((p) => (
                        <tr
                          key={p.expenseId}
                          className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                          data-testid={`planner-due-row-${p.expenseId}`}
                        >
                          <td className="px-3 py-2 font-medium text-foreground">
                            {p.projectName}
                            {p.supplierName ? (
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                {p.supplierName}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {p.expenseLineItem || p.expenseCategory || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground text-[11px]">
                            {p.expensePaymentDate
                              ? format(parseISO(p.expensePaymentDate), 'dd MMM yyyy')
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-red-700">
                            <Rand value={p.expenseActualTotal} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 2) Weekly outflow totals: current vs plan */}
            <section data-testid="planner-weekly-totals">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                Weekly outflows — current vs plan
              </h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs border-collapse" data-testid="planner-weeks-table">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Week</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                        Current
                      </th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Plan</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                        Change
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekBuckets.map((b) => {
                      const isCurrent = b.weekStart === currentWeekStart;
                      const rounded = Math.round(b.delta);
                      return (
                        <tr
                          key={b.weekStart}
                          className={`border-b border-border last:border-0 ${
                            isCurrent ? 'bg-emerald-50/40' : ''
                          }`}
                          data-testid={`planner-week-row-${b.weekStart}`}
                        >
                          <td className="px-3 py-2 font-medium text-foreground">
                            {weekLabel(b.weekStart)}
                            {isCurrent && (
                              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                                NOW
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            <Rand value={b.current} />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-foreground">
                            <Rand value={b.plan} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <DeltaPill delta={rounded} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 3) What-if planner — per-row date editing */}
            <section data-testid="planner-whatif">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Move a payment
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={discardChanges}
                    disabled={pendingCount === 0}
                    data-testid="planner-discard"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Discard changes
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => setApplyOpen(true)}
                    disabled={!canEdit || pendingCount === 0}
                    title={
                      !canEdit
                        ? 'You have read-only access to cashflow.'
                        : pendingCount === 0
                          ? 'Move a payment date first.'
                          : undefined
                    }
                    data-testid="planner-apply"
                  >
                    Apply {pendingCount > 0 ? `(${pendingCount})` : ''}
                  </Button>
                </div>
              </div>
              {payables.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="No upcoming payments to plan"
                  description={`No expense payments fall in the next ${PLANNER_WEEKS} weeks for this scope. Adjust the project filter or the financial-year scope above.`}
                  className="my-2"
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs border-collapse" data-testid="planner-edit-table">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                          Project / Supplier
                        </th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                          Description
                        </th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                          Amount
                        </th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                          Current date
                        </th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                          New date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payables.map((p) => {
                        const changed = p.expenseId in pending;
                        const lockMsg = lockMessages[p.expenseId];
                        return (
                          <tr
                            key={p.expenseId}
                            className={`border-b border-border last:border-0 transition-colors ${
                              lockMsg
                                ? 'bg-red-50/60'
                                : changed
                                  ? 'bg-amber-50/50'
                                  : 'hover:bg-muted/40'
                            }`}
                            data-testid={`planner-edit-row-${p.expenseId}`}
                          >
                            <td className="px-3 py-2 font-medium text-foreground align-top">
                              {p.projectName}
                              {p.supplierName ? (
                                <span className="block text-[11px] font-normal text-muted-foreground">
                                  {p.supplierName}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground align-top">
                              {p.expenseLineItem || p.expenseCategory || '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-red-700 align-top">
                              <Rand value={p.expenseActualTotal} />
                            </td>
                            <td className="px-3 py-2 font-mono text-muted-foreground text-[11px] align-top">
                              {p.expensePaymentDate
                                ? format(parseISO(p.expensePaymentDate), 'dd MMM yyyy')
                                : '—'}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <div className="flex items-center gap-2">
                                <Input
                                  type="date"
                                  value={pending[p.expenseId] ?? p.expensePaymentDate ?? ''}
                                  onChange={(e) =>
                                    setPayableDate(p.expenseId, e.target.value, p.expensePaymentDate)
                                  }
                                  disabled={!canEdit}
                                  className="h-7 w-[9.5rem] text-xs font-mono"
                                  aria-label={`New payment date for ${p.projectName} ${
                                    p.expenseLineItem || p.expenseCategory || ''
                                  }`}
                                  data-testid={`planner-date-input-${p.expenseId}`}
                                />
                                {changed && !lockMsg && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700"
                                    data-testid={`planner-row-pending-${p.expenseId}`}
                                  >
                                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                    Pending
                                  </span>
                                )}
                              </div>
                              {lockMsg && (
                                <p
                                  className="mt-1 inline-flex items-start gap-1 text-[10px] font-medium text-red-700"
                                  data-testid={`planner-row-locked-${p.expenseId}`}
                                >
                                  <Lock className="h-3 w-3 mt-px shrink-0" aria-hidden="true" />
                                  <span>{lockMsg}</span>
                                </p>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>

      {/* Apply dialog — single reason for all moves */}
      <Dialog
        open={applyOpen}
        onOpenChange={(v) => {
          if (isApplying) return;
          setApplyOpen(v);
          if (!v) form.reset();
        }}
      >
        <DialogContent className="max-w-md" data-testid="planner-apply-dialog">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Apply payment moves</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              {pendingCount} payment{pendingCount === 1 ? '' : 's'} will be rescheduled. One reason is
              recorded against every move (audit trail). Lines in a locked period stay pending.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(runApply)} className="space-y-4">
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Smooth week-3 outflow against expected client receipt"
                        autoFocus
                        data-testid="planner-apply-reason"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setApplyOpen(false);
                    form.reset();
                  }}
                  disabled={isApplying}
                  data-testid="planner-apply-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isApplying || pendingCount === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  data-testid="planner-apply-confirm"
                >
                  {isApplying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      Applying…
                    </>
                  ) : (
                    `Apply ${pendingCount} move${pendingCount === 1 ? '' : 's'}`
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Per-week delta indicator. HARD accessibility rule: colour is always paired
 * with an icon AND a text label.
 *  - increase → red + ArrowUp + "+R …"
 *  - decrease → emerald + ArrowDown + "-R …"
 *  - no change → neutral + dash
 */
function DeltaPill({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
        data-testid="planner-delta-none"
      >
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
        No change
      </span>
    );
  }
  const increase = delta > 0;
  const Icon = increase ? ArrowUp : ArrowDown;
  const label = `${increase ? '+' : '-'}${formatZar(Math.abs(delta))}`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
        increase
          ? 'bg-red-50 text-red-700 border border-red-200'
          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      }`}
      title={increase ? 'More cash out this week' : 'Less cash out this week'}
      aria-label={`${increase ? 'Increase' : 'Decrease'} of ${formatZarAriaLabel(Math.abs(delta))}`}
      data-testid={increase ? 'planner-delta-up' : 'planner-delta-down'}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

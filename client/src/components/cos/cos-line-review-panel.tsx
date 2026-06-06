import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, fetchQueryFn } from '@/lib/queryClient';
import { formatZar, formatZarAriaLabel } from '@/lib/currency';
import { ApiError } from '@/lib/api-error';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Inbox,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  TrendingUp,
  Trash2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Response types — mirror GET /api/cos-line-review exactly so we never `as any`.
// ---------------------------------------------------------------------------

interface LineReviewFlags {
  allocationMissing: boolean;
  poMismatch: boolean;
  poDelta: number | null;
  anomaly: boolean;
  anomalyFactor: number | null;
  flagged: boolean;
}

interface LineReviewRow {
  lineId: number;
  costLineId: number;
  projectId: number | null;
  projectName: string | null;
  categoryName: string | null;
  descriptionOfWork: string | null;
  actualTotal: number;
  perLineRevenue: number;
  perLineGp: number;
  poNumber: string | null;
  bucket: string;
  recognitionMonth: string | null;
  invoiceRaisedDate: string | null;
  recognitionDateOverride: string | null;
  flags: LineReviewFlags;
}

interface LineReviewSummary {
  total: number;
  flagged: number;
  allocationMissing: number;
  poMismatch: number;
  anomaly: number;
}

interface LineReviewResponse {
  lines: LineReviewRow[];
  summary: LineReviewSummary;
}

// Per-flag client-side filter chips.
type FlagFilter = 'allocationMissing' | 'poMismatch' | 'anomaly';

// The four line actions, each backed by its own POST endpoint.
type ActionKind = 'move' | 'invoiceDate' | 'clear' | 'remove';

function formatRand(val: number | null | undefined): string {
  return formatZar(val);
}

/** ZAR with an explicit +/- sign — used for the PO delta on the mismatch badge. */
function formatSignedRand(val: number): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${formatZar(val)}`;
}

// ---------------------------------------------------------------------------
// Flag badges — HARD accessibility rule: colour is ALWAYS paired with an icon
// AND a text label, never colour alone.
// ---------------------------------------------------------------------------

function FlagBadges({ row }: { row: LineReviewRow }) {
  const { flags } = row;
  const hasAny =
    flags.allocationMissing ||
    flags.poMismatch ||
    flags.anomaly ||
    !!row.recognitionDateOverride;

  if (!hasAny) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {flags.allocationMissing && (
        <Badge
          variant="outline"
          className="gap-1 text-[10px] font-medium border-amber-300 bg-amber-50 text-amber-700"
          data-testid={`badge-allocation-${row.costLineId}`}
        >
          <AlertTriangle className="h-3 w-3" />
          No allocation
        </Badge>
      )}
      {flags.poMismatch && (
        <Badge
          variant="outline"
          className="gap-1 text-[10px] font-medium border-orange-300 bg-orange-50 text-orange-700"
          data-testid={`badge-po-mismatch-${row.costLineId}`}
        >
          <AlertCircle className="h-3 w-3" />
          PO mismatch
          {flags.poDelta != null && (
            <span className="font-mono" aria-label={formatZarAriaLabel(flags.poDelta)}>
              {formatSignedRand(flags.poDelta)}
            </span>
          )}
        </Badge>
      )}
      {flags.anomaly && (
        <Badge
          variant="outline"
          className="gap-1 text-[10px] font-medium border-red-300 bg-red-50 text-red-700"
          data-testid={`badge-anomaly-${row.costLineId}`}
        >
          <TrendingUp className="h-3 w-3" />
          Anomaly ×{Math.round(flags.anomalyFactor ?? 0)}
        </Badge>
      )}
      {row.recognitionDateOverride && (
        <TooltipProvider delayDuration={150}>
          <UiTooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="gap-1 text-[10px] font-medium border-emerald-300 bg-emerald-50 text-emerald-700"
                data-testid={`badge-moved-${row.costLineId}`}
              >
                <CalendarClock className="h-3 w-3" />
                Moved
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Recognition moved to {row.recognitionDateOverride}
            </TooltipContent>
          </UiTooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action dialog — one component drives all four actions. Every action REQUIRES
// a reason (min 3 chars). Move/invoice-date add a typed value field on top.
// ---------------------------------------------------------------------------

const ACTION_META: Record<
  ActionKind,
  {
    title: string;
    description: string;
    endpoint: (costLineId: number) => string;
    valueField: null | { kind: 'month' | 'date'; name: 'targetMonth' | 'invoiceDate'; label: string };
    submitLabel: string;
    destructive: boolean;
  }
> = {
  move: {
    title: 'Move to month',
    description:
      'Reassign this line to a different recognition month. The reason authorises the override.',
    endpoint: (id) => `/api/cos-line-review/${id}/move-period`,
    valueField: { kind: 'month', name: 'targetMonth', label: 'Target month' },
    submitLabel: 'Move line',
    destructive: false,
  },
  invoiceDate: {
    title: 'Set invoice date',
    description: 'Set the invoice-raised date for this line. The reason is recorded in the audit log.',
    endpoint: (id) => `/api/cos-line-review/${id}/set-invoice-date`,
    valueField: { kind: 'date', name: 'invoiceDate', label: 'Invoice date' },
    submitLabel: 'Set date',
    destructive: false,
  },
  clear: {
    title: 'Undo move',
    description: 'Clear the recognition-month override and restore the original recognition month.',
    endpoint: (id) => `/api/cos-line-review/${id}/clear-override`,
    valueField: null,
    submitLabel: 'Undo move',
    destructive: false,
  },
  remove: {
    title: 'Remove line',
    description:
      'Remove this cost line from COS recognition. This is a destructive action and is recorded in the audit log.',
    endpoint: (id) => `/api/cos-line-review/${id}/remove`,
    valueField: null,
    submitLabel: 'Remove line',
    destructive: true,
  },
};

const reasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters.');

const formSchema = z.object({
  reason: reasonSchema,
  // Optional in the base schema; superRefine enforces them per-action below.
  targetMonth: z.string().optional(),
  invoiceDate: z.string().optional(),
});

type LineActionForm = z.infer<typeof formSchema>;

function LineActionDialog({
  action,
  row,
  onClose,
  onSuccess,
}: {
  action: ActionKind;
  row: LineReviewRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const meta = ACTION_META[action];
  // Inline server error (e.g. 423 period-locked) shown above the footer while
  // the dialog stays open so the user can adjust the reason / value and retry.
  const [serverError, setServerError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      formSchema.superRefine((val, ctx) => {
        if (meta.valueField?.name === 'targetMonth' && !val.targetMonth) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['targetMonth'],
            message: 'Pick a target month.',
          });
        }
        if (meta.valueField?.name === 'invoiceDate' && !val.invoiceDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['invoiceDate'],
            message: 'Pick an invoice date.',
          });
        }
      }),
    [meta.valueField],
  );

  const form = useForm<LineActionForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      reason: '',
      targetMonth: row.recognitionMonth ?? '',
      invoiceDate: row.invoiceRaisedDate ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: LineActionForm) => {
      const body: Record<string, string> = { reason: values.reason.trim() };
      if (meta.valueField?.name === 'targetMonth' && values.targetMonth) {
        body.targetMonth = values.targetMonth;
      }
      if (meta.valueField?.name === 'invoiceDate' && values.invoiceDate) {
        body.invoiceDate = values.invoiceDate;
      }
      // CRITICAL: the endpoint is keyed on costLineId, NOT lineId.
      await apiRequest('POST', meta.endpoint(row.costLineId), body);
    },
    onSuccess: () => {
      toast({ title: `${meta.title} — done` });
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      // 423 = period locked. The server message explains who may override and
      // that the reason authorises it for COO/CFO/CEO. Keep the dialog OPEN and
      // surface that message inline; everything else is a generic error toast.
      if (err instanceof ApiError && err.status === 423) {
        setServerError(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      toast({ title: `Could not ${meta.title.toLowerCase()}`, description: msg, variant: 'destructive' });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid={`dialog-line-action-${action}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {meta.destructive && <Trash2 className="h-4 w-4 text-destructive" />}
            {meta.title}
          </DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-0.5">
          <p className="font-medium text-foreground truncate" title={row.projectName ?? undefined}>
            {row.projectName ?? 'Unassigned project'}
          </p>
          <p className="text-muted-foreground truncate" title={row.descriptionOfWork ?? undefined}>
            {row.categoryName ? `${row.categoryName} · ` : ''}
            {row.descriptionOfWork ?? '—'}
          </p>
          <p className="font-mono text-foreground" aria-label={formatZarAriaLabel(row.actualTotal)}>
            {formatRand(row.actualTotal)}
            {row.recognitionMonth ? ` · ${row.recognitionMonth}` : ''}
          </p>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => {
              setServerError(null);
              mutation.mutate(values);
            })}
            className="space-y-4"
          >
            {meta.valueField?.name === 'targetMonth' && (
              <FormField
                control={form.control}
                name="targetMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{meta.valueField?.label}</FormLabel>
                    <FormControl>
                      <Input type="month" {...field} data-testid="input-target-month" />
                    </FormControl>
                    <FormDescription>Month the line should be recognised in (YYYY-MM).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {meta.valueField?.name === 'invoiceDate' && (
              <FormField
                control={form.control}
                name="invoiceDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{meta.valueField?.label}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-invoice-date" />
                    </FormControl>
                    <FormDescription>Date the supplier invoice was raised (YYYY-MM-DD).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Why is this change being made? (recorded in the audit log)"
                      rows={3}
                      {...field}
                      data-testid="input-line-action-reason"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {serverError && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                role="alert"
                data-testid="text-line-action-locked"
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={meta.destructive ? 'destructive' : 'default'}
                disabled={mutation.isPending}
                data-testid="button-line-action-submit"
              >
                {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                {meta.submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-flag filter chip — colour + icon + label + count.
// ---------------------------------------------------------------------------

function FlagFilterChip({
  active,
  onToggle,
  icon: Icon,
  label,
  count,
  tone,
  testId,
}: {
  active: boolean;
  onToggle: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  tone: 'amber' | 'orange' | 'red';
  testId: string;
}) {
  const tones: Record<string, string> = {
    amber: 'border-amber-300 text-amber-700 data-[active=true]:bg-amber-50',
    orange: 'border-orange-300 text-orange-700 data-[active=true]:bg-orange-50',
    red: 'border-red-300 text-red-700 data-[active=true]:bg-red-50',
  };
  return (
    <button
      type="button"
      data-active={active}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/50 ${tones[tone]} ${active ? 'ring-1 ring-inset' : ''}`}
      aria-pressed={active}
      data-testid={testId}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <Badge variant="outline" className="ml-0.5 px-1.5 py-0 text-[10px] tabular-nums">
        {count}
      </Badge>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main panel.
// ---------------------------------------------------------------------------

export function CosLineReviewPanel({
  cosTrackerQueryKey,
}: {
  /** The COS tracker query key from the parent page, invalidated on success. */
  cosTrackerQueryKey: QueryKey;
}) {
  const qc = useQueryClient();
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [flagFilters, setFlagFilters] = useState<Set<FlagFilter>>(new Set());
  const [dialog, setDialog] = useState<{ action: ActionKind; row: LineReviewRow } | null>(null);

  const lineReviewKey = useMemo(
    () => ['/api/cos-line-review', flaggedOnly] as const,
    [flaggedOnly],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<LineReviewResponse>({
    queryKey: lineReviewKey,
    queryFn: fetchQueryFn(`/api/cos-line-review?flaggedOnly=${flaggedOnly}`),
    staleTime: 30_000,
    retry: 1,
  });

  const toggleFlag = (flag: FlagFilter) =>
    setFlagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });

  const rows = useMemo(() => {
    const all = data?.lines ?? [];
    return all.filter((r) => {
      // Per-flag chips (OR within the active set) applied client-side.
      if (flagFilters.size > 0) {
        const matches =
          (flagFilters.has('allocationMissing') && r.flags.allocationMissing) ||
          (flagFilters.has('poMismatch') && r.flags.poMismatch) ||
          (flagFilters.has('anomaly') && r.flags.anomaly);
        if (!matches) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [r.projectName, r.categoryName, r.descriptionOfWork, r.poNumber]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, flagFilters, search]);

  const summary = data?.summary;

  // On any successful action, refetch line review + the COS tracker grid and the
  // month-detail drawer query so headline numbers stay in sync.
  const handleActionSuccess = () => {
    qc.invalidateQueries({ queryKey: ['/api/cos-line-review'] });
    qc.invalidateQueries({ queryKey: cosTrackerQueryKey });
    qc.invalidateQueries({ queryKey: ['/api/cos-tracker'] });
    qc.invalidateQueries({ queryKey: ['/api/cos-tracker/month-detail'] });
  };

  return (
    <div className="space-y-3" data-testid="cos-line-review-panel">
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border px-3 sm:px-5 py-2.5 sm:py-3">
          <CardTitle className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Line review — integrity flags &amp; finance-meeting actions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="cos-line-flagged-only"
                checked={flaggedOnly}
                onCheckedChange={setFlaggedOnly}
                data-testid="switch-flagged-only"
              />
              <Label htmlFor="cos-line-flagged-only" className="text-xs cursor-pointer">
                Show flagged only
              </Label>
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search project, category, description, PO…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                data-testid="input-line-review-search"
              />
            </div>
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          {/* Per-flag filter chips with summary counts */}
          {summary && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Filter:
              </span>
              <FlagFilterChip
                active={flagFilters.has('allocationMissing')}
                onToggle={() => toggleFlag('allocationMissing')}
                icon={AlertTriangle}
                label="No allocation"
                count={summary.allocationMissing}
                tone="amber"
                testId="chip-allocation-missing"
              />
              <FlagFilterChip
                active={flagFilters.has('poMismatch')}
                onToggle={() => toggleFlag('poMismatch')}
                icon={AlertCircle}
                label="PO mismatch"
                count={summary.poMismatch}
                tone="orange"
                testId="chip-po-mismatch"
              />
              <FlagFilterChip
                active={flagFilters.has('anomaly')}
                onToggle={() => toggleFlag('anomaly')}
                icon={TrendingUp}
                label="Anomaly"
                count={summary.anomaly}
                tone="red"
                testId="chip-anomaly"
              />
              <span className="ml-auto text-[11px] text-muted-foreground">
                {summary.flagged} flagged of {summary.total} lines
              </span>
            </div>
          )}

          {/* Body */}
          {isLoading ? (
            <div className="p-8 flex justify-center items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading lines…
            </div>
          ) : isError ? (
            <div className="p-6 flex flex-col items-center gap-3 text-center">
              <div className="h-10 w-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : 'Failed to load line review.'}
              </p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={flaggedOnly ? 'No flagged lines' : 'No lines'}
              description={
                flaggedOnly
                  ? 'No lines need review for the current filters. Toggle "Show flagged only" off to see every line.'
                  : 'No lines match the current filters.'
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs" data-testid="table-line-review">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Project</th>
                    <th className="text-left px-3 py-2 font-semibold">Category</th>
                    <th className="text-left px-3 py-2 font-semibold">Description</th>
                    <th className="text-right px-3 py-2 font-semibold">Cost</th>
                    <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Recognition</th>
                    <th className="text-left px-3 py-2 font-semibold">Flags</th>
                    <th className="text-right px-3 py-2 font-semibold w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.lineId}
                      className="border-t border-border/60 hover:bg-muted/20 transition-colors"
                      data-testid={`row-line-review-${row.costLineId}`}
                    >
                      <td className="px-3 py-2 font-medium max-w-[180px] truncate" title={row.projectName ?? undefined}>
                        {row.projectName ?? <span className="text-muted-foreground italic">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate" title={row.categoryName ?? undefined}>
                        {row.categoryName ?? '—'}
                      </td>
                      <td className="px-3 py-2 max-w-[220px] truncate" title={row.descriptionOfWork ?? undefined}>
                        {row.descriptionOfWork ?? '—'}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono whitespace-nowrap"
                        aria-label={formatZarAriaLabel(row.actualTotal)}
                      >
                        {formatRand(row.actualTotal)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {row.recognitionMonth ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <FlagBadges row={row} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              aria-label="Line actions"
                              data-testid={`button-line-actions-${row.costLineId}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => setDialog({ action: 'move', row })}
                              data-testid={`action-move-${row.costLineId}`}
                            >
                              <CalendarDays className="h-3.5 w-3.5 mr-2" />
                              Move to month…
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDialog({ action: 'invoiceDate', row })}
                              data-testid={`action-invoice-date-${row.costLineId}`}
                            >
                              <CalendarClock className="h-3.5 w-3.5 mr-2" />
                              Set invoice date…
                            </DropdownMenuItem>
                            {row.recognitionDateOverride && (
                              <DropdownMenuItem
                                onClick={() => setDialog({ action: 'clear', row })}
                                data-testid={`action-clear-${row.costLineId}`}
                              >
                                <RotateCcw className="h-3.5 w-3.5 mr-2" />
                                Undo move
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setDialog({ action: 'remove', row })}
                              className="text-destructive focus:text-destructive"
                              data-testid={`action-remove-${row.costLineId}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Remove line
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <LineActionDialog
          key={`${dialog.action}-${dialog.row.costLineId}`}
          action={dialog.action}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSuccess={handleActionSuccess}
        />
      )}
    </div>
  );
}

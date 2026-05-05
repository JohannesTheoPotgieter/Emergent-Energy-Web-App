/**
 * Phase 3 — Suggested QB Matches inbox.
 *
 * Lists pending system-generated suggestions produced by the auto-suggest
 * engine (POST /auto-suggest/run). Each row shows the app entity label,
 * top candidate confidence + QB doc number, a "learned pattern" badge
 * when the candidate was lifted by Phase 2 fingerprints, and a Review
 * button that scrolls the user to the existing approve drawer for that
 * suggestion.
 *
 * The "Run auto-suggest" button is also rendered here so finance can
 * trigger the engine on demand without leaving the page. Approved /
 * declined suggestions disappear from the inbox automatically (the
 * server-side filter is `acceptedAt IS NULL AND rejectedAt IS NULL`).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Inbox,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PendingSuggestion {
  id: number;
  scope: "expense_invoice" | "incoming_invoice";
  appEntityId: number | null;
  appEntityLabel: string | null;
  requestedAt: string;
  topConfidence: number | null;
  topQbDocNumber: string | null;
  topQbCounterpartyName: string | null;
  candidateCount: number;
  hasLearnedPatternMatch: boolean;
}

interface AutoSuggestRunResult {
  ok: boolean;
  docsScanned: number;
  candidatesScanned: number;
  skippedAlreadyLinked?: number;
  skippedAlreadyPending?: number;
  suggestionsCreated: number;
  message?: string;
}

interface QbAutoSuggestInboxProps {
  /** Optional callback when the reviewer clicks "Review" on a suggestion. */
  onReview?: (suggestionId: number, appEntityId: number | null) => void;
}

function bandColour(confidence: number | null): string {
  if (confidence === null) return "bg-slate-100 text-slate-700 border-slate-200";
  if (confidence >= 90) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (confidence >= 70) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-rose-100 text-rose-700 border-rose-200";
}

export function QbAutoSuggestInbox({ onReview }: QbAutoSuggestInboxProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const pendingQuery = useQuery<{ pending: PendingSuggestion[]; total: number }>({
    queryKey: ["/api/quickbooks/invoice-matches/auto-suggest/pending"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/quickbooks/invoice-matches/auto-suggest/pending",
      );
      return res.json();
    },
  });

  const runMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/quickbooks/invoice-matches/auto-suggest/run",
        {},
      );
      return (await res.json()) as AutoSuggestRunResult;
    },
    onSuccess: (data) => {
      const created = data.suggestionsCreated;
      toast({
        title: created > 0 ? "Auto-suggest finished" : "Auto-suggest finished (no new matches)",
        description:
          data.message ??
          `Scanned ${data.candidatesScanned} app rows × ${data.docsScanned} QB docs — created ${created} suggestion${created === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/quickbooks/invoice-matches/auto-suggest/pending"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Auto-suggest failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const pending = pendingQuery.data?.pending ?? [];

  return (
    <Card className="border-emerald-200" data-testid="card-qb-auto-suggest-inbox">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-emerald-700" />
            <h3 className="text-sm font-semibold">Suggested QB Matches</h3>
            <Badge variant="outline" className="border-emerald-200">
              {pending.length}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            data-testid="button-run-auto-suggest"
          >
            {runMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Run auto-suggest
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Scans cost lines whose counterparty has a learned invoice / memo
          pattern and queues high-confidence QuickBooks matches for review.
          Suggestions never auto-link — you still approve each one.
        </p>

        {pendingQuery.isLoading ? (
          <div className="text-xs text-muted-foreground py-3 flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading suggestions…
          </div>
        ) : pending.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3 flex items-center gap-2">
            <AlertCircle className="h-3 w-3" />
            No pending auto-suggestions. Run the engine to scan for new matches.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {pending.map((s) => (
              <div
                key={s.id}
                className="rounded-md border border-slate-200 bg-white p-2 flex items-center justify-between gap-2"
                data-testid={`row-auto-suggest-${s.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-medium truncate">
                    <span className="truncate">{s.appEntityLabel ?? `App #${s.appEntityId ?? "?"}`}</span>
                    {s.hasLearnedPatternMatch ? (
                      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
                        <Sparkles className="h-3 w-3 mr-1" />
                        learned
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    QB {s.topQbDocNumber ?? "—"} · {s.topQbCounterpartyName ?? "—"}
                  </div>
                </div>
                <Badge variant="outline" className={bandColour(s.topConfidence)}>
                  {s.topConfidence ?? "—"}%
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onReview?.(s.id, s.appEntityId)}
                  data-testid={`button-review-suggestion-${s.id}`}
                >
                  Review
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default QbAutoSuggestInbox;

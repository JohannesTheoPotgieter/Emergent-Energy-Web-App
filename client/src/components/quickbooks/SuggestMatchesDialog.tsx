/**
 * Task #30 — Admin-only "Suggest matches" dialog.
 *
 * Three-step flow:
 *   1. Suggest   — POST /api/quickbooks/suggest-matches → list of candidates.
 *   2. Preview   — POST /api/quickbooks/suggest-matches/preview-cascade →
 *                  willUpdate / willSkipLocked / willSkipReconciled lists.
 *   3. Accept    — POST /api/quickbooks/suggest-matches/accept → commits.
 *
 * Reused by Throughput → Mappings (Customers + Vendors). The endpoint set is
 * identical across scopes; only the labels change.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Lock, ShieldAlert, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type SuggestScope = "customer" | "vendor";

export interface MatchCandidate {
  qbId: string;
  qbName: string;
  confidence: number;
  reasons: string[];
}

interface CascadePreview {
  willUpdate: { linkId: number; reason: string }[];
  willSkipLocked: { mappingId?: number; linkId?: number; reason: string }[];
  willSkipReconciled: { linkId: number; reason: string }[];
}

interface SuggestRunState {
  suggestionId: number;
  candidates: MatchCandidate[];
}

interface PreviewState {
  cascadeRunId: number;
  candidate: MatchCandidate;
  candidateIndex: number;
  preview: CascadePreview;
}

export interface SuggestMatchesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: SuggestScope;
  appEntityId: number;
  appEntityLabel: string;
  /** Query keys to invalidate after successful commit. */
  invalidateOnSuccess?: string[][];
}

function scopeCopy(scope: SuggestScope) {
  if (scope === "customer") {
    return {
      title: "Suggest QuickBooks customer matches",
      subjectNoun: "QuickBooks customer",
      cascadeNoun: "linked invoices",
    };
  }
  return {
    title: "Suggest QuickBooks vendor matches",
    subjectNoun: "QuickBooks vendor",
    cascadeNoun: "linked bills",
  };
}

export function SuggestMatchesDialog({
  open,
  onOpenChange,
  scope,
  appEntityId,
  appEntityLabel,
  invalidateOnSuccess = [],
}: SuggestMatchesDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const copy = scopeCopy(scope);

  const [run, setRun] = useState<SuggestRunState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setRun(null);
      setPreview(null);
    }
  }, [open]);

  const suggestMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quickbooks/suggest-matches", {
        scope,
        appEntityId,
      });
      return res.json() as Promise<{ suggestion: { id: number }; candidates: MatchCandidate[] }>;
    },
    onSuccess: (data) => {
      setRun({ suggestionId: data.suggestion.id, candidates: data.candidates ?? [] });
    },
    onError: (err: Error) => {
      toast({ title: "Suggest failed", description: err.message, variant: "destructive" });
    },
  });

  const previewMut = useMutation({
    mutationFn: async (vars: { suggestionId: number; candidateIndex: number }) => {
      const res = await apiRequest(
        "POST",
        "/api/quickbooks/suggest-matches/preview-cascade",
        vars,
      );
      return res.json() as Promise<{
        cascadeRunId: number;
        candidate: MatchCandidate;
        preview: CascadePreview;
      }>;
    },
    onSuccess: (data, vars) => {
      setPreview({
        cascadeRunId: data.cascadeRunId,
        candidate: data.candidate,
        candidateIndex: vars.candidateIndex,
        preview: data.preview,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const acceptMut = useMutation({
    mutationFn: async () => {
      if (!run || !preview) throw new Error("nothing to accept");
      const res = await apiRequest("POST", "/api/quickbooks/suggest-matches/accept", {
        suggestionId: run.suggestionId,
        cascadeRunId: preview.cascadeRunId,
        candidateIndex: preview.candidateIndex,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Mapping locked",
        description: `Mapped “${appEntityLabel}” → ${preview?.candidate.qbName ?? ""} (${preview?.candidate.confidence}%) and updated ${preview?.preview.willUpdate.length ?? 0} ${copy.cascadeNoun}.`,
      });
      for (const key of invalidateOnSuccess) queryClient.invalidateQueries({ queryKey: key });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Accept failed", description: err.message, variant: "destructive" });
    },
  });

  // Auto-run suggestion when dialog opens.
  useEffect(() => {
    if (open && !run && !suggestMut.isPending) {
      suggestMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-suggest-matches">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>
            App side: <span className="font-medium">{appEntityLabel}</span>. Admin-only.
            Accepting will lock the mapping and cascade-update {copy.cascadeNoun} that are not
            already reconciled.
          </DialogDescription>
        </DialogHeader>

        {suggestMut.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching {copy.subjectNoun}s…
          </div>
        )}

        {run && !preview && (
          <div className="space-y-2 max-h-80 overflow-y-auto" data-testid="list-candidates">
            {run.candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">No suggestions found.</p>
            )}
            {run.candidates.map((c, i) => (
              <button
                key={c.qbId}
                type="button"
                onClick={() => previewMut.mutate({ suggestionId: run.suggestionId, candidateIndex: i })}
                disabled={previewMut.isPending}
                className="w-full text-left rounded border border-slate-200 hover:border-sky-400 hover:bg-sky-50/50 px-3 py-2 transition"
                data-testid={`candidate-${i}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{c.qbName}</div>
                  <Badge variant="outline" className="text-xs">
                    {c.confidence}%
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.reasons.join(" · ")}</div>
              </button>
            ))}
            {previewMut.isPending && (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Building preview…
              </div>
            )}
          </div>
        )}

        {preview && (
          <div className="space-y-3" data-testid="preview-cascade">
            <div className="rounded border border-sky-200 bg-sky-50/50 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-sky-600" />
                  {preview.candidate.qbName}
                </div>
                <Badge className="bg-sky-100 text-sky-700 border-sky-200">
                  {preview.candidate.confidence}%
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {preview.candidate.reasons.join(" · ")}
              </div>
            </div>

            <div className="grid gap-2 text-xs">
              <PreviewRow
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                label="Will update"
                count={preview.preview.willUpdate.length}
                items={preview.preview.willUpdate.map((x) => `link #${x.linkId} — ${x.reason}`)}
              />
              <PreviewRow
                icon={<Lock className="h-3.5 w-3.5 text-amber-600" />}
                label="Will skip (locked)"
                count={preview.preview.willSkipLocked.length}
                items={preview.preview.willSkipLocked.map((x) => x.reason)}
              />
              <PreviewRow
                icon={<ShieldAlert className="h-3.5 w-3.5 text-rose-600" />}
                label="Will skip (already reconciled)"
                count={preview.preview.willSkipReconciled.length}
                items={preview.preview.willSkipReconciled.map(
                  (x) => `link #${x.linkId} — ${x.reason}`,
                )}
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Accepting will lock the mapping (admin-only to change) and write a full audit entry.
              COS realisation, paid-date confirmation and allocation amounts are never changed by
              this action.
            </p>
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)} data-testid="button-back">
                Back
              </Button>
              <Button
                onClick={() => acceptMut.mutate()}
                disabled={acceptMut.isPending}
                data-testid="button-accept-cascade"
              >
                {acceptMut.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Accept &amp; lock
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel">
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({
  icon,
  label,
  count,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  items: string[];
}) {
  return (
    <div className="rounded border border-slate-200 px-2 py-1.5">
      <div className="flex items-center gap-2 font-medium">
        {icon} {label} <Badge variant="outline">{count}</Badge>
      </div>
      {items.length > 0 && (
        <ul className="mt-1 ml-5 list-disc text-[11px] text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
          {items.slice(0, 50).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          {items.length > 50 && <li>…and {items.length - 50} more</li>}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";

export interface ImpactRow {
  label: string;
  count: number;
  /** Optional note displayed in muted text on the right. */
  note?: string;
  /** Danger level — colours the count badge. */
  severity?: "high" | "medium" | "low";
}

export interface ConfirmDestructiveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title — default "Delete permanently?" */
  title?: string;
  /** One-line description of what's being deleted, e.g. "Project Sunrise". */
  subject: string;
  /** Extra blurb shown above the impact list. */
  description?: string;
  /**
   * List of related records that will be affected. Show-counts so the user
   * sees exactly what cascades. Empty list means no cascade.
   */
  impact?: ImpactRow[];
  /** Loading the impact list (server roundtrip to /impact endpoint). */
  impactLoading?: boolean;
  /**
   * When true (default), the user must type the subject's name to confirm.
   * Set false for low-impact deletes where a second click is enough.
   */
  requireTypedConfirm?: boolean;
  /** Verb on the action button — default "Delete". */
  actionVerb?: string;
  /** Async handler. Errors should be thrown so the dialog surfaces them. */
  onConfirm: () => Promise<void>;
  /** Optional error message shown inline (e.g. after a 409 from the server). */
  error?: string | null;
}

/**
 * Shared destructive-confirmation primitive. Displays the blast radius of
 * a delete/archive/recall before the user commits. Used anywhere in the
 * app where deleting something has cascade consequences.
 *
 * Contract matches the locked policy: "Before destructive action, show
 * exactly what will be affected ('deleting this project will also detach
 * 3 invoices, 12 work items, 1 client link — proceed?'). No silent
 * collateral damage."
 */
export function ConfirmDestructive({
  open,
  onOpenChange,
  title = "Delete permanently?",
  subject,
  description,
  impact,
  impactLoading,
  requireTypedConfirm = true,
  actionVerb = "Delete",
  onConfirm,
  error,
}: ConfirmDestructiveProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setLocalError(null);
    }
  }, [open]);

  const totalCascade = (impact ?? []).reduce((sum, row) => sum + (row.count || 0), 0);
  const needsTyped = requireTypedConfirm && (impact ?? []).length > 0;
  const canConfirm = !busy && (!needsTyped || typed.trim() === subject.trim());
  const displayError = error ?? localError;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setLocalError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Delete failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="confirm-destructive-dialog" className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-foreground">
                  You're about to delete <span className="font-semibold">{subject}</span>.
                </p>
                {description && (
                  <p className="text-xs text-muted-foreground mt-1">{description}</p>
                )}
              </div>

              {impactLoading ? (
                <div className="text-xs text-muted-foreground">Checking what this affects…</div>
              ) : impact && impact.length > 0 ? (
                <div className="rounded-md border bg-destructive/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-destructive-foreground/80">
                    This will also affect {totalCascade} record{totalCascade === 1 ? "" : "s"}:
                  </p>
                  <ul className="space-y-1">
                    {impact.map((row, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span className="text-sm">{row.label}</span>
                        <div className="flex items-center gap-2">
                          {row.note && (
                            <span className="text-[10px] text-muted-foreground">{row.note}</span>
                          )}
                          <Badge
                            variant="outline"
                            className={
                              row.severity === "high"
                                ? "bg-red-100 text-red-800 border-red-300"
                                : row.severity === "medium"
                                  ? "bg-amber-100 text-amber-800 border-amber-300"
                                  : "bg-muted"
                            }
                          >
                            {row.count}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : impact && impact.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No related records — safe to delete.</p>
              ) : null}

              {needsTyped && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Type <span className="font-mono text-destructive">{subject}</span> to confirm
                  </label>
                  <Input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={subject}
                    autoComplete="off"
                    data-testid="input-confirm-typed"
                  />
                </div>
              )}

              {displayError && (
                <p className="text-xs text-destructive" data-testid="confirm-destructive-error">{displayError}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              disabled={!canConfirm}
              onClick={handleConfirm}
              data-testid="btn-confirm-destructive"
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              {actionVerb}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

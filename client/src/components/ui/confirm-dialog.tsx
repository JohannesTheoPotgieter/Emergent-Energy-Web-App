/**
 * A7 / UI-UX-audit X6: the single confirmation primitive for destructive,
 * privileged or bulk actions.
 *
 * Basic:
 *   <ConfirmDialog open={o} onOpenChange={setO} title="Delete project?"
 *     description="This action cannot be undone." confirmLabel="Delete"
 *     variant="destructive" onConfirm={() => deleteProject()} />
 *
 * Type-to-confirm (extra destructive):
 *   <ConfirmDialog ... typeToConfirm="DELETE" />
 *
 * Privileged / bulk (X6 — impact preview + required justification):
 *   <ConfirmDialog ... impact={<p>12 users · 340 permissions affected</p>}
 *     requireReason onConfirm={(reason) => save(reason!)} />
 *
 * `onConfirm` receives the trimmed reason when `requireReason` is set;
 * existing callers that ignore the argument are unaffected.
 */
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  typeToConfirm?: string;
  /** Impact preview — e.g. "X users / Y permissions affected". */
  impact?: React.ReactNode;
  /** Require a free-text justification before the action can proceed. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason?: string) => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  typeToConfirm,
  impact,
  requireReason = false,
  reasonLabel = "Reason (recorded in the audit log)",
  reasonPlaceholder = "Why is this change being made?",
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");

  const typedOk = typeToConfirm ? typed === typeToConfirm : true;
  const reasonOk = requireReason ? reason.trim().length > 0 : true;
  const canConfirm = typedOk && reasonOk;

  const reset = () => {
    setTyped("");
    setReason("");
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    const r = reason.trim();
    reset();
    onConfirm(requireReason ? r : undefined);
    onOpenChange(false);
  };

  const handleCancel = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); else onOpenChange(v); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>

        {impact && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {impact}
          </div>
        )}

        {typeToConfirm && (
          <div className="py-1">
            <p className="text-sm text-muted-foreground mb-2">
              Type <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{typeToConfirm}</code> to confirm.
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typeToConfirm}
              className="text-sm"
              autoFocus
            />
          </div>
        )}

        {requireReason && (
          <div className="py-1 space-y-1.5">
            <label className="text-sm font-medium text-foreground">{reasonLabel}</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              className="text-sm min-h-[72px]"
              autoFocus={!typeToConfirm}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

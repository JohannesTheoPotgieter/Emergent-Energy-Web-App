/**
 * Shared Loading / Empty / Error states for the compact finance template.
 *
 * One look for every finance screen so "no data", "loading" and "failed"
 * never surprise the user. Tokens only. Error exposes a Retry action and
 * never leaks raw error objects to the UI.
 */
import * as React from "react";
import { Loader2, Inbox, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-12 px-6 text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FinanceLoading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <Frame className={className}>
      <Loader2 className="h-6 w-6 animate-spin text-emerald-600" aria-hidden="true" />
      <p className="text-sm text-slate-500" role="status">{label}</p>
    </Frame>
  );
}

export function FinanceEmpty({
  title = "Nothing to show",
  hint,
  className,
}: {
  title?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <Frame className={className}>
      <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-500 max-w-prose">{hint}</p>}
    </Frame>
  );
}

export function FinanceError({
  title = "Couldn't load this view",
  hint = "Try again, or refresh the page. If it keeps happening, contact your administrator.",
  onRetry,
  className,
}: {
  title?: string;
  hint?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Frame className={className}>
      <AlertCircle className="h-6 w-6 text-rose-500" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-500 max-w-prose">{hint}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-1 h-7 text-xs" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Frame>
  );
}

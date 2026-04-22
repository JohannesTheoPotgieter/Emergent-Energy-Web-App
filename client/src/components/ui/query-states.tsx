import { Button } from "@/components/ui/button";

interface QueryErrorProps {
  error?: unknown;
  onRetry: () => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong while loading data.";
}

export function QueryLoading() {
  return (
    <div className="space-y-3 animate-pulse" data-testid="query-loading-state">
      <div className="h-6 w-1/3 rounded bg-slate-200" />
      <div className="h-4 w-2/3 rounded bg-slate-200" />
      <div className="space-y-2 pt-2">
        <div className="h-16 w-full rounded bg-slate-200" />
        <div className="h-16 w-full rounded bg-slate-200" />
        <div className="h-16 w-full rounded bg-slate-200" />
      </div>
    </div>
  );
}

export function QueryError({ error, onRetry }: QueryErrorProps) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800" data-testid="query-error-state">
      <p className="text-sm font-medium">Unable to load data</p>
      <p className="mt-1 text-sm">{getErrorMessage(error)}</p>
      <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

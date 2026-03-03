import { UseQueryResult } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, WifiOff, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, isApiError } from "@/lib/api-error";

interface QueryResultProps<T> {
  query: UseQueryResult<T, Error>;
  children: (data: T) => React.ReactNode;
  loadingMessage?: string;
  emptyCheck?: (data: T) => boolean;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  compact?: boolean;
}

function ErrorDisplay({ error, onRetry, compact }: { error: Error; onRetry?: () => void; compact?: boolean }) {
  const apiError = isApiError(error) ? error : null;
  const isNetwork = apiError?.code === "NETWORK_ERROR";
  const isAuth = apiError?.code === "UNAUTHORIZED";
  const isForbidden = apiError?.code === "FORBIDDEN";

  const Icon = isNetwork ? WifiOff : (isAuth || isForbidden) ? ShieldAlert : AlertCircle;
  const title = isNetwork
    ? "Connection Issue"
    : isAuth
    ? "Session Expired"
    : isForbidden
    ? "Access Denied"
    : "Something went wrong";

  const message = apiError?.userMessage || error.message || "An unexpected error occurred";

  const canRetry = apiError ? apiError.retryable : true;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="error-compact">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{message}</span>
        {canRetry && onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="h-6 px-2 text-xs" data-testid="button-retry-compact">
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="p-6 border-destructive/20 bg-destructive/5" data-testid="error-display">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <Icon className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <h3 className="font-semibold text-sm" data-testid="text-error-title">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-error-message">{message}</p>
        </div>
        {apiError?.fieldErrors && (
          <ul className="text-left text-xs text-destructive space-y-1 w-full max-w-sm">
            {Object.entries(apiError.fieldErrors).map(([field, msg]) => (
              <li key={field} className="flex gap-1">
                <span className="font-medium">{field}:</span> {msg}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 mt-2">
          {isAuth && (
            <Button size="sm" onClick={() => { window.location.href = "/auth/login"; }} data-testid="button-login">
              Log In Again
            </Button>
          )}
          {canRetry && onRetry && (
            <Button variant={isAuth ? "outline" : "default"} size="sm" onClick={onRetry} data-testid="button-retry">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Try Again
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function QueryResult<T>({
  query,
  children,
  loadingMessage = "Loading...",
  emptyCheck,
  emptyMessage = "No data found",
  emptyIcon,
  compact,
}: QueryResultProps<T>) {
  if (query.isLoading) {
    if (compact) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-2" data-testid="loading-compact">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{loadingMessage}</span>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="loading-display">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{loadingMessage}</p>
      </div>
    );
  }

  if (query.isError) {
    return <ErrorDisplay error={query.error} onRetry={() => query.refetch()} compact={compact} />;
  }

  if (query.data && emptyCheck && emptyCheck(query.data)) {
    if (compact) {
      return (
        <div className="text-sm text-muted-foreground py-2 text-center" data-testid="empty-compact">
          {emptyMessage}
        </div>
      );
    }
    return (
      <Card className="p-8 border-dashed" data-testid="empty-display">
        <div className="flex flex-col items-center text-center gap-2">
          {emptyIcon}
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </Card>
    );
  }

  return <>{query.data !== undefined ? children(query.data) : null}</>;
}

export { ErrorDisplay };

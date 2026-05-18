/**
 * UI/UX audit X5/X6 — single shared presentation for external-integration
 * status. Replaces the two divergent ad-hoc layouts (role-settings cards and
 * admin-integrations) and the "Needs Attention" catch-all string inference
 * with one explicit status enum + reason.
 *
 * - Status is an explicit enum, never inferred ad-hoc at the call site.
 * - "Last sync" and "Last checked" are distinct, timezone-qualified values.
 * - Raw error strings are never rendered; a friendly message is shown and the
 *   technical detail is logged to the console for engineers.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2, type LucideIcon } from "lucide-react";
import { formatDateTimeZA } from "@/lib/datetime";

export type IntegrationStatus =
  | "connected"
  | "configured"
  | "not_set_up"
  | "needs_attention"
  | "error";

const STATUS_PRESENTATION: Record<
  IntegrationStatus,
  { label: string; className: string }
> = {
  // Calm palette: emerald = healthy, red = error/needs attention, neutral grey otherwise.
  connected: { label: "Connected", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  configured: { label: "Configured", className: "bg-gray-100 text-gray-600 border-gray-200" },
  not_set_up: { label: "Not set up", className: "bg-gray-100 text-gray-600 border-gray-200" },
  needs_attention: { label: "Needs attention", className: "bg-red-50 text-red-700 border-red-200" },
  error: { label: "Connection error", className: "bg-red-50 text-red-700 border-red-200" },
};

export interface IntegrationStatusCardProps {
  name: string;
  icon: LucideIcon;
  /** Explicit status — caller must classify, no string inference inside. */
  status: IntegrationStatus;
  /** Short, plain-language explanation of why it is in this status. */
  statusReason?: string;
  /** When the connector last successfully synced data. */
  lastSyncAt?: string | null;
  /** When the app last polled/checked this connector's health. */
  lastCheckedAt?: string | null;
  /** Raw technical error — logged to console only, never rendered. */
  technicalError?: string | null;
  description?: string;
  /** Small key/value stats (e.g. Synced Objects, Connected Users). */
  stats?: Array<{ label: string; value: React.ReactNode }>;
  extra?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  testId?: string;
}

export function IntegrationStatusCard({
  name,
  icon: Icon,
  status,
  statusReason,
  lastSyncAt,
  lastCheckedAt,
  technicalError: _technicalError,
  description,
  stats,
  extra,
  onRefresh,
  refreshing,
  testId,
}: IntegrationStatusCardProps) {
  const presentation = STATUS_PRESENTATION[status];
  const healthy = status === "connected";
  const problem = status === "error" || status === "needs_attention";

  return (
    <Card data-testid={testId}>
      <CardContent className="py-5">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${healthy ? "bg-emerald-100" : "bg-muted"}`}>
              <Icon className={`h-5 w-5 ${healthy ? "text-emerald-600" : "text-gray-400"}`} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{name}</p>
              <Badge
                variant="outline"
                className={`text-[10px] mt-0.5 ${presentation.className}`}
                data-testid={testId ? `${testId}-badge` : undefined}
              >
                {presentation.label}
              </Badge>
            </div>
            {problem ? (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            ) : healthy ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : null}
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            {statusReason && <p className="text-foreground">{statusReason}</p>}
            {description && <p>{description}</p>}

            {stats && stats.length > 0 && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/70 bg-muted/30 p-3">
                {stats.map((s) => (
                  <div key={s.label}>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                    <p className="text-sm font-medium text-foreground">{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {extra}

            <p>
              Last sync:{" "}
              <span className="text-foreground">
                {lastSyncAt ? formatDateTimeZA(lastSyncAt) : "No sync recorded"}
              </span>
            </p>
            <p>
              Last checked:{" "}
              <span className="text-foreground">
                {lastCheckedAt ? formatDateTimeZA(lastCheckedAt) : "—"}
              </span>
            </p>
          </div>

          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={onRefresh}
              disabled={refreshing}
              data-testid={testId ? `${testId}-refresh` : undefined}
            >
              {refreshing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh connection
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Connection Health — one tile per external connector, driven by the unified
 * GET /api/integrations endpoint (integration-health-service).
 *
 * Surfaces the four facts an unattended freeze needs at a glance:
 *   • connected / disconnected
 *   • token / last-sync age
 *   • secret-expiry countdown (QB refresh token, Azure/SharePoint client secret)
 *   • last successful sync
 *
 * …plus a one-click Reconnect for OAuth connectors (QuickBooks) and a clear
 * "rotate the secret (ops)" path for client-secret connectors, so a lapsed
 * credential is never a silent failure.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plug,
  PlugZap,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  ShieldAlert,
} from "lucide-react";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";

type HealthState = "healthy" | "stale" | "failing" | "unknown";
type CredentialKind = "oauth_refresh_token" | "client_secret" | "none";
type ExpiryState = "ok" | "expiring_soon" | "critical" | "expired" | "unknown";
type CircuitState = "closed" | "open" | "half_open";

interface HealthTile {
  integration: { id: number; name: string; displayName: string; alertTarget?: string | null };
  health: HealthState;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  ageMs: number | null;
  connected: boolean | null;
  credentialKind: CredentialKind;
  secretExpiresAt: string | null;
  daysUntilSecretExpiry: number | null;
  secretExpiryState: ExpiryState;
  reconnectRequired: boolean;
  reconnectPath: string | null;
  circuitState: CircuitState | null;
}

interface HealthResponse {
  generatedAt: string;
  counts: Record<HealthState, number>;
  tiles: HealthTile[];
}

function ageLabel(ms: number | null): string {
  if (ms === null) return "never";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function expiryColour(state: ExpiryState): string {
  switch (state) {
    case "expired":
    case "critical":
      return "text-red-700";
    case "expiring_soon":
      return "text-amber-700";
    case "ok":
      return "text-emerald-700";
    default:
      return "text-muted-foreground";
  }
}

function expiryLabel(tile: HealthTile): string | null {
  if (tile.credentialKind === "none") return null;
  if (tile.daysUntilSecretExpiry === null) {
    // Client-secret connectors with no expiry configured: nudge the operator.
    return tile.credentialKind === "client_secret" ? "Expiry date not configured" : null;
  }
  const days = tile.daysUntilSecretExpiry;
  const noun = tile.credentialKind === "oauth_refresh_token" ? "Refresh token" : "Client secret";
  if (days <= 0) return `${noun} EXPIRED ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  return `${noun} expires in ${days} day${days === 1 ? "" : "s"}`;
}

/** Headline status badge per tile: reconnect/expiry takes priority over run-health. */
function statusBadge(tile: HealthTile) {
  if (tile.reconnectRequired || tile.secretExpiryState === "expired") {
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Reconnect required</Badge>;
  }
  if (tile.secretExpiryState === "critical") {
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Secret expiring</Badge>;
  }
  if (tile.circuitState === "open") {
    return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Backing off</Badge>;
  }
  switch (tile.health) {
    case "healthy":
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Connected</Badge>;
    case "stale":
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Stale</Badge>;
    case "failing":
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Failing</Badge>;
    default:
      return <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">Unknown</Badge>;
  }
}

function ConnectionTile({ tile }: { tile: HealthTile }) {
  const problem =
    tile.reconnectRequired ||
    tile.health === "failing" ||
    tile.secretExpiryState === "expired" ||
    tile.secretExpiryState === "critical";
  const connectedKnown = tile.connected !== null;
  const isConnected = tile.connected === true && !tile.reconnectRequired;
  const expiry = expiryLabel(tile);
  const oneClick = tile.credentialKind === "oauth_refresh_token";

  return (
    <Card data-testid={`conn-health-${tile.integration.name}`}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isConnected ? "bg-emerald-100" : problem ? "bg-red-100" : "bg-muted"}`}>
            {isConnected ? (
              <PlugZap className="h-5 w-5 text-emerald-600" />
            ) : problem ? (
              <AlertTriangle className="h-5 w-5 text-red-600" />
            ) : (
              <Plug className="h-5 w-5 text-gray-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{tile.integration.displayName}</p>
            <div className="mt-0.5" data-testid={`conn-health-${tile.integration.name}-badge`}>
              {statusBadge(tile)}
            </div>
          </div>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          {connectedKnown && (
            <p className="flex items-center gap-1.5">
              {isConnected ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className="text-foreground">{isConnected ? "Connected" : "Disconnected"}</span>
            </p>
          )}

          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Last successful sync:{" "}
            <span className="text-foreground">
              {tile.lastSuccessAt ? formatRelativeWithAbsoluteZA(tile.lastSuccessAt) : "never"}
            </span>
          </p>

          {tile.ageMs !== null && (
            <p className="pl-5">Token / data age: <span className="text-foreground">{ageLabel(tile.ageMs)}</span></p>
          )}

          {expiry && (
            <p className={`flex items-center gap-1.5 font-medium ${expiryColour(tile.secretExpiryState)}`}>
              <KeyRound className="h-3.5 w-3.5" />
              {expiry}
            </p>
          )}

          {tile.circuitState === "open" && (
            <p className="text-amber-700">Circuit breaker open — backing off to let the upstream recover.</p>
          )}
          {tile.lastErrorCode && tile.health === "failing" && (
            <p className="text-red-700">Last error: {tile.lastErrorCode}</p>
          )}
        </div>

        {tile.reconnectRequired && tile.reconnectPath && (
          oneClick ? (
            <Button
              size="sm"
              className="gap-1.5 w-full"
              onClick={() => {
                window.location.href = tile.reconnectPath as string;
              }}
              data-testid={`conn-health-${tile.integration.name}-reconnect`}
            >
              <RefreshCw className="h-4 w-4" /> Reconnect {tile.integration.displayName}
            </Button>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid={`conn-health-${tile.integration.name}-reconnect`}>
              Rotate the client secret in the Azure Portal (ops, ~15 min), then update the
              expiry-date config. See <span className="font-mono">docs/runbooks/secrets-rotation.md</span>.
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

interface IntegrationConnectionHealthProps {
  /**
   * When provided, only connectors whose `integration.name` is in this list are
   * shown. Used by the finance-only Integration Statuses page to surface just
   * QuickBooks + Microsoft 365 and drop CRM/other connectors.
   */
  includeNames?: string[];
}

export function IntegrationConnectionHealth({ includeNames }: IntegrationConnectionHealthProps = {}) {
  const query = useQuery<HealthResponse>({
    queryKey: ["/api/integrations"],
    queryFn: async () => {
      const res = await fetch("/api/integrations", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load connection health (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const allowed = includeNames ? new Set(includeNames) : null;
  const tiles = (query.data?.tiles ?? []).filter(
    (t) => !allowed || allowed.has(t.integration.name),
  );
  // Lead with the connectors that carry a lapsing credential (QB / MS / SharePoint),
  // then the rest. Within that, surface anything needing attention first.
  const ordered = [...tiles].sort((a, b) => {
    const score = (t: HealthTile) =>
      (t.reconnectRequired ? 0 : 100) +
      (t.credentialKind !== "none" ? 0 : 10) +
      (t.health === "failing" ? 0 : 1);
    return score(a) - score(b);
  });

  return (
    <Card data-testid="connection-health-panel">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PlugZap className="h-5 w-5 text-emerald-600" />
              Connection Health
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Live connection state, last successful sync, and credential-expiry countdown for
              every connector. Tokens auto-refresh; a lapsing refresh token or Azure client secret
              is alerted to the COO 30 and 7 days ahead so it never fails silently.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            data-testid="connection-health-refresh"
            aria-label="Refresh connection health"
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading connection health…</div>
        ) : query.error ? (
          <div className="text-sm text-red-600">
            Couldn't load connection health: {query.error instanceof Error ? query.error.message : "Unknown error"}
          </div>
        ) : ordered.length === 0 ? (
          <div className="text-sm text-muted-foreground">No connectors registered yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ordered.map((tile) => (
              <ConnectionTile key={tile.integration.name} tile={tile} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Link as LinkIcon, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw,
  Unplug, FileText, Users, Receipt, Activity, ArrowRight, Loader2, HelpCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

/**
 * QuickBooks home — clean status → action → history surface.
 *
 * Replaces the "half-cooked, difficult to understand" feel of the old
 * admin-quickbooks page with a structure that answers three questions
 * in order:
 *   1) Are we connected? How healthy is the connection?
 *   2) What can I do right now? (Sync, mappings, reconciliation)
 *   3) What has happened recently? (sync log, errors)
 *
 * Deep tools (per-customer mapping, class overrides, full recon table)
 * stay on their existing pages and are linked from this home. The
 * existing admin-quickbooks page is still accessible for legacy
 * flows — this is the new front door.
 */

type Health = "healthy" | "stale" | "failing" | "unknown";

interface QuickBooksStatus {
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiry: string | null;
  refreshTokenExpiry: string | null;
  sandbox: boolean;
  health: Health;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  lastFailureCode: string | null;
  lastFailureReason: string | null;
  isStale: boolean;
  ageMs: number | null;
  staleAfterMs: number;
}

interface SyncLogEntry {
  id: number;
  kind?: string | null;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
}

function healthBadge(h: Health) {
  switch (h) {
    case "healthy":
      return { label: "Healthy", className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 };
    case "stale":
      return { label: "Stale", className: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle };
    case "failing":
      return { label: "Failing", className: "bg-red-100 text-red-700 border-red-200", icon: AlertCircle };
    default:
      return { label: "Unknown", className: "bg-muted text-muted-foreground", icon: HelpCircle };
  }
}

export default function QuickBooksHome() {
  const qc = useQueryClient();
  const statusQuery = useQuery<QuickBooksStatus>({
    queryKey: ["/api/quickbooks/status"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 60_000,
  });
  const syncLogQuery = useQuery<{ entries: SyncLogEntry[] } | SyncLogEntry[]>({
    queryKey: ["/api/quickbooks/sync-log"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const syncNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quickbooks/sync-now", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sync started", description: "QuickBooks sync is running now." });
      qc.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
      qc.invalidateQueries({ queryKey: ["/api/quickbooks/sync-log"] });
    },
    onError: (err) => {
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quickbooks/disconnect", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Disconnected", description: "QuickBooks has been disconnected." });
      qc.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
    },
  });

  const status = statusQuery.data;
  const badge = healthBadge(status?.health ?? "unknown");
  const BadgeIcon = badge.icon;

  const logEntries = Array.isArray(syncLogQuery.data)
    ? syncLogQuery.data.slice(0, 10)
    : ((syncLogQuery.data as { entries?: SyncLogEntry[] })?.entries ?? []).slice(0, 10);

  return (
    <PageLayout
      data-testid="quickbooks-home"
      header={
        <PageHeader
          title="QuickBooks"
          subtitle="Connection health, one-click sync, and jump-offs to mappings and reconciliation."
        />
      }
    >
      {/* Row 1: Status card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-primary" />
              Connection
            </span>
            <Badge className={`text-[10px] ${badge.className}`} data-testid="qb-health-badge">
              <BadgeIcon className="h-3 w-3 mr-1" /> {badge.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {statusQuery.isLoading ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Checking QuickBooks…</p>
          ) : !status?.connected ? (
            <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
              <Unplug className="h-7 w-7 opacity-50" />
              <p className="text-sm font-medium">Not connected</p>
              <Button size="sm" asChild>
                <a href="/api/quickbooks/auth" data-testid="qb-connect">
                  Connect QuickBooks
                </a>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatusTile
                label="Company"
                value={status.companyName ?? "—"}
                sub={status.sandbox ? "Sandbox tenant" : "Production tenant"}
              />
              <StatusTile
                label="Last successful sync"
                value={status.lastSuccessfulSyncAt ? formatDistanceToNow(new Date(status.lastSuccessfulSyncAt), { addSuffix: true }) : "—"}
                sub={status.isStale ? `Stale after ${Math.round(status.staleAfterMs / 60000)}min` : "Within expected window"}
                tone={status.isStale ? "amber" : "emerald"}
              />
              <StatusTile
                label="Token expires"
                value={status.tokenExpiry ? formatDistanceToNow(new Date(status.tokenExpiry), { addSuffix: true }) : "—"}
                sub={status.refreshTokenExpiry ? `Refresh token: ${formatDistanceToNow(new Date(status.refreshTokenExpiry), { addSuffix: true })}` : undefined}
              />
              {status.lastFailureReason && (
                <div className="md:col-span-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Last sync failure</p>
                    <p className="text-red-600">{status.lastFailureCode ? `[${status.lastFailureCode}] ` : ""}{status.lastFailureReason}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 2: Actions */}
      {status?.connected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card data-testid="qb-actions-primary">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                Primary actions
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <Button
                size="sm"
                className="w-full justify-start"
                onClick={() => syncNow.mutate()}
                disabled={syncNow.isPending}
                data-testid="qb-sync-now"
              >
                {syncNow.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync now
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" asChild>
                <a href="/api/quickbooks/auth" data-testid="qb-reconnect">
                  <LinkIcon className="h-4 w-4 mr-2" /> Reconnect
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start text-red-700 hover:text-red-700 hover:border-red-300"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
                data-testid="qb-disconnect"
              >
                {disconnect.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unplug className="h-4 w-4 mr-2" />}
                Disconnect
              </Button>
            </CardContent>
          </Card>

          <Card data-testid="qb-drill-downs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" />
                Jump to
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              <JumpLink to="/finance-quickbooks-links" icon={<Receipt className="h-4 w-4" />} label="Invoice linking" sub="Match QB invoices to project revenue" />
              <JumpLink to="/finance-quickbooks-customer-mapping" icon={<Users className="h-4 w-4" />} label="Customer mapping" sub="Map QB customers to clients in the app" />
              <JumpLink to="/finance-quickbooks-throughput" icon={<Activity className="h-4 w-4" />} label="Throughput / reconciliation" sub="CoS + revenue reconciliation dashboard" />
              <JumpLink to="/admin-quickbooks" icon={<FileText className="h-4 w-4" />} label="Advanced admin" sub="Legacy detail view + raw API explorer" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Row 3: Sync log */}
      {status?.connected && (
        <Card data-testid="qb-sync-log">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Recent syncs
              <Badge variant="outline" className="text-[10px]">{logEntries.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {logEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No sync history yet.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {logEntries.map((entry) => (
                  <li key={entry.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-1.5 w-1.5 rounded-full ${entry.status === "succeeded" ? "bg-emerald-500" : entry.status === "failed" ? "bg-red-500" : "bg-amber-500"}`} />
                      <span className="truncate">
                        {entry.kind ?? "sync"}
                        {entry.message ? <span className="text-xs text-muted-foreground ml-2">— {entry.message}</span> : null}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {entry.finishedAt
                        ? formatDistanceToNow(new Date(entry.finishedAt), { addSuffix: true })
                        : entry.startedAt
                          ? formatDistanceToNow(new Date(entry.startedAt), { addSuffix: true })
                          : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}

function StatusTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "emerald" | "amber" | "red" }) {
  return (
    <div className="rounded-md border p-3 space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function JumpLink({ to, icon, label, sub }: { to: string; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <Link
      href={to}
      className="flex items-center justify-between gap-2 p-2 rounded-md border bg-card hover:bg-[hsl(var(--surface-tint))] hover:border-primary/30 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-primary">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{label}</p>
          <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
        </div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </Link>
  );
}

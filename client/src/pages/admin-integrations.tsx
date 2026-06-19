/**
 * Integration Statuses — single page showing live health for every external
 * connector the app depends on (Outlook / SharePoint / Teams via MS Graph,
 * QuickBooks, Pipedrive) AND the Excel Smart Import pipeline.
 *
 * Data-integrity rules respected here:
 *   • Recent-imports list reads from /api/smart-import/runs (canonical
 *     smart_import_runs table). No raw workbook parsing on this page.
 *   • Per-project "View imported data" links open the read-only Tracker
 *     replicas, which read from snapshot tables with the effectiveTo IS NULL
 *     guard enforced in tracker-replica-repository.ts.
 *   • Health-dashboard tiles count distinct projects, not runs, so re-imports
 *     don't double-count.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminPageShell } from "@/components/admin/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Upload, FileSpreadsheet, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Clock, Eye, Play, Cloud, Save, Zap, ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";
import { IntegrationConnectionHealth } from "@/components/admin/integration-connection-health";

// Live-Ready Integration Statuses surfaces exactly three connectors:
// QuickBooks, Microsoft 365 (incl. the SharePoint tracker auto-pull) and Smart
// Import. Connection-health tiles are filtered to these connector names.
const FINANCE_CONNECTOR_NAMES = ["quickbooks", "microsoft_365"];

// ── Types ──────────────────────────────────────────────────────────────────

interface ImportRun {
  id: number;
  project_id: number | null;
  project_name: string | null;
  status: string | null;
  file_name: string | null;
  uploaded_at: string | null;
  committed_at: string | null;
  uploaded_by: string | null;
  committed_by: string | null;
}

interface ImportHealthRow {
  projectName: string;
  projectId: number | null;
  lastImportDate: string | null;
  lastImportStatus: string;
  totalImportRuns: number;
  daysSinceLastImport: number | null;
  staleness: "fresh" | "aging" | "stale" | "never";
  unresolvedIssueCount?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const ms = Date.now() - ts;
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(status: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "committed") return <Badge variant="default" className="bg-emerald-600">Committed</Badge>;
  if (s === "rolled_back") return <Badge variant="destructive">Rolled back</Badge>;
  if (s === "failed" || s === "rejected") return <Badge variant="destructive">{s}</Badge>;
  if (s === "pending" || s === "uploaded") return <Badge variant="secondary">Pending</Badge>;
  return <Badge variant="outline">{status || "—"}</Badge>;
}

// ── Smart Import panel ─────────────────────────────────────────────────────

function SmartImportPanel() {
  const runsQuery = useQuery<ImportRun[]>({
    queryKey: ["/api/smart-import/runs"],
    queryFn: async () => {
      const res = await fetch("/api/smart-import/runs", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load import runs (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const healthQuery = useQuery<ImportHealthRow[]>({
    queryKey: ["/api/smart-import/health-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/smart-import/health-dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load import health (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  // Defensive: API contract is `ImportRun[]`, but if a 200 response ever
  // returns a wrapped shape (`{ rows: [...] }`, an error object, etc.) we
  // would crash this whole admin page with `runs.slice is not a function`.
  // Normalise to an array no matter what.
  const runs: ImportRun[] = Array.isArray(runsQuery.data)
    ? runsQuery.data
    : Array.isArray((runsQuery.data as any)?.rows)
      ? (runsQuery.data as any).rows
      : [];
  const recentRuns = runs.slice(0, 10);
  const lastCommitted = runs.find((r) => (r.status || "").toLowerCase() === "committed");

  const counts = useMemo(() => {
    const c = { fresh: 0, aging: 0, stale: 0, never: 0 };
    for (const row of healthQuery.data ?? []) {
      c[row.staleness] = (c[row.staleness] || 0) + 1;
    }
    return c;
  }, [healthQuery.data]);

  const totalProjects =
    (healthQuery.data ?? []).length || counts.fresh + counts.aging + counts.stale + counts.never;

  return (
    <Card data-testid="smart-import-panel">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              Excel Smart Import
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              The active SharePoint tracker is the source of truth for finance,
              cashflow and the FYE report. Run an import manually here, then
              verify the imported data against the live workbook.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/smart-import">
              <Button size="sm" className="gap-1.5" data-testid="btn-run-manual-import">
                <Upload className="h-4 w-4" /> Run Manual Import
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void runsQuery.refetch();
                void healthQuery.refetch();
              }}
              data-testid="btn-refresh-imports"
              aria-label="Refresh import status"
            >
              <RefreshCw className={`h-4 w-4 ${runsQuery.isFetching || healthQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="Fresh (≤ 7 days)"
            value={counts.fresh}
            total={totalProjects}
            tone="emerald"
            icon={CheckCircle2}
            testid="stat-fresh"
          />
          <StatTile
            label="Aging (8–14 days)"
            value={counts.aging}
            total={totalProjects}
            tone="amber"
            icon={Clock}
            testid="stat-aging"
          />
          <StatTile
            label="Stale (> 14 days)"
            value={counts.stale}
            total={totalProjects}
            tone="red"
            icon={AlertTriangle}
            testid="stat-stale"
          />
          <StatTile
            label="Never imported"
            value={counts.never}
            total={totalProjects}
            tone="muted"
            icon={AlertTriangle}
            testid="stat-never"
          />
        </div>

        {lastCommitted && (
          <div className="text-sm text-muted-foreground border-l-2 border-emerald-500 pl-3 py-1 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-r">
            <span className="font-medium text-foreground">Last successful import:</span>{" "}
            <span data-testid="text-last-import-file">{lastCommitted.file_name || "(unknown file)"}</span>
            {" — "}
            <span data-testid="text-last-import-project">{lastCommitted.project_name || "(unknown project)"}</span>
            {" • "}
            <span data-testid="text-last-import-when">{fmtRelative(lastCommitted.committed_at)}</span>
            {lastCommitted.committed_by && (
              <>
                {" by "}
                <span className="font-medium">{lastCommitted.committed_by}</span>
              </>
            )}
          </div>
        )}

        <RecentImports
          rows={recentRuns}
          loading={runsQuery.isLoading}
          error={runsQuery.error}
        />
      </CardContent>
    </Card>
  );
}

function StatTile({
  label, value, total, tone, icon: Icon, testid,
}: {
  label: string;
  value: number;
  total: number;
  tone: "emerald" | "amber" | "red" | "muted";
  icon: typeof CheckCircle2;
  testid: string;
}) {
  const colour = {
    emerald: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
    amber:   "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
    red:     "text-red-600 bg-red-50 dark:bg-red-950/30",
    muted:   "text-muted-foreground bg-muted/40",
  }[tone];
  return (
    <div className={`rounded-lg p-3 flex items-center gap-3 ${colour}`} data-testid={testid}>
      <Icon className="h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide">{label}</div>
        <div className="text-xl font-bold leading-tight">
          {value}
          {total > 0 && <span className="text-xs font-normal text-muted-foreground"> / {total}</span>}
        </div>
      </div>
    </div>
  );
}

function RecentImports({
  rows, loading, error,
}: {
  rows: ImportRun[];
  loading: boolean;
  error: unknown;
}) {
  if (loading) {
    return <div className="text-sm text-muted-foreground p-3">Loading recent imports…</div>;
  }
  if (error) {
    return (
      <div className="text-sm text-red-600 p-3 bg-red-50/40 rounded">
        Couldn't load recent imports: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-3">
        No imports yet. Click <strong>Run Manual Import</strong> above to upload the active tracker workbook.
      </div>
    );
  }
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>Committed</TableHead>
            <TableHead className="text-right">Imported Data</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`row-import-${r.id}`}>
              <TableCell className="font-mono text-xs max-w-[260px] truncate" title={r.file_name ?? ""}>
                {r.file_name || "—"}
              </TableCell>
              <TableCell className="text-sm">{r.project_name || "—"}</TableCell>
              <TableCell>{statusBadge(r.status)}</TableCell>
              <TableCell className="text-sm text-muted-foreground" title={r.uploaded_at ?? ""}>
                {fmtRelative(r.uploaded_at)}
                {r.uploaded_by && <div className="text-xs">by {r.uploaded_by}</div>}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground" title={r.committed_at ?? ""}>
                {fmtRelative(r.committed_at)}
                {r.committed_by && <div className="text-xs">by {r.committed_by}</div>}
              </TableCell>
              <TableCell className="text-right">
                <ImportedDataMenu run={r} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ImportedDataMenu({ run }: { run: ImportRun }) {
  const { project_id: projectId, project_name: projectName } = run;
  const runDetailHref = `/admin/smart-import?runId=${run.id}`;
  const [open, setOpen] = useState(false);

  // Without projectId we can't deep-link to the snapshot-guarded replicas, but
  // the run-detail wizard always resolves from the runId.
  if (!projectId) {
    return (
      <Link href={runDetailHref}>
        <Button size="sm" variant="ghost" className="gap-1.5" data-testid={`btn-view-${run.id}`}>
          <Eye className="h-4 w-4" /> View
        </Button>
      </Link>
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5" data-testid={`btn-view-${run.id}`}>
          <Eye className="h-4 w-4" /> View
          <span className="sr-only">{projectName ?? `project ${projectId}`}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">
          {projectName ?? `Project #${projectId}`} — replica sheets
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/projects/${projectId}/revenue-tracking`} className="flex items-center gap-2 cursor-pointer">
            <ExternalLink className="h-3.5 w-3.5" /> Revenue Tracking
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/projects/${projectId}/expenditure-breakdown`} className="flex items-center gap-2 cursor-pointer">
            <ExternalLink className="h-3.5 w-3.5" /> Expenditure Breakdown
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/projects/${projectId}/program-plan`} className="flex items-center gap-2 cursor-pointer">
            <ExternalLink className="h-3.5 w-3.5" /> Program Plan
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={runDetailHref} className="flex items-center gap-2 cursor-pointer">
            <FileSpreadsheet className="h-3.5 w-3.5" /> Import-run detail
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/projects/${projectId}/excel-vs-app`} className="flex items-center gap-2 cursor-pointer">
            <CheckCircle2 className="h-3.5 w-3.5" /> Excel vs App diff
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── SharePoint Auto-Import Panel ───────────────────────────────────────────

interface SpSettings {
  id?: number;
  siteId: string;
  driveId: string;
  folderItemId: string | null;
  folderPath: string | null;
  intervalMinutes: number;
  enabled: boolean;
  autoCommitAll?: boolean;
  lastRunAt: string | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  updatedAt?: string;
  updatedBy?: number | null;
}

interface TestConnectionResult {
  ok: boolean;
  failureCategory?: "missing_token" | "expired_token" | "missing_scope" | "401" | "403" | "404" | "malformed_config" | "graph_outage";
  message?: string;
  nextAction?: string;
  siteName?: string;
  driveName?: string;
  folderName?: string;
  siteReachable?: boolean;
  driveReachable?: boolean;
  folderReachable?: boolean;
  fileCount?: number;
  firstFiveTrackerFilenames?: string[];
  checks?: Array<{
    name: "site" | "drive" | "folder" | "children";
    ok: boolean;
    httpStatus: number | null;
    graphErrorCode?: string | null;
    graphErrorMessage?: string | null;
  }>;
}

function normalizeFolderPath(folderPath: string | null | undefined): string | null {
  const normalized = (folderPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/");
  return normalized || null;
}

function nextRunEstimate(lastRunAt: string | null, intervalMinutes: number): string {
  if (!lastRunAt) return "as soon as scheduler ticks (≤60 s)";
  const nextMs = new Date(lastRunAt).getTime() + intervalMinutes * 60_000;
  const deltaMs = nextMs - Date.now();
  if (deltaMs <= 0) return "due now — running on next tick";
  const mins = Math.ceil(deltaMs / 60_000);
  return `in ~${mins} minute${mins === 1 ? "" : "s"}`;
}

/**
 * SharePoint Auto-Import — wires the SP_SETTINGS row that the legacy
 * importPipeline.startScheduler() polls every 60 s. When `enabled=true` AND
 * `Date.now() - lastRunAt ≥ intervalMinutes × 60 000`, runFullImport runs
 * end-to-end (auto-commit mode, per the owner's "always commit; no human
 * review" choice on 2026-05-11). UI here lives on /admin/integrations.
 */
function SharePointAutoImportPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const settingsQuery = useQuery<SpSettings | null>({
    queryKey: ["/api/admin/sp-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sp-settings", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });

  const [form, setForm] = useState<SpSettings>({
    siteId: "",
    driveId: "",
    folderItemId: null,
    folderPath: null,
    intervalMinutes: 30,
    enabled: false,
    autoCommitAll: false,
    lastRunAt: null,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  // Connection settings are tucked behind a collapsible so the panel leads with
  // status + actions; opened automatically until the connection is configured.
  const [showSettings, setShowSettings] = useState(false);

  // Sync form with server state when it loads / refetches.
  useEffect(() => {
    if (!settingsQuery.data || dirty) return;
    setForm({
      ...settingsQuery.data,
      // Defensive: server may emit nulls for optional fields.
      folderItemId: settingsQuery.data.folderItemId ?? null,
      folderPath: settingsQuery.data.folderPath ?? null,
      intervalMinutes: settingsQuery.data.intervalMinutes ?? 30,
      autoCommitAll: settingsQuery.data.autoCommitAll ?? false,
    });
  }, [settingsQuery.data, dirty]);

  function patch<K extends keyof SpSettings>(key: K, value: SpSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "siteId" || key === "driveId" || key === "folderItemId" || key === "folderPath") {
      setTestResult(null);
    }
    setDirty(true);
  }

  async function handleSave() {
    if (!form.siteId.trim() || !form.driveId.trim()) {
      toast({
        title: "Site ID and Drive ID are required",
        description: "Paste them from SharePoint or use Test Connection to verify before saving.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/sp-settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: form.siteId.trim(),
          driveId: form.driveId.trim(),
          folderItemId: form.folderItemId || null,
          folderPath: normalizeFolderPath(form.folderPath),
          intervalMinutes: form.intervalMinutes,
          enabled: form.enabled,
          autoCommitAll: form.autoCommitAll ?? false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const category = body?.details?.failureCategory || body?.code || body?.error;
        const nextAction = body?.nextAction ? ` ${body.nextAction}` : "";
        throw new Error(`${category ? `${category}: ` : ""}${body?.message || `HTTP ${res.status}`}${nextAction}`);
      }
      toast({ title: "Auto-import settings saved" });
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["/api/admin/sp-settings"] });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!form.siteId.trim() || !form.driveId.trim()) {
      toast({ title: "Site ID and Drive ID required to test", variant: "destructive" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/sp-settings/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: form.siteId.trim(),
          driveId: form.driveId.trim(),
          folderItemId: form.folderItemId || null,
          folderPath: normalizeFolderPath(form.folderPath),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestResult({ ok: false, message: body?.message || body?.error || `HTTP ${res.status}`, nextAction: body?.nextAction });
      } else {
        setTestResult(body as TestConnectionResult);
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setTesting(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/import/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      toast({ title: "Import started", description: "Will refresh shortly." });
      // Give the scheduler a moment to update lastRunAt then refetch.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["/api/admin/sp-settings"] });
        void qc.invalidateQueries({ queryKey: ["/api/smart-import/runs"] });
        void qc.invalidateQueries({ queryKey: ["/api/smart-import/health-dashboard"] });
      }, 3000);
    } catch (err) {
      toast({
        title: "Run Now failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  const configured = !!settingsQuery.data;
  const enabled = form.enabled;

  return (
    <Card data-testid="sharepoint-autoimport-panel">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Cloud className="h-5 w-5 text-sky-600" />
              SharePoint Auto-Import Schedule
              {enabled ? (
                <Badge variant="default" className="bg-emerald-600">On</Badge>
              ) : (
                <Badge variant="outline">Off</Badge>
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-commits the active tracker workbook on a schedule — no human review. COO / CEO only.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status — one compact line (state · last run · next · interval). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className={`h-2 w-2 rounded-full ${enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
            {enabled ? "Scheduled imports on" : "Paused"}
          </span>
          <span className="text-muted-foreground">
            Last run <span className="font-medium text-foreground" data-testid="text-last-run-at">{settingsQuery.data?.lastRunAt ? formatRelativeWithAbsoluteZA(settingsQuery.data.lastRunAt) : "Never"}</span>
          </span>
          <span className="text-muted-foreground">
            Next <span className="font-medium text-foreground" data-testid="text-next-run-at">{enabled ? nextRunEstimate(settingsQuery.data?.lastSuccessAt ?? null, form.intervalMinutes) : "—"}</span>
          </span>
          <span className="text-muted-foreground">
            Every <span className="font-medium text-foreground">{form.intervalMinutes} min</span>
          </span>
        </div>

        {/* Connection settings — technical config tucked behind a collapsible so
            the panel leads with status + actions. Stays open until configured. */}
        <Collapsible open={showSettings || !configured} onOpenChange={setShowSettings}>
          <CollapsibleTrigger
            className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/40"
            data-testid="sp-settings-toggle"
          >
            <span className="inline-flex items-center gap-2">
              <Cloud className="h-4 w-4 text-muted-foreground" />
              Connection settings
            </span>
            {showSettings || !configured ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sp-site-id">SharePoint Site ID</Label>
                <Input
                  id="sp-site-id"
                  placeholder="e.g. emergent.sharepoint.com,abc-123,def-456"
                  value={form.siteId}
                  onChange={(e) => patch("siteId", e.target.value)}
                  data-testid="input-sp-site-id"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-drive-id">Drive ID</Label>
                <Input
                  id="sp-drive-id"
                  placeholder="e.g. b!abc...xyz"
                  value={form.driveId}
                  onChange={(e) => patch("driveId", e.target.value)}
                  data-testid="input-sp-drive-id"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-folder-path">Folder Path (optional)</Label>
                <Input
                  id="sp-folder-path"
                  placeholder="Active Trackers/2026"
                  value={form.folderPath ?? ""}
                  onChange={(e) => patch("folderPath", e.target.value || null)}
                  data-testid="input-sp-folder-path"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-interval">Interval (minutes)</Label>
                <Input
                  id="sp-interval"
                  type="number"
                  min={1}
                  max={1440}
                  value={form.intervalMinutes}
                  onChange={(e) => patch("intervalMinutes", Math.max(1, Number(e.target.value) || 30))}
                  data-testid="input-sp-interval"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Enable toggle */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
          <div>
            <div className="font-medium">Enable scheduled imports</div>
            <p className="text-xs text-muted-foreground">
              When on, the scheduler auto-commits every interval. Turn off to
              pause without losing your configuration.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => patch("enabled", v)}
            data-testid="switch-sp-enabled"
          />
        </div>

        {/* Always auto-commit (skip review) — owner switch. */}
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/10 px-3 py-2">
          <div className="pr-3">
            <div className="font-medium">Always auto-commit (skip review)</div>
            <p className="text-xs text-muted-foreground">
              Commit every scheduled pull even when the importer flags issues
              (ERROR&nbsp;on&nbsp;REV, missing allocation, blockers, conflicts), and
              skip the wrong-file guards. The tracker becomes the unconditional
              source of truth — a truncated or wrong file will overwrite finance
              data with no pause. Turn off to restore the review gate.
            </p>
          </div>
          <Switch
            checked={form.autoCommitAll ?? false}
            onCheckedChange={(v) => patch("autoCommitAll", v)}
            data-testid="switch-sp-auto-commit-all"
          />
        </div>

        {/* Test connection result */}
        {testResult && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm flex items-start gap-2 ${
              testResult.ok
                ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20"
                : "border-red-200 bg-red-50 dark:bg-red-950/20"
            }`}
            data-testid="text-sp-test-result"
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className={`font-medium ${testResult.ok ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200"}`}>
                {testResult.ok ? "Connection OK" : "Connection failed"}
              </div>
              {(testResult.siteName || testResult.driveName || testResult.folderName) && (
                <div className="text-xs text-muted-foreground">
                  {testResult.siteName ? `Site: ${testResult.siteName}` : ""}
                  {testResult.siteName && testResult.driveName ? " · " : ""}
                  {testResult.driveName ? `Drive: ${testResult.driveName}` : ""}
                  {(testResult.siteName || testResult.driveName) && testResult.folderName ? " · " : ""}
                  {testResult.folderName ? `Folder: ${testResult.folderName}` : ""}
                </div>
              )}
              {testResult.ok && (
                <div className="mt-1 space-y-1 text-xs">
                  <div className="text-emerald-800 dark:text-emerald-200">
                    Site reachable · Drive reachable · Folder reachable · {testResult.fileCount ?? 0} tracker file{(testResult.fileCount ?? 0) === 1 ? "" : "s"}
                  </div>
                  {testResult.firstFiveTrackerFilenames && testResult.firstFiveTrackerFilenames.length > 0 && (
                    <div className="text-muted-foreground">
                      First 5: {testResult.firstFiveTrackerFilenames.join(", ")}
                    </div>
                  )}
                </div>
              )}
              {!testResult.ok && testResult.failureCategory && (
                <div className="text-xs font-medium text-red-800 dark:text-red-200">
                  Category: {testResult.failureCategory}
                </div>
              )}
              {testResult.message && !testResult.ok && (
                <div className="text-xs">{testResult.message}</div>
              )}
              {testResult.nextAction && !testResult.ok && (
                <div className="text-xs text-muted-foreground mt-1">{testResult.nextAction}</div>
              )}
              {!testResult.ok && testResult.checks && testResult.checks.length > 0 && (
                <div className="mt-2 grid gap-1 text-xs">
                  {testResult.checks.map((check) => (
                    <div key={check.name} className="flex flex-wrap gap-x-2 text-muted-foreground">
                      <span className="font-medium capitalize text-foreground">{check.name}</span>
                      <span>{check.ok ? "OK" : "Failed"}</span>
                      {check.httpStatus ? <span>HTTP {check.httpStatus}</span> : null}
                      {check.graphErrorCode ? <span>{check.graphErrorCode}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="gap-1.5"
            data-testid="btn-sp-save"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing}
            className="gap-1.5"
            data-testid="btn-sp-test"
          >
            <Zap className="h-4 w-4" />
            {testing ? "Testing…" : "Test Connection"}
          </Button>
          <Button
            variant="outline"
            onClick={handleRunNow}
            disabled={running || !configured || !enabled}
            className="gap-1.5"
            data-testid="btn-sp-run-now"
            title={!configured ? "Save settings first" : !enabled ? "Enable scheduled imports first" : "Trigger an immediate scheduled run"}
          >
            <Play className="h-4 w-4" />
            {running ? "Triggering…" : "Run Now"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void settingsQuery.refetch()}
            className="gap-1.5 ml-auto"
            data-testid="btn-sp-refresh"
            aria-label="Refresh status"
          >
            <RefreshCw className={`h-4 w-4 ${settingsQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {!configured && (
          <div className="text-xs text-muted-foreground bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/60 rounded px-3 py-2">
            <strong>Not yet configured.</strong> Paste the Site ID + Drive ID from
            SharePoint, click <em>Test Connection</em> to confirm the tenant is
            reachable, then <em>Save</em>. The scheduler picks up enabled rows on
            its next 60-second tick.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Last automatic tracker pull — results ──────────────────────────────────

interface LastAutoPullFile {
  runId: number;
  projectId: number | null;
  projectName: string | null;
  fileName: string | null;
  status: string;
  committedAt: string | null;
  uploadedAt: string | null;
  matchSource: string | null;
  sections: string[];
  changeCounts: { plan: number; revenue: number; expenditure: number };
  reason: string | null;
}

interface LastAutoPull {
  batchRunId: string;
  ranAt: string | null;
  counts: { total: number; committed: number; needsReview: number; failed: number; inProgress: number };
  files: LastAutoPullFile[];
}

interface LastAutoPullResponse {
  batch: LastAutoPull | null;
}

function outcomeBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "committed") return <Badge className="bg-emerald-600">Committed</Badge>;
  if (s === "awaiting_review")
    return <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">Needs review</Badge>;
  if (s === "failed" || s === "rejected" || s === "rolled_back")
    return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">In progress</Badge>;
}

function changeSummary(f: LastAutoPullFile): string {
  const parts: string[] = [];
  if (f.changeCounts.revenue > 0) parts.push(`Revenue ${f.changeCounts.revenue}`);
  if (f.changeCounts.expenditure > 0) parts.push(`Expenditure ${f.changeCounts.expenditure}`);
  if (f.changeCounts.plan > 0) parts.push(`Plan ${f.changeCounts.plan}`);
  return parts.length ? parts.join(" · ") : "—";
}

/**
 * Shows the RESULTS of the most recent scheduled (automatic) SharePoint
 * tracker pull — per tracker: the project it updated, the outcome, which
 * sections moved, and the reason for any hold/failure. Reads
 * /api/smart-import/last-auto-pull (the most recent scheduler batch).
 */
function LastAutoPullResults() {
  const q = useQuery<LastAutoPullResponse>({
    queryKey: ["/api/smart-import/last-auto-pull"],
    queryFn: async () => {
      const res = await fetch("/api/smart-import/last-auto-pull", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load last auto-pull (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const batch = q.data?.batch ?? null;

  return (
    <Card data-testid="last-auto-pull-panel">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListChecks className="h-5 w-5 text-sky-600" />
              Last automatic tracker pull — results
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              What the most recent scheduled SharePoint pull changed — per tracker, the
              project it updated, the sections it moved, and why anything was held.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void q.refetch()}
            aria-label="Refresh last auto-pull results"
            data-testid="btn-refresh-auto-pull"
          >
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground p-3">Loading last auto-pull…</div>
        ) : q.error ? (
          <div className="text-sm text-red-600 p-3 bg-red-50/40 rounded">
            Couldn't load last auto-pull: {q.error instanceof Error ? q.error.message : "Unknown error"}
          </div>
        ) : !batch ? (
          <div className="text-sm text-muted-foreground p-3" data-testid="text-auto-pull-empty">
            No automatic tracker pulls have run yet. The SharePoint auto-import will record its
            results here after its next scheduled run.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">
                Ran{" "}
                <span className="font-medium text-foreground" data-testid="text-auto-pull-when">
                  {batch.ranAt ? formatRelativeWithAbsoluteZA(batch.ranAt) : "—"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{batch.counts.total}</span> tracker
                {batch.counts.total === 1 ? "" : "s"}
              </span>
              <Badge className="bg-emerald-600" data-testid="badge-auto-pull-committed">
                {batch.counts.committed} committed
              </Badge>
              {batch.counts.needsReview > 0 && (
                <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200" data-testid="badge-auto-pull-review">
                  {batch.counts.needsReview} need review
                </Badge>
              )}
              {batch.counts.failed > 0 && (
                <Badge variant="destructive" data-testid="badge-auto-pull-failed">
                  {batch.counts.failed} failed
                </Badge>
              )}
              {batch.counts.inProgress > 0 && (
                <Badge variant="secondary">{batch.counts.inProgress} in progress</Badge>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tracker file</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Changed</TableHead>
                    <TableHead>Reason / note</TableHead>
                    <TableHead className="text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batch.files.map((f) => (
                    <TableRow key={f.runId} data-testid={`row-auto-pull-${f.runId}`}>
                      <TableCell className="font-mono text-xs max-w-[240px] truncate" title={f.fileName ?? ""}>
                        {f.fileName || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{f.projectName || "—"}</TableCell>
                      <TableCell>{outcomeBadge(f.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{changeSummary(f)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate" title={f.reason ?? ""}>
                        {f.reason || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/admin/smart-import?runId=${f.runId}`}>
                          <Button size="sm" variant="ghost" className="gap-1.5" data-testid={`btn-view-auto-pull-${f.runId}`}>
                            <Eye className="h-4 w-4" /> View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminIntegrationsPage() {
  // Page-level read-only summaries for the shell header. Both endpoints are
  // already fetched by the panels below, so react-query dedupes — no extra
  // load and no change to how anything works.
  const healthQuery = useQuery<ImportHealthRow[]>({
    queryKey: ["/api/smart-import/health-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/smart-import/health-dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load import health (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });
  const spQuery = useQuery<SpSettings | null>({
    queryKey: ["/api/admin/sp-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sp-settings", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });

  const health = healthQuery.data ?? [];
  const sp = spQuery.data;

  // Calm, non-alarming status line — connection state only, no warning/error
  // tones (per owner: "no more warnings/blockers").
  const statuses: { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }[] = [
    !sp
      ? { label: "SharePoint auto-import not configured", tone: "neutral" }
      : sp.enabled
        ? { label: "SharePoint auto-import on", tone: "success" }
        : { label: "SharePoint auto-import paused", tone: "neutral" },
  ];

  return (
    <AdminPageShell
      surfaceId="integrations"
      title="Integration Statuses"
      description="QuickBooks, Microsoft 365 and Smart Import — connection state plus the tracker import. Run a manual Excel import or let the SharePoint auto-import pull the active tracker on a schedule."
      statuses={statuses}
      metrics={[
        { label: "Tracked projects", value: health.length || "—", helper: "Projects with import history" },
        {
          label: "Auto-import",
          value: sp ? (sp.enabled ? "On" : "Paused") : "Off",
          helper: "SharePoint scheduled pull",
        },
        {
          label: "Last auto-pull",
          value: sp?.lastSuccessAt ? formatRelativeWithAbsoluteZA(sp.lastSuccessAt) : "—",
          helper: "Most recent successful pull",
        },
      ]}
    >
      <div className="space-y-6">
        <IntegrationConnectionHealth includeNames={FINANCE_CONNECTOR_NAMES} />
        <SmartImportPanel />
        <SharePointAutoImportPanel />
        <LastAutoPullResults />
      </div>
    </AdminPageShell>
  );
}

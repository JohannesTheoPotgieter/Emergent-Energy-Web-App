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

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Upload, FileSpreadsheet, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Clock, Eye } from "lucide-react";
import { ConnectionsSection } from "./role-settings";

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

  const runs = runsQuery.data ?? [];
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

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminIntegrationsPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Integration Statuses"
        subtitle="Live connection state for every external system the app depends on. Run a manual Excel import, audit recent imports, and verify the imported numbers match the source workbook."
      />
      <div className="space-y-6">
        <SmartImportPanel />
        <ConnectionsSection />
      </div>
    </PageLayout>
  );
}

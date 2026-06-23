/**
 * Integration Statuses — one screen for the external connectors finance
 * depends on (QuickBooks, Microsoft 365) plus the three ways the project
 * tracker gets into the app:
 *
 *   • Automatic — the scheduled SharePoint pull (auto-commits on an interval)
 *   • One file  — a single manual Excel upload (the Smart Import wizard)
 *   • Folder    — a folder of spreadsheets imported in one manual run
 *
 * This page is UI/UX only. It does NOT change how importing works:
 *   • The manual paths link into the existing Smart Import wizard.
 *   • The automatic path reads/writes the same SP_SETTINGS row the legacy
 *     importPipeline.startScheduler() already polls every 60 s.
 *   • Connection-health tiles read the unified /api/integrations endpoint.
 */

import { useEffect, useState } from "react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Cloud, RefreshCw, CheckCircle2, AlertTriangle, Save, Zap, Play,
  ChevronDown, ChevronRight, Settings2, FileText, FolderOpen, ArrowRight, Workflow,
} from "lucide-react";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";
import { IntegrationConnectionHealth } from "@/components/admin/integration-connection-health";

// Live-Ready Integration Statuses surfaces exactly two external connectors in
// the health panel: QuickBooks and Microsoft 365 (incl. the SharePoint tracker
// auto-pull). Connection-health tiles are filtered to these connector names.
const FINANCE_CONNECTOR_NAMES = ["quickbooks", "microsoft_365"];

// ── SharePoint Auto-Import — types & helpers ───────────────────────────────

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

// ── Automatic import card ──────────────────────────────────────────────────

/**
 * Automatic — wires the SP_SETTINGS row that the legacy
 * importPipeline.startScheduler() polls every 60 s. When `enabled=true` AND
 * `Date.now() - lastRunAt ≥ intervalMinutes × 60 000`, runFullImport runs
 * end-to-end (auto-commit mode, per the owner's "always commit; no human
 * review" choice on 2026-05-11).
 *
 * Presentation only: leads with status, tucks the schedule + connection config
 * + actions behind a single "Configure" expander. The save/test/run-now
 * behaviour and endpoints are unchanged.
 */
function AutomaticImportCard() {
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
  // Schedule + connection config sits behind a single expander so the card
  // leads with status; opened automatically until the connection is configured.
  const [showConfig, setShowConfig] = useState(false);

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
        <CardTitle className="flex items-center gap-2 text-lg">
          <Cloud className="h-5 w-5 text-sky-600" />
          Automatic — scheduled tracker pull
          {!configured ? (
            <Badge variant="outline">Not set up</Badge>
          ) : enabled ? (
            <Badge variant="default" className="bg-emerald-600">On</Badge>
          ) : (
            <Badge variant="outline">Paused</Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Pulls the active SharePoint tracker on a schedule and commits it automatically —
          no manual upload needed. COO / CEO only.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status — one compact line (state · last pull · next · interval). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className={`h-2 w-2 rounded-full ${enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
            {enabled ? "Scheduled pulls on" : configured ? "Paused" : "Not set up yet"}
          </span>
          <span className="text-muted-foreground">
            Last pull <span className="font-medium text-foreground" data-testid="text-last-run-at">{settingsQuery.data?.lastRunAt ? formatRelativeWithAbsoluteZA(settingsQuery.data.lastRunAt) : "Never"}</span>
          </span>
          <span className="text-muted-foreground">
            Next <span className="font-medium text-foreground" data-testid="text-next-run-at">{enabled ? nextRunEstimate(settingsQuery.data?.lastSuccessAt ?? null, form.intervalMinutes) : "—"}</span>
          </span>
          <span className="text-muted-foreground">
            Every <span className="font-medium text-foreground">{form.intervalMinutes} min</span>
          </span>
        </div>

        {/* Configure — schedule, connection and actions tucked behind one
            expander so the card leads with status. Stays open until configured. */}
        <Collapsible open={showConfig || !configured} onOpenChange={setShowConfig}>
          <CollapsibleTrigger
            className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/40"
            data-testid="sp-settings-toggle"
          >
            <span className="inline-flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              Configure schedule &amp; connection
            </span>
            {showConfig || !configured ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
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
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

// ── Manual import cards (one file / folder) ────────────────────────────────

function ManualImportCard({
  testId, icon, title, subtitle, description, href, cta,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <Card data-testid={testId} className="flex flex-col">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-base">{title}</span>
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
        </div>
        <div className="mt-auto pt-1">
          <Link href={href}>
            <Button className="w-full gap-1.5" data-testid={`${testId}-cta`}>
              {cta}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminIntegrationsPage() {
  // Read-only summary for the shell header. The Automatic card fetches the same
  // key, so react-query dedupes — no extra load and no change to behaviour.
  const spQuery = useQuery<SpSettings | null>({
    queryKey: ["/api/admin/sp-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sp-settings", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });

  const sp = spQuery.data;

  // Calm, non-alarming status line — connection state only (per owner:
  // "no more warnings/blockers").
  const statuses: { label: string; tone: "neutral" | "success" }[] = [
    !sp
      ? { label: "Automatic import not set up", tone: "neutral" }
      : sp.enabled
        ? { label: "Automatic import on", tone: "success" }
        : { label: "Automatic import paused", tone: "neutral" },
  ];

  return (
    <AdminPageShell
      surfaceId="integrations"
      title="Integration Statuses"
      description="Live connection health for QuickBooks and Microsoft 365, plus the three ways the project tracker gets into the app — an automatic scheduled pull, a single file, or a folder of files."
      statuses={statuses}
    >
      <div className="space-y-6">
        <IntegrationConnectionHealth includeNames={FINANCE_CONNECTOR_NAMES} />

        <section className="space-y-3" data-testid="tracker-import-section">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Workflow className="h-5 w-5 text-emerald-600" />
                How tracker data gets in
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                The SharePoint tracker is the source of truth for finance, cashflow and the FYE report.
                Bring it in automatically on a schedule, or import a file or folder by hand.
              </p>
            </div>
            <Link href="/import-control-tower">
              <Button variant="ghost" size="sm" className="gap-1.5" data-testid="link-import-history">
                View import history
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          <AutomaticImportCard />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ManualImportCard
              testId="manual-import-file"
              icon={<FileText className="h-5 w-5" />}
              title="Import one file"
              subtitle="Manual · one project"
              description="Upload a single tracker spreadsheet — a plan update, revenue schedule, or cost tracker. You review every change before anything is saved."
              href="/admin/smart-import"
              cta="Import a file"
            />
            <ManualImportCard
              testId="manual-import-folder"
              icon={<FolderOpen className="h-5 w-5" />}
              title="Import a folder"
              subtitle="Manual · many projects"
              description="Upload several spreadsheets at once (for example a SharePoint folder with plans for multiple projects). Review each file, then pick which to commit."
              href="/admin/smart-import?mode=folder"
              cta="Import a folder"
            />
          </div>
        </section>
      </div>
    </AdminPageShell>
  );
}

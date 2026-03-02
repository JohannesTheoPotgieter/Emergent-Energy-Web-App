import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Database,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Trash2,
  RotateCcw,
  Archive,
  Loader2,
  FileCheck,
  Lock,
  Info,
} from "lucide-react";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...options, headers: { ...getAuthHeaders(), ...options?.headers } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

type VerifyResult = { check: string; status: "PASS" | "FAIL" | "WARN" | "SKIP"; legacy: number | string; canonical: number | string; details?: string };

export default function DatabaseMigrationPage() {
  const { toast } = useToast();
  const [backupIdInput, setBackupIdInput] = useState("");
  const [backupDescInput, setBackupDescInput] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState("");
  const [dropConfirm, setDropConfirm] = useState("");
  const [activeBackupId, setActiveBackupId] = useState("");

  const statusQuery = useQuery({
    queryKey: ["/api/admin/migration/status"],
    queryFn: () => apiFetch("/api/admin/migration/status"),
    staleTime: 30000,
  });

  const verifyQuery = useQuery({
    queryKey: ["/api/admin/migration/verify"],
    queryFn: () => apiFetch("/api/admin/migration/verify"),
    enabled: false,
  });

  const refCheckQuery = useQuery({
    queryKey: ["/api/admin/migration/check-references"],
    queryFn: () => apiFetch("/api/admin/migration/check-references", { method: "POST" }),
    enabled: false,
  });

  const registerBackupMutation = useMutation({
    mutationFn: () => apiFetch("/api/admin/migration/register-backup", {
      method: "POST",
      body: JSON.stringify({ backupId: backupIdInput.trim(), description: backupDescInput.trim() || undefined }),
    }),
    onSuccess: (data: any) => {
      toast({ title: "Backup registered", description: `Backup ID: ${data.backupId}` });
      setActiveBackupId(data.backupId);
      setBackupIdInput("");
      setBackupDescInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/status"] });
    },
    onError: (err: Error) => toast({ title: "Failed to register backup", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiFetch("/api/admin/migration/archive", {
      method: "POST",
      body: JSON.stringify({ confirmation: archiveConfirm, backupId: activeBackupId }),
    }),
    onSuccess: (data: any) => {
      toast({ title: "Tables archived", description: `Archived: ${data.archived.join(", ") || "none"}. Skipped: ${data.skipped.join(", ") || "none"}` });
      setArchiveConfirm("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/status"] });
    },
    onError: (err: Error) => toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: () => apiFetch("/api/admin/migration/restore", {
      method: "POST",
      body: JSON.stringify({}),
    }),
    onSuccess: (data: any) => {
      toast({ title: "Tables restored", description: `Restored: ${data.restored.join(", ") || "none"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/status"] });
    },
    onError: (err: Error) => toast({ title: "Restore failed", description: err.message, variant: "destructive" }),
  });

  const dropMutation = useMutation({
    mutationFn: () => apiFetch("/api/admin/migration/drop-archived", {
      method: "POST",
      body: JSON.stringify({ confirmation: dropConfirm }),
    }),
    onSuccess: (data: any) => {
      toast({ title: "Archived tables dropped", description: `Dropped: ${data.dropped.join(", ") || "none"}` });
      setDropConfirm("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/status"] });
    },
    onError: (err: Error) => toast({ title: "Drop failed", description: err.message, variant: "destructive" }),
  });

  const status = statusQuery.data;
  const verify = verifyQuery.data;
  const refCheck = refCheckQuery.data;

  const hasArchivedTables = status && Object.values(status.legacyTables as Record<string, any>).some((t: any) => t.archived);
  const allArchived = status && Object.values(status.legacyTables as Record<string, any>).every((t: any) => t.archived || !t.exists);

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-5xl" data-testid="page-database-migration">
      <div className="flex items-center gap-3 mb-2">
        <Database className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Database Migration Finalize</h1>
          <p className="text-sm text-muted-foreground">Phase 5: Archive and clean up legacy task tables after canonical work_items migration</p>
        </div>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertTitle>Admin-Only Operation</AlertTitle>
        <AlertDescription>
          This page is restricted to COO/CEO administrators. All actions are logged and require explicit confirmation. No data is deleted without a registered backup and a 7-day cooldown period.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileCheck className="h-5 w-5" /> Step 1: Verification Report</CardTitle>
          <CardDescription>Run a full verification comparing legacy tables to canonical work_items before proceeding</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => verifyQuery.refetch()}
            disabled={verifyQuery.isFetching}
            data-testid="btn-run-verification"
          >
            {verifyQuery.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Run Verification Suite
          </Button>

          {verify && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={verify.overall === "PASS" ? "default" : "destructive"} data-testid="badge-overall-status">
                  {verify.overall === "PASS" ? "ALL CHECKS PASSED" : "CHECKS FAILED"}
                </Badge>
                <span className="text-xs text-muted-foreground">{verify.timestamp}</span>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Check</th>
                      <th className="text-center p-2 font-medium w-20">Status</th>
                      <th className="text-right p-2 font-medium">Legacy</th>
                      <th className="text-right p-2 font-medium">Canonical</th>
                      <th className="text-left p-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(verify.results as VerifyResult[]).map((r: VerifyResult, i: number) => (
                      <tr key={i} className="border-t" data-testid={`row-verify-${i}`}>
                        <td className="p-2">{r.check}</td>
                        <td className="p-2 text-center">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="p-2 text-right font-mono text-xs">{r.legacy}</td>
                        <td className="p-2 text-right font-mono text-xs">{r.canonical}</td>
                        <td className="p-2 text-xs text-muted-foreground">{r.details || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {verify.legacyTableCounts && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Legacy Table Row Counts</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(verify.legacyTableCounts as Record<string, number>).map(([table, count]) => (
                      <div key={table} className="flex items-center justify-between bg-muted/30 rounded px-3 py-1.5 text-xs">
                        <span className="font-mono truncate mr-2">{table}</span>
                        <span className="font-semibold">{count === -1 ? "N/A" : count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {verify.sampleProjects && verify.sampleProjects.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Sample Project Comparison</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2">Project</th>
                          <th className="text-right p-2">Legacy</th>
                          <th className="text-right p-2">Canonical</th>
                          <th className="text-center p-2">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(verify.sampleProjects as any[]).map((sp: any, i: number) => (
                          <tr key={i} className="border-t">
                            <td className="p-2 font-mono truncate max-w-[200px]">{sp.project_name}</td>
                            <td className="p-2 text-right">{sp.legacy_count}</td>
                            <td className="p-2 text-right">{sp.canonical_count}</td>
                            <td className="p-2 text-center">
                              {Number(sp.legacy_count) === Number(sp.canonical_count) ?
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline" /> :
                                <XCircle className="h-3.5 w-3.5 text-red-500 inline" />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Step 2: Register Backup</CardTitle>
          <CardDescription>Record a database backup/snapshot ID before any destructive operations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="backupId" className="text-xs">Backup ID / Snapshot Reference</Label>
              <Input
                id="backupId"
                placeholder="e.g. pg-snapshot-2026-03-02-001"
                value={backupIdInput}
                onChange={e => setBackupIdInput(e.target.value)}
                data-testid="input-backup-id"
              />
            </div>
            <div>
              <Label htmlFor="backupDesc" className="text-xs">Description (optional)</Label>
              <Input
                id="backupDesc"
                placeholder="Pre-migration full backup"
                value={backupDescInput}
                onChange={e => setBackupDescInput(e.target.value)}
                data-testid="input-backup-desc"
              />
            </div>
          </div>
          <Button
            onClick={() => registerBackupMutation.mutate()}
            disabled={!backupIdInput.trim() || backupIdInput.trim().length < 3 || registerBackupMutation.isPending}
            data-testid="btn-register-backup"
          >
            {registerBackupMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
            Register Backup
          </Button>

          {status?.backups && (status.backups as any[]).length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Registered Backups</h4>
              <div className="space-y-1">
                {(status.backups as any[]).map((b: any) => (
                  <div
                    key={b.id}
                    className={`flex items-center justify-between bg-muted/30 rounded px-3 py-2 text-xs cursor-pointer hover:bg-muted/50 transition-colors ${activeBackupId === b.backup_id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setActiveBackupId(b.backup_id)}
                    data-testid={`backup-item-${b.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <FileCheck className="h-3.5 w-3.5 text-green-600" />
                      <span className="font-mono font-medium">{b.backup_id}</span>
                      {b.description && <span className="text-muted-foreground">— {b.description}</span>}
                    </div>
                    <span className="text-muted-foreground">{new Date(b.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              {activeBackupId && (
                <p className="text-xs text-primary mt-1">Selected backup: <span className="font-mono font-semibold">{activeBackupId}</span></p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5" /> Step 3: Check References</CardTitle>
          <CardDescription>Scan for foreign keys, views, and triggers referencing legacy tables</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => refCheckQuery.refetch()}
            disabled={refCheckQuery.isFetching}
            variant="outline"
            data-testid="btn-check-references"
          >
            {refCheckQuery.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
            Scan for Active References
          </Button>

          {refCheck && (
            <div>
              {refCheck.safe ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertTitle>No blocking references found</AlertTitle>
                  <AlertDescription>No foreign keys, views, or triggers from non-legacy tables reference the legacy tables. Safe to proceed.</AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>Active references detected — cannot archive</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      {(refCheck.references as any[]).map((ref: any, i: number) => (
                        <li key={i} className="text-xs">
                          <Badge variant="outline" className="mr-1">{ref.referenceType}</Badge>
                          {ref.detail}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5" /> Step 4: Archive Legacy Tables</CardTitle>
          <CardDescription>Rename legacy tables to *_legacy_archive. This is reversible.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.legacyTables && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              {Object.entries(status.legacyTables as Record<string, any>).map(([table, info]: [string, any]) => (
                <div key={table} className="flex items-center gap-2 bg-muted/30 rounded px-3 py-1.5 text-xs">
                  {info.archived ? (
                    <Archive className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                  ) : info.exists ? (
                    <Database className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="font-mono truncate">{table}</span>
                  <Badge variant="outline" className="ml-auto text-[10px] flex-shrink-0">
                    {info.archived ? "archived" : info.exists ? `${info.rowCount} rows` : "gone"}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {!allArchived && (
            <>
              <Separator />
              <div>
                <Label htmlFor="archiveConfirm" className="text-xs font-medium text-destructive">
                  Type exactly <span className="font-mono bg-muted px-1 rounded">DROP_LEGACY_TABLES</span> to confirm archive
                </Label>
                <Input
                  id="archiveConfirm"
                  placeholder="Type confirmation here..."
                  value={archiveConfirm}
                  onChange={e => setArchiveConfirm(e.target.value)}
                  className="mt-1 font-mono"
                  data-testid="input-archive-confirm"
                />
              </div>
              <Button
                variant="destructive"
                onClick={() => archiveMutation.mutate()}
                disabled={archiveConfirm !== "DROP_LEGACY_TABLES" || !activeBackupId || archiveMutation.isPending}
                data-testid="btn-archive-tables"
              >
                {archiveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />}
                Archive Legacy Tables
              </Button>
              {!activeBackupId && archiveConfirm === "DROP_LEGACY_TABLES" && (
                <p className="text-xs text-destructive">Select a registered backup above before archiving.</p>
              )}
            </>
          )}

          {hasArchivedTables && (
            <>
              <Separator />
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => restoreMutation.mutate()}
                  disabled={restoreMutation.isPending}
                  data-testid="btn-restore-tables"
                >
                  {restoreMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                  Restore Archived Tables
                </Button>
                <span className="text-xs text-muted-foreground">Renames *_legacy_archive back to original names</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" /> Step 5: Permanently Drop Archived Tables</CardTitle>
          <CardDescription>Irreversible. Only available after a {7}-day cooldown from archive date.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.cooldown && (
            <div className="flex items-center gap-3">
              {status.cooldown.dropEnabled ? (
                <Badge className="bg-green-600">Cooldown expired — drop enabled</Badge>
              ) : status.cooldown.archiveDate ? (
                <>
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span className="text-sm">
                    Cooldown: <span className="font-semibold">{status.cooldown.remainingDays} day(s)</span> remaining
                    (until {new Date(status.cooldown.cooldownEnd).toLocaleDateString()})
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">No tables archived yet — archive first.</span>
              )}
            </div>
          )}

          {status?.cooldown?.dropEnabled && (
            <>
              <Separator />
              <div>
                <Label htmlFor="dropConfirm" className="text-xs font-medium text-destructive">
                  Type exactly <span className="font-mono bg-muted px-1 rounded">DROP_LEGACY_TABLES</span> to permanently delete
                </Label>
                <Input
                  id="dropConfirm"
                  placeholder="Type confirmation here..."
                  value={dropConfirm}
                  onChange={e => setDropConfirm(e.target.value)}
                  className="mt-1 font-mono"
                  data-testid="input-drop-confirm"
                />
              </div>
              <Button
                variant="destructive"
                onClick={() => dropMutation.mutate()}
                disabled={dropConfirm !== "DROP_LEGACY_TABLES" || dropMutation.isPending}
                data-testid="btn-drop-tables"
              >
                {dropMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Permanently Drop Archived Tables
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {status?.logs && (status.logs as any[]).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Migration Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Action</th>
                    <th className="text-left p-2">Table</th>
                    <th className="text-right p-2">Rows</th>
                    <th className="text-left p-2">By</th>
                    <th className="text-left p-2">Backup</th>
                    <th className="text-center p-2">Reversible</th>
                    <th className="text-left p-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(status.logs as any[]).map((log: any) => (
                    <tr key={log.id} className="border-t" data-testid={`row-log-${log.id}`}>
                      <td className="p-2">
                        <Badge variant={log.action === "DROP" ? "destructive" : log.action === "RESTORE" ? "default" : "secondary"}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="p-2 font-mono">{log.table_name}</td>
                      <td className="p-2 text-right">{log.row_count?.toLocaleString() ?? "—"}</td>
                      <td className="p-2">{log.performed_by_name || "—"}</td>
                      <td className="p-2 font-mono">{log.backup_id || "—"}</td>
                      <td className="p-2 text-center">{log.reversible ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline" /> : <XCircle className="h-3.5 w-3.5 text-red-500 inline" />}</td>
                      <td className="p-2">{new Date(log.performed_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS") return <Badge className="bg-green-600 text-[10px]">PASS</Badge>;
  if (status === "FAIL") return <Badge variant="destructive" className="text-[10px]">FAIL</Badge>;
  if (status === "WARN") return <Badge className="bg-amber-500 text-[10px]">WARN</Badge>;
  return <Badge variant="outline" className="text-[10px]">SKIP</Badge>;
}

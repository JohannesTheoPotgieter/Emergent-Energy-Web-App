import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Save,
  KeyRound,
  FolderSync,
  AlertTriangle,
  Check,
  X,
  PackageSearch,
  RefreshCw,
} from "lucide-react";
import {
  COMPANY_ROLES,
  COMPANY_ROLE_LABELS,
  type CompanyRole,
} from "@shared/schema";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchSetting(key: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, {
      credentials: "include",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch {
    return null;
  }
}

async function saveSetting(key: string, value: string): Promise<boolean> {
  const res = await fetch("/api/settings", {
    credentials: "include",
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ key, value }),
  });
  return res.ok;
}

export default function RoleSettingsPage() {
  const { toast } = useToast();
  const companyRole = localStorage.getItem("company_role");

  if (companyRole !== "COO_ADMIN") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">Only COO Admin can access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1000px] mx-auto" data-testid="role-settings-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900" data-testid="text-page-title">
          Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">Manage role passwords, sync settings, and procurement analysis</p>
      </header>

      <ProcurementAnalysisSection toast={toast} />
      <RolePasswordsSection toast={toast} />
      <SyncRootSection toast={toast} />
    </div>
  );
}

function ProcurementAnalysisSection({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ costLines: number; counterparties: number; sourceExpenses: number } | null>(null);
  const [lastResult, setLastResult] = useState<{ costLines: number; counterpartiesCreated: number; counterpartiesMatched: number; projects: number; message: string } | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/procurement-analysis/status", { credentials: "include", headers: getAuthHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const handleRun = async () => {
    setRunning(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/procurement-analysis/run", {
        credentials: "include",
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Procurement analysis failed", variant: "destructive" });
        return;
      }
      setLastResult(data);
      toast({ title: "Procurement Analysis Complete", description: data.message });
      loadStatus();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to run procurement analysis", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card data-testid="procurement-analysis-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageSearch className="h-5 w-5" />
          Procurement Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Rebuild the procurement cost line data from current expense records. This processes all expenses, extracts supplier names, creates counterparty records, and populates the Procurement dashboard.
        </p>

        {status && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-slate-900" data-testid="text-source-expenses">{status.sourceExpenses.toLocaleString()}</div>
              <div className="text-xs text-slate-500">Source Expenses</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700" data-testid="text-cost-lines">{status.costLines.toLocaleString()}</div>
              <div className="text-xs text-slate-500">Cost Lines</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-emerald-700" data-testid="text-counterparties">{status.counterparties.toLocaleString()}</div>
              <div className="text-xs text-slate-500">Counterparties</div>
            </div>
          </div>
        )}

        {lastResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3" data-testid="procurement-result">
            <p className="text-sm font-medium text-green-800">Analysis Complete</p>
            <p className="text-xs text-green-700 mt-1">{lastResult.message}</p>
            <div className="flex gap-4 mt-2 text-xs text-green-600">
              <span>{lastResult.costLines} cost lines</span>
              <span>{lastResult.counterpartiesCreated} new suppliers</span>
              <span>{lastResult.counterpartiesMatched} matched</span>
              <span>{lastResult.projects} projects</span>
            </div>
          </div>
        )}

        <Button onClick={handleRun} disabled={running} data-testid="btn-run-procurement">
          {running ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running Analysis...</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" /> Run Procurement Analysis</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function RolePasswordsSection({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState<Record<string, { password: string | null; updatedAt: string | null }>>({});

  useEffect(() => {
    loadPasswords();
  }, []);

  const loadPasswords = async () => {
    try {
      const res = await fetch("/api/role-auth/passwords", { credentials: "include", headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, { password: string | null; updatedAt: string | null }> = {};
        for (const c of data) {
          map[c.role] = { password: c.lastPasswordPlain, updatedAt: c.updatedAt };
        }
        setPasswords(map);
      }
    } catch {}
  };

  const handleChangePassword = async (targetRole: string) => {
    if (!newPassword || newPassword.length < 4) {
      toast({ title: "Error", description: "Password must be at least 4 characters.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/role-auth/password", {
        credentials: "include",
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ targetRole, newPassword }),
      });
      if (res.ok) {
        toast({ title: "Password Updated", description: `Password changed for ${COMPANY_ROLE_LABELS[targetRole as CompanyRole]}.` });
        setEditingRole(null);
        setNewPassword("");
        loadPasswords();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.message || "Failed to change password.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to change password.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="card-role-passwords">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-green-600" />
          Role Passwords
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {COMPANY_ROLES.map((role) => {
            const info = passwords[role];
            return (
              <div
                key={role}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                data-testid={`role-password-row-${role}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800" data-testid={`text-role-label-${role}`}>
                      {COMPANY_ROLE_LABELS[role]}
                    </span>
                    <span className="text-xs text-gray-400">{role}</span>
                  </div>
                  {info?.password && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-gray-500">Current:</span>
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700" data-testid={`text-current-password-${role}`}>
                        {info.password}
                      </code>
                    </div>
                  )}
                </div>

                {editingRole === role ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="New password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-48 h-8 text-sm"
                      data-testid={`input-password-${role}`}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleChangePassword(role);
                        if (e.key === "Escape") { setEditingRole(null); setNewPassword(""); }
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-8 bg-green-600 hover:bg-green-700"
                      onClick={() => handleChangePassword(role)}
                      disabled={saving}
                      data-testid={`button-confirm-password-${role}`}
                    >
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => { setEditingRole(null); setNewPassword(""); }}
                      data-testid={`button-cancel-password-${role}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => { setEditingRole(role); setNewPassword(""); }}
                    data-testid={`button-change-password-${role}`}
                  >
                    Change Password
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function SyncRootSection({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [syncRoot, setSyncRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSetting("global_sync_root").then((val) => {
      if (val) setSyncRoot(val);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const ok = await saveSetting("global_sync_root", syncRoot);
      if (ok) {
        toast({ title: "Saved", description: "Global sync root updated." });
      } else {
        toast({ title: "Error", description: "Failed to save sync root.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save sync root.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="card-sync-root">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FolderSync className="h-4 w-4 text-green-600" />
          Local Sync Root
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700" data-testid="label-sync-root">
                Global Default Sync Root
              </label>
              <Input
                value={syncRoot}
                onChange={(e) => setSyncRoot(e.target.value)}
                placeholder="C:\Users\...\OneDrive - Emergent Energy\"
                className="font-mono text-sm"
                data-testid="input-sync-root"
              />
              <p className="text-xs text-gray-400">
                Base path for local file sync across all roles
              </p>
            </div>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-green-600 hover:bg-green-700"
              data-testid="button-save-sync-root"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}


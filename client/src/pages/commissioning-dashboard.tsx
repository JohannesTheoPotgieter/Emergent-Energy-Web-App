/**
 * Commissioning Control Tower Dashboard
 *
 * Workbook-driven commissioning overview — not a duplicate capture surface.
 * Shows status, blockers, completeness, source links, and sync state.
 * Links to source workbook/shared folder for detailed evidence.
 */
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  ExternalLink,
  FolderOpen,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Shield,
  Loader2,
  Upload,
  Ban,
  HelpCircle,
  Hourglass,
} from "lucide-react";
import type {
  CommissioningDashboardPayload,
  CommissioningSection,
  CommissioningDisplayStatus,
  OmHandoverChecklistItem,
} from "@shared/schema/commissioning-source";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) h["X-CSRF-Token"] = csrf;
  return h;
}

const STATUS_CONFIG: Record<CommissioningDisplayStatus, { label: string; color: string; icon: React.ElementType }> = {
  complete: { label: "Complete", color: "bg-green-100 text-green-800 border-green-300", icon: CheckCircle2 },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-800 border-blue-300", icon: Clock },
  awaiting_external: { label: "Awaiting External", color: "bg-amber-100 text-amber-800 border-amber-300", icon: Hourglass },
  not_started: { label: "Not Started", color: "bg-gray-100 text-gray-600 border-gray-300", icon: Circle },
  not_applicable: { label: "N/A", color: "bg-gray-50 text-gray-500 border-gray-200", icon: Ban },
  blocked: { label: "Blocked", color: "bg-red-100 text-red-800 border-red-300", icon: XCircle },
  unknown: { label: "Unknown", color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: HelpCircle },
};

function StatusBadge({ status }: { status: CommissioningDisplayStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.color} text-xs gap-1`}>
      <Icon className="h-3 w-3" /> {config.label}
    </Badge>
  );
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "\u2014";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); } catch { return d; }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function OmHandoverChecklist({ items }: { items: OmHandoverChecklistItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  return (
    <Card>
      <button className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium text-sm">O&M Handover Checklist</span>
          <span className="text-xs text-muted-foreground">{items.length} items</span>
        </div>
      </button>
      {expanded && (
        <CardContent className="border-t pt-3 pb-3 px-4">
          <table className="w-full text-xs">
            <thead><tr className="border-b text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">Document</th>
              <th className="text-left py-1.5 pr-3 font-medium w-28">Status</th>
              <th className="text-left py-1.5 font-medium hidden sm:table-cell">Comments</th>
            </tr></thead>
            <tbody>{items.map((item, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                <td className="py-1.5 pr-3">{item.documentName}</td>
                <td className="py-1.5 pr-3">{item.status || "\u2014"}</td>
                <td className="py-1.5 hidden sm:table-cell text-muted-foreground truncate max-w-[200px]">{item.comments || "\u2014"}</td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      )}
    </Card>
  );
}

export default function CommissioningDashboardPage() {
  const [, paramsWithId] = useRoute("/commissioning-dashboard/:projectId");
  const urlProjectId = paramsWithId?.projectId ? parseInt(paramsWithId.projectId) : undefined;
  const [, setLocation] = useLocation();

  const { projectsSummary, isLoading: projectsLoading } = useProjectsSummary();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(urlProjectId);
  const projectId = urlProjectId || selectedProjectId;

  const projectOptions = useMemo(() => {
    if (!projectsSummary) return [];

    const seenIds = new Set<number>();
    const malformed: Array<{ index: number; projectId: unknown; projectName: unknown }> = [];
    const duplicateIds: number[] = [];

    const options = projectsSummary
      .map((p: any, index: number) => {
        const canonicalId = Number(
          p?.shared_summary?.project?.canonicalProjectId
          ?? p?.project_info_id
          ?? p?.id
        );
        const canonicalName =
          p?.shared_summary?.project?.projectName
          ?? p?.project_name
          ?? p?.projectName
          ?? p?.name
          ?? null;

        if (!Number.isFinite(canonicalId) || canonicalId <= 0 || typeof canonicalName !== "string" || !canonicalName.trim()) {
          malformed.push({ index, projectId: p?.project_info_id ?? p?.id, projectName: p?.project_name ?? p?.projectName ?? p?.name });
          return null;
        }

        if (seenIds.has(canonicalId)) {
          duplicateIds.push(canonicalId);
          return null;
        }

        seenIds.add(canonicalId);
        return { value: String(canonicalId), label: canonicalName.trim() };
      })
      .filter((option): option is { value: string; label: string } => option !== null)
      .sort((a, b) => a.label.localeCompare(b.label));

    if (import.meta.env.DEV && malformed.length > 0) {
      console.warn("[commissioning-dashboard] Excluding malformed project records from selector", malformed);
    }
    if (import.meta.env.DEV && duplicateIds.length > 0) {
      console.warn("[commissioning-dashboard] Excluding duplicate project IDs from selector", duplicateIds);
    }

    return options;
  }, [projectsSummary]);

  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError } = useQuery<CommissioningDashboardPayload>({
    queryKey: ["commissioning-dashboard", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/commissioning-dashboard/${projectId}`, { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: "Failed to load" })); throw new Error(err.error); }
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const dashboardErrorMessage = dashboardError instanceof Error ? dashboardError.message : "Failed to load";

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/commissioning-dashboard/${projectId}/refresh`, { method: "POST", headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: "Refresh failed" })); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commissioning-dashboard", projectId] }); },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId || isUploading) return;
    const formData = new FormData();
    formData.append("file", file);
    setIsUploading(true);
    try {
      const headers: Record<string, string> = {};
      const token = localStorage.getItem("auth_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch(`/api/commissioning-dashboard/${projectId}/upload`, { method: "POST", headers, credentials: "include", body: formData });
      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (!res.ok) {
        const detail = payload?.detail || payload?.parseMessage || payload?.error || "Upload failed";
        const warningText = Array.isArray(payload?.warnings) ? payload.warnings.join(" | ") : "";
        toast({
          title: "Workbook upload failed",
          description: warningText ? `${detail} — ${warningText}` : detail,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Workbook uploaded",
        description: payload?.warnings?.length
          ? `Upload parsed with ${payload.warnings.length} warning(s).`
          : "Commissioning snapshot refreshed successfully.",
      });

      await queryClient.invalidateQueries({ queryKey: ["commissioning-dashboard", projectId] });
      await queryClient.refetchQueries({ queryKey: ["commissioning-dashboard", projectId], type: "active" });
    } catch (err) {
      console.error("Upload failed:", err);
      toast({
        title: "Workbook upload failed",
        description: err instanceof Error ? err.message : "Unexpected error during upload",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
    e.target.value = "";
  };

  // Project selector mode (no projectId in URL)
  if (!urlProjectId) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Commissioning Control Tower</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Select a project to view commissioning status</p>
        </div>
        <Card><CardContent className="py-6 px-4 space-y-3">
          <label className="text-sm font-medium">Project</label>
          <SearchableSelect
            options={projectOptions}
            value={selectedProjectId ? String(selectedProjectId) : ""}
            onValueChange={(val) => { if (val) setLocation(`/commissioning-dashboard/${val}`); }}
            placeholder={projectsLoading ? "Loading projects..." : "Search and select a project"}
          />
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Commissioning Control Tower</h1>
          {dashboard && <p className="text-sm text-muted-foreground mt-0.5">{dashboard.projectName}</p>}
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={handleFileUpload} />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {isUploading ? "Uploading..." : "Upload"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Loading / Error */}
      {dashboardLoading && <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...</div>}
      {dashboardError && <Card className="border-red-200 bg-red-50"><CardContent className="py-4 text-sm text-red-800"><AlertTriangle className="inline h-4 w-4 mr-1" />{dashboardErrorMessage}</CardContent></Card>}

      {dashboard && !dashboardLoading && (<>
        {/* Project info from workbook + source links */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="space-y-1">
            {dashboard.projectInfo?.siteAddress && <p className="text-xs text-muted-foreground">Site: {dashboard.projectInfo.siteAddress}</p>}
            {dashboard.projectInfo?.commissioningDate && <p className="text-xs text-muted-foreground">Commissioning Date: {formatDate(dashboard.projectInfo.commissioningDate)}</p>}
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={dashboard.overallStatus} />
              <span className="text-sm text-muted-foreground">{dashboard.completionPercent}% complete</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dashboard.source?.workbookUrl && (
              <a href={dashboard.source.workbookUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs bg-green-50 border border-green-200 text-green-800 rounded-md px-3 py-1.5 hover:bg-green-100 transition-colors">
                <ExternalLink className="h-3.5 w-3.5" /> Open Workbook
              </a>
            )}
            {dashboard.source?.folderUrl && (
              <a href={dashboard.source.folderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-md px-3 py-1.5 hover:bg-blue-100 transition-colors">
                <FolderOpen className="h-3.5 w-3.5" /> Shared Folder
              </a>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <Card><CardContent className="py-4 px-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm font-semibold">{dashboard.completionPercent}%</span>
          </div>
          <Progress value={dashboard.completionPercent} className="h-2" />
        </CardContent></Card>

        {/* Sync state */}
        <Card className={dashboard.syncState.isStale ? "border-amber-200 bg-amber-50/50" : ""}>
          <CardContent className="py-3 px-4 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {dashboard.syncState.isStale ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
              <span>Last refreshed: <strong>{timeAgo(dashboard.syncState.lastRefreshed)}</strong></span>
              {dashboard.syncState.parseStatus && <Badge variant="outline" className="text-[10px]">{dashboard.syncState.parseStatus}</Badge>}
            </div>
            {dashboard.syncState.parseMessage && <span className="text-muted-foreground hidden sm:inline truncate max-w-xs">{dashboard.syncState.parseMessage}</span>}
          </CardContent>
        </Card>

        {/* No source configured */}
        {!dashboard.source && (
          <Card className="border-amber-200 bg-amber-50"><CardContent className="py-6 text-center">
            <FileSpreadsheet className="h-6 w-6 mx-auto mb-2 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">No commissioning source configured</p>
            <p className="text-xs text-amber-700 mt-1">Upload a workbook manually or configure a SharePoint source.</p>
          </CardContent></Card>
        )}

        {/* Blockers */}
        {dashboard.blockers.length > 0 && (
          <Card className="border-red-200 bg-red-50/50">
            <CardHeader className="py-3 px-4"><CardTitle className="text-sm flex items-center gap-2 text-red-800">
              <XCircle className="h-4 w-4" /> Final Completion Blockers ({dashboard.blockers.length})
            </CardTitle></CardHeader>
            <CardContent className="py-0 pb-3 px-4">
              <ul className="space-y-1">{dashboard.blockers.map((b, i) => (
                <li key={i} className="text-xs text-red-700 flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {b}</li>
              ))}</ul>
            </CardContent>
          </Card>
        )}

        {/* SSEG Status */}
        {(dashboard.ssegStatus?.application || dashboard.ssegStatus?.approval) && (
          <Card>
            <CardHeader className="py-3 px-4"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> SSEG Status</CardTitle></CardHeader>
            <CardContent className="py-0 pb-3 px-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {dashboard.ssegStatus.application && <div className="rounded-md border p-2"><div className="text-muted-foreground mb-0.5">SSEG Application</div><div className="font-medium">{dashboard.ssegStatus.application}</div></div>}
                {dashboard.ssegStatus.approval && <div className="rounded-md border p-2"><div className="text-muted-foreground mb-0.5">SSEG Approval</div><div className="font-medium">{dashboard.ssegStatus.approval}</div></div>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section Summary Table */}
        {dashboard.sections.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Section Status</CardTitle></CardHeader>
            <CardContent className="py-0 pb-3 px-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">Section</th>
                    <th className="text-left py-2 pr-3 font-medium">Status</th>
                    <th className="text-center py-2 pr-3 font-medium">Gate</th>
                    <th className="text-left py-2 pr-3 font-medium hidden sm:table-cell">Approved By</th>
                    <th className="text-left py-2 font-medium hidden md:table-cell">Date</th>
                  </tr></thead>
                  <tbody>{dashboard.sections.map((section) => (
                    <tr key={section.sectionKey} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{section.sectionName}</td>
                      <td className="py-2 pr-3"><StatusBadge status={section.displayStatus} /></td>
                      <td className="py-2 pr-3 text-center">
                        {section.isRequired ? (
                          section.isCompleteForGate
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline" />
                            : <XCircle className="h-3.5 w-3.5 text-red-500 inline" />
                        ) : <span className="text-muted-foreground">\u2014</span>}
                      </td>
                      <td className="py-2 pr-3 hidden sm:table-cell">{section.approvedBy || "\u2014"}</td>
                      <td className="py-2 hidden md:table-cell">{formatDate(section.approvalDate)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* O&M Handover Checklist */}
        <OmHandoverChecklist items={dashboard.omHandoverChecklist || []} />

        {/* Empty state */}
        {dashboard.sections.length === 0 && dashboard.source && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">
            <p className="text-sm">No commissioning sections parsed yet.</p>
            <p className="text-xs mt-1">Click Refresh to parse the source workbook.</p>
          </CardContent></Card>
        )}
      </>)}
    </div>
  );
}

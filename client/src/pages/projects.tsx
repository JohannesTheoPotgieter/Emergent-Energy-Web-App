import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Search,
  AlertCircle,
  Check,
  Link2,
  Ban,
  Clock,
  CheckCircle2,
  ExternalLink,
  X,
  FileText,
  Shield,
} from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface ProjectSummary {
  project_name: string;
  size_kwp: number | null;
  pd: string | null;
  pm: string | null;
  cost_proposal_signed: string | null;
  cost_proposal_type: string | null;
  cost_proposal_link: string | null;
  cost_proposal_na_reason: string | null;
  funding_signed: string | null;
  funding_type: string | null;
  funding_link: string | null;
  funding_na_reason: string | null;
  epc_contract_signed: string | null;
  epc_contract_type: string | null;
  epc_contract_link: string | null;
  epc_contract_na_reason: string | null;
  financial_close_achieved: boolean;
  phase: string | null;
  pd_handover_date: string | null;
  construction_start_date: string | null;
  duration: number | null;
  kw_per_week: number | null;
  commissioning_date: string | null;
  om_handover_date: string | null;
  client_handover_date: string | null;
  project_pct_complete: number | null;
  expected_pct_complete: number | null;
  delta_vs_expected: number | null;
  actual_revenue: number | null;
  actual_expenses: number | null;
  gp_percent: number | null;
  revenue_outstanding: number | null;
  expenses_due: number | null;
  current_vo_total: number | null;
  comments: string | null;
}

type SortDir = "asc" | "desc";
type SortKey = string;

function formatRand(val: number | null): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `R ${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `R ${(val / 1_000).toFixed(1)}K`;
  return `R ${val.toFixed(0)}`;
}

function formatDate(val: string | null): string {
  if (!val) return "—";
  try {
    const d = new Date(val + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    const day = d.getDate().toString().padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mon = months[d.getMonth()];
    const yr = d.getFullYear().toString().slice(-2);
    return `${day} ${mon} ${yr}`;
  } catch {
    return "—";
  }
}

function formatPct(val: number | null): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

function safeNum(val: number | null): number {
  return val !== null && val !== undefined && Number.isFinite(val) ? val : 0;
}

function phaseColor(phase: string | null): string {
  switch (phase) {
    case "Construction": return "bg-blue-100 text-blue-800 border-blue-200";
    case "Development": return "bg-purple-100 text-purple-800 border-purple-200";
    case "Commissioning": return "bg-green-100 text-green-800 border-green-200";
    case "Complete": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "O&M": return "bg-teal-100 text-teal-800 border-teal-200";
    default: return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function EditableCell({
  value,
  type,
  projectName,
  field,
  displayValue,
}: {
  value: string | number | null;
  type: "text" | "date" | "number";
  projectName: string;
  field: string;
  displayValue: string;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(value ?? "");
  const [saved, setSaved] = useState(false);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (newVal: string | number | null) => {
      await apiRequest("POST", `/api/projects-summary/${encodeURIComponent(projectName)}/edit`, {
        [field]: newVal,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  const save = useCallback(() => {
    setEditing(false);
    let submitVal: string | number | null = localVal;
    if (type === "number") {
      submitVal = localVal === "" ? null : Number(localVal);
    } else if (type === "date") {
      submitVal = localVal === "" ? null : String(localVal);
    } else {
      submitVal = localVal === "" ? null : String(localVal);
    }
    if (submitVal !== value) {
      mutation.mutate(submitVal);
    }
  }, [localVal, value, type, mutation]);

  if (editing) {
    return (
      <input
        data-testid={`edit-input-${field}-${projectName}`}
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        className="w-full h-6 text-xs border border-blue-300 rounded px-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        autoFocus
      />
    );
  }

  return (
    <div
      data-testid={`editable-${field}-${projectName}`}
      className="cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 min-h-[20px] flex items-center gap-1"
      onClick={() => {
        setLocalVal(value ?? "");
        setEditing(true);
      }}
    >
      <span className="text-xs">{displayValue}</span>
      {saved && <Check className="w-3 h-3 text-green-500" />}
      {mutation.isPending && <span className="w-3 h-3 border-2 border-blue-300 border-t-transparent rounded-full animate-spin inline-block" />}
    </div>
  );
}

type FinCloseMode = "link" | "na" | null;

function FinancialCloseCell({
  projectName,
  fieldPrefix,
  type,
  link,
  naReason,
  isAdmin,
}: {
  projectName: string;
  fieldPrefix: "costProposal" | "funding" | "epcContract";
  type: string | null;
  link: string | null;
  naReason: string | null;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FinCloseMode>((type as FinCloseMode) || null);
  const [linkVal, setLinkVal] = useState(link || "");
  const [reason, setReason] = useState(naReason || "");
  const [saved, setSaved] = useState(false);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, string | null>) => {
      await apiRequest("POST", `/api/projects-summary/${encodeURIComponent(projectName)}/edit`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setSaved(true);
      setOpen(false);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = () => {
    const payload: Record<string, string | null> = {};
    payload[`${fieldPrefix}Type`] = mode;
    payload[`${fieldPrefix}Link`] = mode === "link" ? linkVal : null;
    payload[`${fieldPrefix}NaReason`] = mode === "na" ? reason : null;
    mutation.mutate(payload);
  };

  const handleClear = () => {
    const payload: Record<string, string | null> = {};
    payload[`${fieldPrefix}Type`] = null;
    payload[`${fieldPrefix}Link`] = null;
    payload[`${fieldPrefix}NaReason`] = null;
    mutation.mutate(payload);
  };

  const openDialog = () => {
    setMode((type as FinCloseMode) || null);
    setLinkVal(link || "");
    setReason(naReason || "");
    setOpen(true);
  };

  const label = fieldPrefix === "costProposal" ? "Cost Proposal" : fieldPrefix === "funding" ? "Funding" : "EPC Contract";

  if (type === "link") {
    return (
      <div className="flex items-center gap-1" data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        <a
          href={link || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-medium transition-colors max-w-[120px] truncate"
          title={link || ""}
          data-testid={`link-fclose-${fieldPrefix}-${projectName}`}
        >
          <Link2 className="w-3 h-3 shrink-0" />
          <span className="truncate">{link ? "SharePoint" : "Linked"}</span>
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
        </a>
        {isAdmin && (
          <button onClick={openDialog} className="p-0.5 hover:bg-slate-100 rounded transition-colors" data-testid={`btn-edit-${fieldPrefix}-${projectName}`}>
            <FileText className="w-3 h-3 text-slate-400" />
          </button>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  }

  if (type === "na") {
    return (
      <div className="flex items-center gap-1" data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-medium cursor-help"
          title={`N/A: ${naReason || "No reason provided"}`}
        >
          <Ban className="w-3 h-3" />
          N/A
        </span>
        {isAdmin && (
          <button onClick={openDialog} className="p-0.5 hover:bg-slate-100 rounded transition-colors" data-testid={`btn-edit-${fieldPrefix}-${projectName}`}>
            <FileText className="w-3 h-3 text-slate-400" />
          </button>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1" data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        {isAdmin ? (
          <button
            onClick={openDialog}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 text-[10px] font-medium transition-colors"
            data-testid={`btn-set-${fieldPrefix}-${projectName}`}
          >
            <Clock className="w-3 h-3" />
            Pending
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-medium">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid={`dialog-fclose-${fieldPrefix}`}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-5 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-lg">{label} Signed</h3>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600">
                Project: <strong>{projectName.replace(/_Tracker.*$/i, '')}</strong>
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMode("link")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    mode === "link" ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                  data-testid="btn-mode-link"
                >
                  <Link2 className={`w-6 h-6 ${mode === "link" ? "text-emerald-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-semibold ${mode === "link" ? "text-emerald-700" : "text-slate-600"}`}>Link File</span>
                  <span className="text-[10px] text-slate-400">SharePoint path</span>
                </button>
                <button
                  onClick={() => setMode("na")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    mode === "na" ? "border-slate-500 bg-slate-50 shadow-sm" : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                  data-testid="btn-mode-na"
                >
                  <Ban className={`w-6 h-6 ${mode === "na" ? "text-slate-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-semibold ${mode === "na" ? "text-slate-700" : "text-slate-600"}`}>Not Applicable</span>
                  <span className="text-[10px] text-slate-400">With reason</span>
                </button>
              </div>

              {mode === "link" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600">SharePoint Folder / File Path</label>
                  <Input
                    placeholder="https://company.sharepoint.com/sites/..."
                    value={linkVal}
                    onChange={(e) => setLinkVal(e.target.value)}
                    className="text-sm"
                    data-testid="input-sharepoint-link"
                  />
                  <p className="text-[10px] text-slate-400">Paste the full SharePoint URL or folder path where the signed document is stored</p>
                </div>
              )}

              {mode === "na" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600">Reason for N/A</label>
                  <Input
                    placeholder="e.g. Self-funded, no external funding required"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="text-sm"
                    data-testid="input-na-reason"
                  />
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t bg-slate-50/50 flex items-center justify-between">
              {type && (
                <Button variant="ghost" size="sm" onClick={handleClear} className="text-red-600 hover:text-red-700 hover:bg-red-50" data-testid="btn-clear">
                  Clear
                </Button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} data-testid="btn-cancel">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!mode || (mode === "link" && !linkVal.trim()) || (mode === "na" && !reason.trim()) || mutation.isPending}
                  data-testid="btn-save-fclose"
                >
                  {mutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ProjectsSummary() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [pmFilter, setPmFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("project_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { isAdmin } = useAuth();

  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch projects summary");
      return res.json();
    },
  });

  const uniquePMs = useMemo(() => {
    const pms = new Set<string>();
    projects.forEach((p) => { if (p.pm) pms.add(p.pm); });
    return Array.from(pms).sort();
  }, [projects]);

  const uniquePhases = useMemo(() => {
    const phases = new Set<string>();
    projects.forEach((p) => { if (p.phase) phases.add(p.phase); });
    return Array.from(phases).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    let result = [...projects];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((p) => p.project_name.toLowerCase().includes(term));
    }
    if (pmFilter !== "all") {
      result = result.filter((p) => p.pm === pmFilter);
    }
    if (phaseFilter !== "all") {
      result = result.filter((p) => p.phase === phaseFilter);
    }
    return result;
  }, [projects, searchTerm, pmFilter, phaseFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const diff = Number(aVal) - Number(bVal);
      return sortDir === "asc" ? diff : -diff;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-blue-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-blue-600" />;
  };

  const totals = useMemo(() => ({
    size_kwp: sorted.reduce((s, p) => s + safeNum(p.size_kwp), 0),
    actual_revenue: sorted.reduce((s, p) => s + safeNum(p.actual_revenue), 0),
    actual_expenses: sorted.reduce((s, p) => s + safeNum(p.actual_expenses), 0),
    revenue_outstanding: sorted.reduce((s, p) => s + safeNum(p.revenue_outstanding), 0),
    expenses_due: sorted.reduce((s, p) => s + safeNum(p.expenses_due), 0),
    current_vo_total: sorted.reduce((s, p) => s + safeNum(p.current_vo_total), 0),
  }), [sorted]);

  const handleExport = () => {
    window.location.href = "/api/export/projects-summary";
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Projects Summary</h2>
        <div className="h-96 bg-muted/20 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-heading font-bold text-foreground">Projects Summary</h2>
          <p className="text-muted-foreground">Portfolio status, financial progress, and key performance indicators.</p>
        </div>
        <Card className="border-2 border-dashed border-muted">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Projects Available</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Upload tracker files to populate the Projects Summary dashboard with financial metrics,
              progress tracking, and outstanding items.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const columns: {
    key: string;
    header: string;
    sticky?: boolean;
    align?: string;
    render: (p: ProjectSummary) => React.ReactNode;
    summaryValue?: React.ReactNode;
  }[] = [
    {
      key: "project_name",
      header: "Project Name",
      sticky: true,
      render: (p) => (
        <button
          data-testid={`link-project-${p.project_name}`}
          className="text-left font-semibold text-blue-700 hover:text-blue-900 hover:underline truncate max-w-[200px] block"
          onClick={() => setLocation(`/project/${encodeURIComponent(p.project_name)}`)}
        >
          {p.project_name}
        </button>
      ),
    },
    {
      key: "size_kwp",
      header: "kWp",
      align: "right",
      render: (p) => <span className="font-mono">{p.size_kwp != null ? p.size_kwp.toFixed(0) : "—"}</span>,
      summaryValue: <span className="font-mono font-bold">{totals.size_kwp.toFixed(0)}</span>,
    },
    { key: "pd", header: "PD", render: (p) => p.pd || "—" },
    { key: "pm", header: "PM", render: (p) => p.pm || "—" },
    {
      key: "cost_proposal_signed",
      header: "Cost Proposal",
      render: (p) => (
        <FinancialCloseCell
          projectName={p.project_name}
          fieldPrefix="costProposal"
          type={p.cost_proposal_type}
          link={p.cost_proposal_link}
          naReason={p.cost_proposal_na_reason}
          isAdmin={isAdmin}
        />
      ),
    },
    {
      key: "funding_signed",
      header: "Funding",
      render: (p) => (
        <FinancialCloseCell
          projectName={p.project_name}
          fieldPrefix="funding"
          type={p.funding_type}
          link={p.funding_link}
          naReason={p.funding_na_reason}
          isAdmin={isAdmin}
        />
      ),
    },
    {
      key: "epc_contract_signed",
      header: "EPC Contract",
      render: (p) => (
        <FinancialCloseCell
          projectName={p.project_name}
          fieldPrefix="epcContract"
          type={p.epc_contract_type}
          link={p.epc_contract_link}
          naReason={p.epc_contract_na_reason}
          isAdmin={isAdmin}
        />
      ),
    },
    {
      key: "financial_close",
      header: "Financial Close",
      render: (p) => {
        const achieved = p.financial_close_achieved;
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
              achieved
                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}
            data-testid={`badge-fclose-${p.project_name}`}
          >
            {achieved ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {achieved ? "Achieved" : "Incomplete"}
          </span>
        );
      },
    },
    {
      key: "phase",
      header: "Phase",
      render: (p) => (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${phaseColor(p.phase)}`}>
          {p.phase || "Unknown"}
        </span>
      ),
    },
    { key: "pd_handover_date", header: "PD Handover", render: (p) => formatDate(p.pd_handover_date) },
    { key: "construction_start_date", header: "Construction Start", render: (p) => formatDate(p.construction_start_date) },
    {
      key: "duration",
      header: "Duration (days)",
      align: "right",
      render: (p) => <span className="font-mono">{p.duration != null ? p.duration : "—"}</span>,
    },
    {
      key: "kw_per_week",
      header: "kW/Week",
      align: "right",
      render: (p) => <span className="font-mono">{p.kw_per_week != null ? p.kw_per_week.toFixed(1) : "—"}</span>,
    },
    { key: "commissioning_date", header: "Commissioning", render: (p) => formatDate(p.commissioning_date) },
    { key: "om_handover_date", header: "O&M Handover", render: (p) => formatDate(p.om_handover_date) },
    { key: "client_handover_date", header: "Client Handover", render: (p) => formatDate(p.client_handover_date) },
    {
      key: "project_pct_complete",
      header: "% Complete",
      render: (p) => {
        const pct = p.project_pct_complete != null ? p.project_pct_complete * 100 : 0;
        return (
          <div className="flex items-center gap-1 min-w-[80px]">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="font-mono text-[10px] w-10 text-right">{pct.toFixed(1)}%</span>
          </div>
        );
      },
    },
    {
      key: "expected_pct_complete",
      header: "Expected %",
      align: "right",
      render: (p) => <span className="font-mono">{formatPct(p.expected_pct_complete)}</span>,
    },
    {
      key: "delta_vs_expected",
      header: "Delta",
      align: "right",
      render: (p) => {
        if (p.delta_vs_expected == null) return "—";
        const val = p.delta_vs_expected * 100;
        const color = val >= 0 ? "text-emerald-600" : "text-rose-600";
        const sign = val >= 0 ? "+" : "";
        return <span className={`font-mono ${color}`}>{sign}{val.toFixed(1)}%</span>;
      },
    },
    {
      key: "actual_revenue",
      header: "Actual Revenue",
      align: "right",
      render: (p) => <span className="font-mono">{formatRand(p.actual_revenue)}</span>,
      summaryValue: <span className="font-mono font-bold">{formatRand(totals.actual_revenue)}</span>,
    },
    {
      key: "actual_expenses",
      header: "Actual Expenses",
      align: "right",
      render: (p) => <span className="font-mono">{formatRand(p.actual_expenses)}</span>,
      summaryValue: <span className="font-mono font-bold">{formatRand(totals.actual_expenses)}</span>,
    },
    {
      key: "gp_percent",
      header: "GP %",
      align: "right",
      render: (p) => {
        if (p.gp_percent == null) return "—";
        const val = p.gp_percent * 100;
        const color = val >= 20 ? "text-emerald-600" : val >= 10 ? "text-amber-600" : "text-rose-600";
        return <span className={`font-mono ${color}`}>{val.toFixed(1)}%</span>;
      },
    },
    {
      key: "revenue_outstanding",
      header: "Rev Outstanding",
      align: "right",
      render: (p) => <span className="font-mono text-amber-600">{formatRand(p.revenue_outstanding)}</span>,
      summaryValue: <span className="font-mono font-bold text-amber-600">{formatRand(totals.revenue_outstanding)}</span>,
    },
    {
      key: "expenses_due",
      header: "Expenses Due",
      align: "right",
      render: (p) => <span className="font-mono text-amber-600">{formatRand(p.expenses_due)}</span>,
      summaryValue: <span className="font-mono font-bold text-amber-600">{formatRand(totals.expenses_due)}</span>,
    },
    {
      key: "current_vo_total",
      header: "Current VO Total",
      align: "right",
      render: (p) => (
        <EditableCell
          value={p.current_vo_total}
          type="number"
          projectName={p.project_name}
          field="current_vo_total"
          displayValue={formatRand(p.current_vo_total)}
        />
      ),
      summaryValue: <span className="font-mono font-bold">{formatRand(totals.current_vo_total)}</span>,
    },
    {
      key: "comments",
      header: "Comments",
      render: (p) => (
        <EditableCell
          value={p.comments}
          type="text"
          projectName={p.project_name}
          field="comments"
          displayValue={p.comments || "—"}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">
          Projects Summary
        </h2>
        <p className="text-muted-foreground text-sm">
          Excel-aligned portfolio overview — {sorted.length} of {projects.length} projects shown
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search"
            placeholder="Search project name..."
            className="pl-8 h-8 w-52 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <Select value={pmFilter} onValueChange={setPmFilter}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-pm-filter">
            <SelectValue placeholder="All PMs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All PMs</SelectItem>
            {uniquePMs.map((pm) => (
              <SelectItem key={pm} value={pm}>{pm}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-phase-filter">
            <SelectValue placeholder="All Phases" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Phases</SelectItem>
            {uniquePhases.map((ph) => (
              <SelectItem key={ph} value={ph}>{ph}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          data-testid="button-export"
          className="h-8"
        >
          <Download className="w-4 h-4 mr-1" />
          Export
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-220px)]">
          <table className="w-full text-xs border-collapse min-w-[2400px]">
            <thead className="sticky top-0 z-20 bg-white">
              <tr className="border-b border-gray-200">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap cursor-pointer hover:bg-gray-50 select-none border-b-2 border-gray-200 ${
                      col.sticky ? "sticky left-0 z-30 bg-white shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]" : ""
                    } ${col.align === "right" ? "text-right" : ""}`}
                    onClick={() => handleSort(col.key)}
                    data-testid={`sort-${col.key}`}
                  >
                    <div className={`inline-flex items-center ${col.align === "right" ? "justify-end" : ""}`}>
                      {col.header}
                      <SortIcon col={col.key} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((project, idx) => (
                <tr
                  key={project.project_name}
                  className={`border-b border-gray-100 hover:bg-blue-50/50 transition-colors ${
                    idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                  }`}
                  data-testid={`row-project-${idx}`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-2 py-1.5 whitespace-nowrap ${
                        col.sticky ? "sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]" : ""
                      } ${col.sticky ? (idx % 2 === 0 ? "bg-white" : "bg-gray-50") : ""} ${
                        col.align === "right" ? "text-right" : ""
                      }`}
                    >
                      {col.render(project)}
                    </td>
                  ))}
                </tr>
              ))}

              <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold sticky bottom-0 z-10">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-2 py-2 whitespace-nowrap ${
                      col.sticky ? "sticky left-0 z-10 bg-gray-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]" : ""
                    } ${col.align === "right" ? "text-right" : ""}`}
                  >
                    {col.key === "project_name" ? (
                      <span className="font-bold text-xs">Totals ({sorted.length})</span>
                    ) : col.summaryValue ? (
                      col.summaryValue
                    ) : null}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

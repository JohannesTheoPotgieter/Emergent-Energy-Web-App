import { useState, useMemo, useRef, useCallback, useEffect } from "react";
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
  Upload,
  Loader2,
  Paperclip,
  Zap,
  TrendingDown,
  TrendingUp,
  Activity,
  BarChart3,
  Calendar,
  Pencil,
  Flag,
  ChevronDown,
  Eye,
  EyeOff,
  Save,
  Trash2,
} from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, invalidateDashboardQueries } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { PROJECT_PHASES, PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

interface ProjectSummary {
  project_info_id: number | null;
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
  date_sources: {
    pd_handover: 'plan' | 'info' | 'none';
    construction_start: 'plan' | 'info' | 'none';
    commissioning: 'plan' | 'info' | 'none';
    om_handover: 'plan' | 'info' | 'none';
    client_handover: 'plan' | 'info' | 'none';
  };
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
  latest_update: string | null;
  latest_update_at: string | null;
  latest_update_by: string | null;
  escalation_level: string | null;
  task_status_counts: Record<string, number>;
  phase_updated_at: string | null;
  has_tracker_import: boolean;
  is_active: boolean;
}

type SortDir = "asc" | "desc";
type SortKey = string;

function cleanName(name: string): string {
  return name.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
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

function phaseConfig(phase: string | null): { bg: string; text: string; border: string; dot: string } {
  const map: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    P0_FIRST_ASSESSMENT: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200", dot: "bg-slate-500" },
    P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
    P2_PD_PM_HANDOVER: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500" },
    P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
    P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
    P5_COMMISSIONING_TESTING: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
    P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", dot: "bg-teal-500" },
    P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
    "First Assessment": { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200", dot: "bg-slate-500" },
    "Cost Proposal": { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
    "DLP": { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500" },
    "Financial Close": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" },
    "Planning": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
    "Construction": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
    "QA": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
    "Handover": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", dot: "bg-teal-500" },
    "Commercial Close Out": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
    "Compliance Handover": { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200", dot: "bg-cyan-500" },
    "Hold": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500" },
    "Gone": { bg: "bg-red-50", text: "text-red-800", border: "border-red-300", dot: "bg-red-800" },
  };
  return (phase && map[phase]) || { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200", dot: "bg-slate-400" };
}

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "—";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}

function progressColor(pct: number): string {
  if (pct >= 90) return "bg-emerald-500";
  if (pct >= 60) return "bg-blue-500";
  if (pct >= 30) return "bg-amber-500";
  return "bg-slate-400";
}

function deltaColor(val: number): { text: string; bg: string } {
  if (val >= 0) return { text: "text-emerald-700", bg: "bg-emerald-50" };
  if (val > -5) return { text: "text-amber-700", bg: "bg-amber-50" };
  return { text: "text-rose-700", bg: "bg-rose-50" };
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
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, string | null>) => {
      await apiRequest("POST", `/api/projects-summary/${encodeURIComponent(projectName)}/edit`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(qc);
      setSaved(true);
      setOpen(false);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const resp = await fetch("/api/financial-close/upload", {
        method: "POST",
        body: formData,
        headers,
        credentials: "include",
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || "Upload failed");
      }
      const result: { url: string; filename: string } = await resp.json();
      const fileUrl = result.url;
      setLinkVal(fileUrl);
      setUploadedFileName(result.filename);
      setMode("link");
      const payload: Record<string, string | null> = {};
      payload[`${fieldPrefix}Type`] = "link";
      payload[`${fieldPrefix}Link`] = fileUrl;
      payload[`${fieldPrefix}NaReason`] = null;
      mutation.mutate(payload);
    } catch (err: any) {
      console.error("File upload error:", err?.message || err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
    setUploadedFileName(null);
    setOpen(true);
  };

  const label = fieldPrefix === "costProposal" ? "Cost Proposal" : fieldPrefix === "funding" ? "Funding" : "EPC Contract";
  const isUploadedFile = linkVal.startsWith("/api/financial-close/files/");
  const displayFileName = uploadedFileName || (isUploadedFile ? decodeURIComponent(linkVal.split("_").slice(1).join("_").replace(/_/g, " ")) : null);

  const isFile = link?.startsWith("/api/financial-close/files/");

  let badge: React.ReactNode;

  if (type === "link") {
    badge = (
      <div className="flex items-center gap-1" data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        <a
          href={link || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-medium transition-colors max-w-[100px] truncate"
          title={link || ""}
          data-testid={`link-fclose-${fieldPrefix}-${projectName}`}
        >
          {isFile ? <Paperclip className="w-3 h-3 shrink-0" /> : <Link2 className="w-3 h-3 shrink-0" />}
          <span className="truncate">{isFile ? "File" : "Link"}</span>
        </a>
        {isAdmin && (
          <button onClick={openDialog} className="p-0.5 hover:bg-slate-100 rounded transition-colors" title="Replace or edit document" data-testid={`btn-edit-${fieldPrefix}-${projectName}`}>
            <Pencil className="w-3 h-3 text-slate-400" />
          </button>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  } else if (type === "na") {
    badge = (
      <div className="flex items-center gap-1" data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-medium cursor-help"
          title={`N/A: ${naReason || "No reason provided"}`}
        >
          <Ban className="w-3 h-3" />
          N/A
        </span>
        {isAdmin && (
          <button onClick={openDialog} className="p-0.5 hover:bg-slate-100 rounded transition-colors" title="Change document status" data-testid={`btn-edit-${fieldPrefix}-${projectName}`}>
            <Pencil className="w-3 h-3 text-slate-400" />
          </button>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  } else {
    badge = (
      <div className="flex items-center gap-1" data-testid={`fclose-${fieldPrefix}-${projectName}`}>
        {isAdmin ? (
          <button
            onClick={openDialog}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 text-[10px] font-medium transition-colors"
            data-testid={`btn-set-${fieldPrefix}-${projectName}`}
          >
            <Clock className="w-3 h-3" />
            Pending
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-medium">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        )}
        {saved && <Check className="w-3 h-3 text-green-500" />}
      </div>
    );
  }

  return (
    <>
      {badge}

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
                Project: <strong>{cleanName(projectName)}</strong>
              </p>

              {type === "link" && isFile && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
                  <Paperclip className="w-4 h-4 shrink-0" />
                  <span className="truncate">Current: {decodeURIComponent((link || "").split("_").slice(1).join("_").replace(/_/g, " "))}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMode("link")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    mode === "link" ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                  data-testid="btn-mode-link"
                >
                  <Upload className={`w-6 h-6 ${mode === "link" ? "text-emerald-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-semibold ${mode === "link" ? "text-emerald-700" : "text-slate-600"}`}>{type === "link" ? "Replace File" : "Attach File"}</span>
                  <span className="text-[10px] text-slate-400">Upload or link</span>
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
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                    data-testid="input-file-upload"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-400 transition-all text-sm font-medium text-emerald-700 disabled:opacity-50"
                    data-testid="btn-choose-file"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        {type === "link" ? "Choose Replacement File" : "Choose File from Computer"}
                      </>
                    )}
                  </button>

                  {isUploadedFile && displayFileName && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
                      <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-sm text-emerald-700 truncate">{displayFileName}</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 ml-auto" />
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span>OR paste a URL</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>

                  <Input
                    placeholder="https://company.sharepoint.com/sites/..."
                    value={isUploadedFile ? "" : linkVal}
                    onChange={(e) => {
                      setLinkVal(e.target.value);
                      setUploadedFileName(null);
                    }}
                    className="text-sm"
                    data-testid="input-sharepoint-link"
                  />
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

const EXECUTION_PHASES = [
  "First Assessment",
  "Cost Proposal",
  "DLP",
  "Financial Close",
  "Planning",
  "Construction",
  "QA",
  "Handover",
  "Commercial Close Out",
  "Compliance Handover",
  "Hold",
  "Gone",
];

interface SavedView {
  name: string;
  visibleColumns: string[];
}

const STORAGE_KEY = "project-summary-views";
const ACTIVE_VIEW_KEY = "project-summary-active-view";

const COLUMN_WIDTHS: Record<string, string> = {
  project_name: "130px",
  size_kwp: "42px",
  pd: "78px",
  pm: "78px",
  cost_proposal_signed: "62px",
  funding_signed: "62px",
  epc_contract_signed: "62px",
  financial_close: "52px",
  phase: "90px",
  task_counts: "60px",
  escalation_level: "58px",
  pd_handover_date: "68px",
  construction_start_date: "64px",
  commissioning_date: "64px",
  om_handover_date: "52px",
  client_handover_date: "56px",
  duration: "36px",
  kw_per_week: "44px",
  project_pct_complete: "72px",
  expected_pct_complete: "42px",
  delta_vs_expected: "56px",
  latest_update: "140px",
  actions: "32px",
};

const COLUMN_GROUPS_META: { label: string; keys: string[]; color: string; stickyFirst?: boolean }[] = [
  { label: "Project Info", keys: ["project_name", "size_kwp", "pd", "pm"], color: "bg-slate-50 text-slate-600", stickyFirst: true },
  { label: "Financial Close", keys: ["cost_proposal_signed", "funding_signed", "epc_contract_signed", "financial_close"], color: "bg-emerald-50 text-emerald-700" },
  { label: "Phase & Schedule", keys: ["phase", "task_counts", "escalation_level", "pd_handover_date", "construction_start_date", "commissioning_date", "om_handover_date", "client_handover_date", "duration", "kw_per_week"], color: "bg-blue-50 text-blue-700" },
  { label: "Progress", keys: ["project_pct_complete", "expected_pct_complete", "delta_vs_expected"], color: "bg-violet-50 text-violet-700" },
  { label: "Financials", keys: ["actual_revenue", "actual_expenses", "gp_percent", "revenue_outstanding", "expenses_due"], color: "bg-green-50 text-green-700" },
  { label: "Updates", keys: ["latest_update"], color: "bg-amber-50 text-amber-700" },
];

const ALL_COLUMN_KEYS_STATIC = COLUMN_GROUPS_META.flatMap(g => g.keys);

function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistViews(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

function loadActiveView(): string | null {
  return localStorage.getItem(ACTIVE_VIEW_KEY);
}

function persistActiveView(name: string | null) {
  if (name) localStorage.setItem(ACTIVE_VIEW_KEY, name);
  else localStorage.removeItem(ACTIVE_VIEW_KEY);
}

function LatestUpdateCell({ project }: { project: ProjectSummary }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.latest_update || "");
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setValue(project.latest_update || "");
  }, [project.latest_update, editing]);

  const save = async () => {
    try {
      await apiRequest("PATCH", `/api/projects-summary/${encodeURIComponent(project.project_name)}/latest-update`, { latestUpdate: value.trim() || null });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setEditing(false);
    } catch (e) {
      console.error("Failed to save update:", e);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") setEditing(false); }}
          className="w-full text-[10px] border rounded px-1 py-0.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          rows={2}
          autoFocus
          data-testid={`textarea-update-${project.project_name}`}
        />
        <div className="flex gap-1">
          <button onClick={save} className="text-[9px] px-1.5 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600" data-testid={`btn-save-update-${project.project_name}`}>Save</button>
          <button onClick={() => { setEditing(false); setValue(project.latest_update || ""); }} className="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    );
  }

  const timeAgo = project.latest_update_at ? (() => {
    const diff = Date.now() - new Date(project.latest_update_at).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  })() : null;

  return (
    <div
      className="cursor-pointer group min-w-[100px]"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title={project.latest_update ? `${project.latest_update}\n\nBy: ${project.latest_update_by || "Unknown"}\n${timeAgo || ""}` : "Click to add update"}
      data-testid={`cell-update-${project.project_name}`}
    >
      {project.latest_update ? (
        <div className="text-[10px] leading-tight">
          <span className="text-slate-700 line-clamp-2">{project.latest_update}</span>
          {timeAgo && <span className="text-[9px] text-slate-400 block">{project.latest_update_by?.split(" ")[0]} · {timeAgo}</span>}
        </div>
      ) : (
        <span className="text-[10px] text-slate-300 group-hover:text-slate-400 italic">+ Add update</span>
      )}
    </div>
  );
}

function EditProjectInfoModal({
  project,
  open,
  onOpenChange,
  onSaved,
}: {
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (projectName: string) => void;
}) {
  const qc = useQueryClient();
  const rawName = project.project_name.replace(/_Tracker.*$/i, "");

  const [formData, setFormData] = useState({
    projectName: rawName,
    phase: project.phase || "",
    pd: project.pd || "",
    pm: project.pm || "",
    sizeKwp: project.size_kwp != null ? String(project.size_kwp) : "",
    constructionStartDate: project.construction_start_date || "",
    commissioningDate: project.commissioning_date || "",
    omHandoverDate: project.om_handover_date || "",
    clientHandoverDate: project.client_handover_date || "",
  });


  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest("PATCH", `/api/project-info/${project.project_info_id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(qc);
      onOpenChange(false);
      onSaved?.(project.project_name);
    },
  });

  const handleSave = () => {
    const phaseVal = formData.phase && formData.phase !== "__blank" ? formData.phase : null;
    const body: Record<string, unknown> = {
      projectName: formData.projectName.replace(/ /g, "_") + "_Tracker",
      executionPhase: phaseVal,
      pd: formData.pd || null,
      pm: formData.pm || null,
      sizeKwp: formData.sizeKwp ? Number(formData.sizeKwp) : null,
      constructionStartDate: formData.constructionStartDate || null,
      commissioningDate: formData.commissioningDate || null,
      omHandoverDate: formData.omHandoverDate || null,
      clientHandoverDate: formData.clientHandoverDate || null,
    };
    mutation.mutate(body);
  };

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-project-info">
        <DialogHeader>
          <DialogTitle>Edit Project Info</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2">
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Project Name</Label>
            <Input
              value={formData.projectName.replace(/_/g, " ")}
              onChange={(e) => updateField("projectName", e.target.value)}
              data-testid="input-edit-project-name"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Execution Phase</Label>
            <Select value={formData.phase} onValueChange={(v) => updateField("phase", v)}>
              <SelectTrigger data-testid="select-edit-phase">
                <SelectValue placeholder="Select execution phase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__blank">(blank)</SelectItem>
                {EXECUTION_PHASES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Size kWp</Label>
            <Input
              type="number"
              value={formData.sizeKwp}
              onChange={(e) => updateField("sizeKwp", e.target.value)}
              data-testid="input-edit-size-kwp"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">PD</Label>
            <Input
              value={formData.pd}
              onChange={(e) => updateField("pd", e.target.value)}
              data-testid="input-edit-pd"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">PM</Label>
            <Input
              value={formData.pm}
              onChange={(e) => updateField("pm", e.target.value)}
              data-testid="input-edit-pm"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Construction Start Date</Label>
            <Input
              type="date"
              value={formData.constructionStartDate}
              onChange={(e) => updateField("constructionStartDate", e.target.value)}
              data-testid="input-edit-construction-start"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Commissioning Date</Label>
            <Input
              type="date"
              value={formData.commissioningDate}
              onChange={(e) => updateField("commissioningDate", e.target.value)}
              data-testid="input-edit-commissioning"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">O&M Handover Date</Label>
            <Input
              type="date"
              value={formData.omHandoverDate}
              onChange={(e) => updateField("omHandoverDate", e.target.value)}
              data-testid="input-edit-om-handover"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600 mb-1 block">Client Handover Date</Label>
            <Input
              type="date"
              value={formData.clientHandoverDate}
              onChange={(e) => updateField("clientHandoverDate", e.target.value)}
              data-testid="input-edit-client-handover"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="btn-cancel-edit">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={mutation.isPending} data-testid="btn-save-edit">
            {mutation.isPending ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsSummary() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("project") || "";
  });
  const [pmFilter, setPmFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("phase");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { isAdmin } = useAuth();
  const [editProject, setEditProject] = useState<ProjectSummary | null>(null);
  const [viewTab, setViewTab] = useState<"active" | "archived">("active");
  const [writebackPromptProject, setWritebackPromptProject] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const queryClient = useQueryClient();

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [activeViewName, setActiveViewName] = useState<string | null>(() => loadActiveView());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    const viewName = loadActiveView();
    if (viewName) {
      const views = loadSavedViews();
      const found = views.find(v => v.name === viewName);
      if (found) return new Set(found.visibleColumns);
    }
    return new Set<string>();
  });
  const [newViewName, setNewViewName] = useState("");

  const escalationMutation = useMutation({
    mutationFn: async ({ projectInfoId, escalationLevel }: { projectInfoId: number; escalationLevel: string | null }) => {
      const res = await apiRequest("PATCH", `/api/projects-summary/${projectInfoId}/escalation`, { escalationLevel });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const { data: pmUsers = [] } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pm-assignable-users"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/pm-assignable-users", { credentials: "include", headers });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const pmAssignMutation = useMutation({
    mutationFn: async ({ projectInfoId, pm, pmUserId }: { projectInfoId: number; pm: string; pmUserId: number | null }) => {
      const res = await apiRequest("PATCH", `/api/project-info/${projectInfoId}/assign-pm`, { pm, pmUserId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      invalidateDashboardQueries(queryClient);
    },
  });

  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/projects-summary", { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch projects summary");
      return res.json();
    },
    refetchOnMount: "always",
    staleTime: 0,
  });

  const activeProjects = useMemo(() => projects.filter(p => p.is_active && p.has_tracker_import), [projects]);
  const archivedProjects = useMemo(() => projects.filter(p => !p.is_active && p.has_tracker_import), [projects]);
  const currentProjects = viewTab === "active" ? activeProjects : archivedProjects;

  const uniquePMs = useMemo(() => {
    const pms = new Set<string>();
    currentProjects.forEach((p) => { if (p.pm) pms.add(p.pm); });
    return Array.from(pms).sort();
  }, [currentProjects]);

  const PHASE_ORDER = [
    "DLP", "Financial Close", "Planning", "Construction", "QA",
    "Handover", "Commercial Close Out", "Compliance Handover", "Hold", "Gone"
  ];
  const uniquePhases = useMemo(() => {
    const phases = new Set<string>();
    currentProjects.forEach((p) => { if (p.phase) phases.add(p.phase); });
    return Array.from(phases).sort((a, b) => {
      const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const ai = PHASE_ORDER.findIndex(p => normalize(p) === normalize(a));
      const bi = PHASE_ORDER.findIndex(p => normalize(p) === normalize(b));
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [currentProjects]);

  const filtered = useMemo(() => {
    let result = [...currentProjects];
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
  }, [currentProjects, searchTerm, pmFilter, phaseFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const phaseNorm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    arr.sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (sortKey === "phase") {
        const ai = PHASE_ORDER.findIndex(p => phaseNorm(p) === phaseNorm(String(aVal)));
        const bi = PHASE_ORDER.findIndex(p => phaseNorm(p) === phaseNorm(String(bVal)));
        const aIdx = ai !== -1 ? ai : PHASE_ORDER.length;
        const bIdx = bi !== -1 ? bi : PHASE_ORDER.length;
        const diff = aIdx - bIdx;
        if (diff !== 0) return sortDir === "asc" ? diff : -diff;
        return String(aVal).localeCompare(String(bVal));
      }
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

  const getColWidth = (key: string): number => {
    if (colWidths[key]) return colWidths[key];
    const w = COLUMN_WIDTHS[key] || "60px";
    return parseInt(w, 10) || 60;
  };

  const onResizeStart = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = getColWidth(key);
    resizingRef.current = { key, startX, startWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(30, resizingRef.current.startWidth + diff);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.key]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    return () => {
      resizingRef.current = null;
    };
  }, []);

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-20" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-blue-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-blue-600" />;
  };

  const stats = useMemo(() => {
    const total = sorted.length;
    const totalKwp = sorted.reduce((s, p) => s + safeNum(p.size_kwp), 0);
    const withCompletion = sorted.filter(p => p.project_pct_complete != null);
    const avgCompletion = withCompletion.length > 0
      ? withCompletion.reduce((s, p) => s + safeNum(p.project_pct_complete), 0) / withCompletion.length * 100
      : 0;
    const behindSchedule = sorted.filter(p => p.delta_vs_expected != null && p.delta_vs_expected < -0.05).length;
    const finCloseCount = sorted.filter(p => p.financial_close_achieved).length;
    return { total, totalKwp, avgCompletion, behindSchedule, finCloseCount };
  }, [sorted]);

  const isDefaultView = visibleColumns.size === 0;
  const effectiveVisible = isDefaultView
    ? new Set(ALL_COLUMN_KEYS_STATIC.concat(isAdmin ? ["actions"] : []))
    : new Set(Array.from(visibleColumns).concat(isAdmin ? ["actions"] : []));

  const toggleColumn = useCallback((key: string) => {
    if (key === "project_name") return;
    setVisibleColumns(prev => {
      const base = prev.size === 0 ? new Set(ALL_COLUMN_KEYS_STATIC.concat(isAdmin ? ["actions"] : [])) : new Set(Array.from(prev));
      if (base.has(key)) base.delete(key);
      else base.add(key);
      base.add("project_name");
      setActiveViewName(null);
      persistActiveView(null);
      return base;
    });
  }, [isAdmin]);

  const selectAllColumns = useCallback(() => {
    setVisibleColumns(new Set<string>());
    setActiveViewName(null);
    persistActiveView(null);
  }, []);

  const deselectAllColumns = useCallback(() => {
    setVisibleColumns(new Set(["project_name"]));
    setActiveViewName(null);
    persistActiveView(null);
  }, []);

  const saveCurrentView = useCallback(() => {
    if (!newViewName.trim()) return;
    const cols = effectiveVisible.size === 0 ? ALL_COLUMN_KEYS_STATIC : Array.from(effectiveVisible).filter(k => k !== "actions");
    const view: SavedView = { name: newViewName.trim(), visibleColumns: cols };
    const updated = [...savedViews.filter(v => v.name !== view.name), view];
    setSavedViews(updated);
    persistViews(updated);
    setActiveViewName(view.name);
    persistActiveView(view.name);
    setNewViewName("");
  }, [newViewName, effectiveVisible, savedViews]);

  const applyView = useCallback((name: string) => {
    if (name === "__default__") {
      setVisibleColumns(new Set<string>());
      setActiveViewName(null);
      persistActiveView(null);
      return;
    }
    const found = savedViews.find(v => v.name === name);
    if (found) {
      setVisibleColumns(new Set(found.visibleColumns));
      setActiveViewName(name);
      persistActiveView(name);
    }
  }, [savedViews]);

  const deleteView = useCallback((name: string) => {
    const updated = savedViews.filter(v => v.name !== name);
    setSavedViews(updated);
    persistViews(updated);
    if (activeViewName === name) {
      setActiveViewName(null);
      persistActiveView(null);
      setVisibleColumns(new Set<string>());
    }
  }, [savedViews, activeViewName]);

  const handleExport = () => {
    window.location.href = "/api/export/projects-summary";
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-1">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900" data-testid="text-page-title">Projects Summary</h2>
            <p className="text-sm text-slate-500">Loading portfolio data...</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-100 animate-pulse rounded-xl" />)}
        </div>
        <div className="h-96 bg-slate-100 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-6 p-1">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900" data-testid="text-page-title">Projects Summary</h2>
            <p className="text-sm text-slate-500">Portfolio overview</p>
          </div>
        </div>
        <Card className="border-2 border-dashed border-slate-200">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">No Projects Available</h3>
            <p className="text-sm text-slate-500 max-w-md">
              Upload tracker files to populate the Projects Summary dashboard with progress tracking and key dates.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  function truncateName(name: string | null, max: number): string {
    if (!name) return "—";
    if (name.length <= max) return name;
    return name.slice(0, max) + "…";
  }

  const columns: {
    key: string;
    header: string;
    sticky?: boolean;
    align?: string;
    minW?: string;
    render: (p: ProjectSummary) => React.ReactNode;
  }[] = [
    {
      key: "project_name",
      header: "Project",
      sticky: true,
      render: (p) => (
        <button
          data-testid={`link-project-${p.project_name}`}
          className="text-left font-semibold text-blue-700 hover:text-blue-900 hover:underline truncate max-w-[130px] block text-[10px]"
          onClick={() => setLocation(`/project/${encodeURIComponent(p.project_name)}?tab=task-grid`)}
          title={cleanName(p.project_name)}
        >
          {cleanName(p.project_name)}
        </button>
      ),
    },
    {
      key: "size_kwp",
      header: "kWp",
      align: "right",
      render: (p) => <span className="font-mono text-slate-700">{p.size_kwp != null ? p.size_kwp.toFixed(0) : "—"}</span>,
    },
    { key: "pd", header: "PD", render: (p) => <span className="text-slate-600 truncate max-w-[80px] block" title={p.pd || ""}>{truncateName(p.pd, 12)}</span> },
    {
      key: "pm",
      header: "PM",
      render: (p) => p.project_info_id ? (
        <Select
          value={p.pm || "__unassigned"}
          onValueChange={(val) => {
            if (val === "__unassigned" || !p.project_info_id) return;
            const matchedUser = pmUsers.find(u => u.name === val);
            pmAssignMutation.mutate({
              projectInfoId: p.project_info_id,
              pm: val,
              pmUserId: matchedUser?.id ?? null,
            });
          }}
        >
          <SelectTrigger
            className="h-7 w-[120px] text-xs border-0 bg-transparent hover:bg-slate-50 px-1 shadow-none focus:ring-0"
            data-testid={`select-pm-${p.project_name}`}
          >
            <span className="truncate">{p.pm ? truncateName(p.pm, 14) : "—"}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned" disabled>Unassigned</SelectItem>
            {pmUsers.map((u) => (
              <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-slate-600 truncate max-w-[80px] block" title={p.pm || ""}>{truncateName(p.pm, 12)}</span>
      ),
    },
    {
      key: "cost_proposal_signed",
      header: "Cost Prop.",
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
      header: "EPC",
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
      header: "Status",
      render: (p) => {
        const achieved = p.financial_close_achieved;
        return (
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
              achieved
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}
            data-testid={`badge-fclose-${p.project_name}`}
          >
            {achieved ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {achieved ? "Done" : "Open"}
          </span>
        );
      },
    },
    {
      key: "phase",
      header: "Phase",
      render: (p) => {
        const cfg = phaseConfig(p.phase);
        return (
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
            title={getPhaseLabel(p.phase)}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {getPhaseLabel(p.phase)}
          </span>
        );
      },
    },
    {
      key: "task_counts",
      header: "Tasks",
      render: (p) => {
        const counts = p.task_status_counts || {};
        const total = Object.values(counts).reduce((s, c) => s + c, 0);
        const done = (counts["DONE"] || 0) + (counts["COMPLETE"] || 0);
        const inProgress = counts["IN PROGRESS"] || 0;
        if (total === 0) return <span className="text-slate-400 text-[10px]">—</span>;
        return (
          <div className="flex items-center gap-1" title={Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")}>
            <span className="text-[10px] font-mono text-slate-600">{done}/{total}</span>
            {inProgress > 0 && (
              <span className="text-[10px] px-1 py-0 rounded bg-blue-50 text-blue-600 border border-blue-200">{inProgress} WIP</span>
            )}
          </div>
        );
      },
    },
    {
      key: "escalation_level",
      header: "Escalation",
      render: (p) => {
        const level = p.escalation_level || "None";
        const cfg: Record<string, { bg: string; text: string; border: string; dot: string }> = {
          None: { bg: "bg-slate-50", text: "text-slate-400", border: "border-slate-200", dot: "bg-slate-300" },
          Low: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200", dot: "bg-blue-400" },
          Medium: { bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", dot: "bg-amber-400" },
          High: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", dot: "bg-orange-500" },
          Highest: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300", dot: "bg-red-500" },
        };
        const style = cfg[level] || cfg.None;
        if (!isAdmin) {
          return (
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text} ${style.border}`}>
              {level === "Highest" && <Flag className="w-3 h-3" />}
              {level}
            </span>
          );
        }
        return (
          <select
            data-testid={`select-escalation-${p.project_name}`}
            className={`text-[10px] font-semibold rounded-md border px-1 py-0.5 cursor-pointer outline-none ${style.bg} ${style.text} ${style.border}`}
            value={level}
            onChange={(e) => {
              if (!p.project_info_id) return;
              const val = e.target.value === "None" ? null : e.target.value;
              escalationMutation.mutate({ projectInfoId: p.project_info_id, escalationLevel: val });
            }}
            disabled={!p.project_info_id}
          >
            <option value="None">None</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Highest">Highest</option>
          </select>
        );
      },
    },
    { key: "pd_handover_date", header: "PD H/O", render: (p) => (
      <span className="flex items-center gap-1 text-slate-600" title={p.date_sources?.pd_handover === 'plan' ? 'From project plan' : p.date_sources?.pd_handover === 'info' ? 'From info table' : ''}>
        {formatDate(p.pd_handover_date)}
        {p.date_sources?.pd_handover === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "construction_start_date", header: "C.Start", render: (p) => (
      <span className="flex items-center gap-1 text-slate-600" title={p.date_sources?.construction_start === 'plan' ? 'From project plan' : p.date_sources?.construction_start === 'info' ? 'From info table' : ''}>
        {formatDate(p.construction_start_date)}
        {p.date_sources?.construction_start === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "commissioning_date", header: "Comm.", render: (p) => (
      <span className="flex items-center gap-1 text-slate-600" title={p.date_sources?.commissioning === 'plan' ? 'From project plan' : p.date_sources?.commissioning === 'info' ? 'From info table' : ''}>
        {formatDate(p.commissioning_date)}
        {p.date_sources?.commissioning === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "om_handover_date", header: "O&M", render: (p) => (
      <span className="flex items-center gap-1 text-slate-600" title={p.date_sources?.om_handover === 'plan' ? 'From project plan' : p.date_sources?.om_handover === 'info' ? 'From info table' : ''}>
        {formatDate(p.om_handover_date)}
        {p.date_sources?.om_handover === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    { key: "client_handover_date", header: "Client", render: (p) => (
      <span className="flex items-center gap-1 text-slate-600" title={p.date_sources?.client_handover === 'plan' ? 'From project plan' : p.date_sources?.client_handover === 'info' ? 'From info table' : ''}>
        {formatDate(p.client_handover_date)}
        {p.date_sources?.client_handover === 'plan' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" title="From project plan" />}
      </span>
    )},
    {
      key: "duration",
      header: "Days",
      align: "right",
      render: (p) => <span className="font-mono text-slate-600">{p.duration != null ? p.duration : "—"}</span>,
    },
    {
      key: "kw_per_week",
      header: "kW/Wk",
      align: "right",
      render: (p) => <span className="font-mono text-slate-600">{p.kw_per_week != null ? p.kw_per_week.toFixed(1) : "—"}</span>,
    },
    {
      key: "project_pct_complete",
      header: "Act%",
      render: (p) => {
        const pct = p.project_pct_complete != null ? p.project_pct_complete * 100 : 0;
        return (
          <div className="flex items-center gap-1 min-w-[60px]">
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressColor(pct)}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="font-mono text-[10px] w-8 text-right font-medium text-slate-700">{pct.toFixed(0)}%</span>
          </div>
        );
      },
    },
    {
      key: "expected_pct_complete",
      header: "Exp%",
      align: "right",
      render: (p) => <span className="font-mono text-slate-600">{formatPct(p.expected_pct_complete)}</span>,
    },
    {
      key: "delta_vs_expected",
      header: "Delta",
      align: "right",
      render: (p) => {
        if (p.delta_vs_expected == null) return <span className="text-slate-400">—</span>;
        const val = p.delta_vs_expected * 100;
        const { text, bg } = deltaColor(val);
        const sign = val >= 0 ? "+" : "";
        const Icon = val >= 0 ? TrendingUp : TrendingDown;
        return (
          <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${text} ${bg}`}>
            <Icon className="w-3 h-3" />
            {sign}{val.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: "actual_revenue",
      header: "Revenue",
      align: "right",
      render: (p) => {
        const val = p.actual_revenue;
        if (val == null || val === 0) return <span className="text-slate-400 text-[10px]">—</span>;
        return <span className="font-mono text-slate-700 text-[10px]">R{val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
      },
    },
    {
      key: "actual_expenses",
      header: "Expenses",
      align: "right",
      render: (p) => {
        const val = p.actual_expenses;
        if (val == null || val === 0) return <span className="text-slate-400 text-[10px]">—</span>;
        return <span className="font-mono text-slate-700 text-[10px]">R{val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
      },
    },
    {
      key: "gp_percent",
      header: "GP%",
      align: "right",
      render: (p) => {
        if (p.gp_percent == null) return <span className="text-slate-400 text-[10px]">—</span>;
        const val = p.gp_percent * 100;
        const color = val >= 20 ? "text-emerald-600" : val >= 0 ? "text-amber-600" : "text-red-600";
        return <span className={`font-mono text-[10px] font-semibold ${color}`}>{val.toFixed(1)}%</span>;
      },
    },
    {
      key: "revenue_outstanding",
      header: "Rev. O/S",
      align: "right",
      render: (p) => {
        const val = p.revenue_outstanding;
        if (val == null || val === 0) return <span className="text-slate-400 text-[10px]">—</span>;
        return <span className="font-mono text-amber-600 text-[10px]">R{val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
      },
    },
    {
      key: "expenses_due",
      header: "Exp. Due",
      align: "right",
      render: (p) => {
        const val = p.expenses_due;
        if (val == null || val === 0) return <span className="text-slate-400 text-[10px]">—</span>;
        return <span className="font-mono text-red-600 text-[10px]">R{val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
      },
    },
    {
      key: "latest_update",
      header: "Latest Update",
      render: (p: ProjectSummary) => (
        <LatestUpdateCell project={p} />
      ),
    },
    ...(isAdmin
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (p: ProjectSummary) => (
              <button
                onClick={() => setEditProject(p)}
                className="p-1 hover:bg-slate-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title={p.project_info_id ? "Edit project info" : "No project info record"}
                disabled={!p.project_info_id}
                data-testid={`btn-edit-project-${p.project_name}`}
              >
                <Pencil className="w-3.5 h-3.5 text-slate-500" />
              </button>
            ),
          },
        ]
      : []),
  ];

  const filteredColumns = columns.filter(c => effectiveVisible.has(c.key));

  const allGroupsMeta = [
    ...COLUMN_GROUPS_META,
    ...(isAdmin ? [{ label: "", keys: ["actions"], color: "bg-white" }] : []),
  ];

  const dynamicColumnGroups = allGroupsMeta
    .map(g => ({
      ...g,
      colSpan: g.keys.filter(k => effectiveVisible.has(k)).length,
    }))
    .filter(g => g.colSpan > 0);

  return (
    <div className="space-y-5 p-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm shrink-0">
            <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 truncate" data-testid="text-page-title">
              Projects Summary
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              {sorted.length} of {currentProjects.length} {viewTab === "active" ? "active" : "archived"} projects
              {(pmFilter !== "all" || phaseFilter !== "all" || searchTerm) && " (filtered)"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          data-testid="button-export"
          className="h-8 sm:h-9 gap-1 sm:gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-50 shrink-0"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
        <button
          onClick={() => setViewTab("active")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewTab === "active" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
          data-testid="tab-active-projects"
        >
          Active Projects ({activeProjects.length})
        </button>
        <button
          onClick={() => setViewTab("archived")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewTab === "archived" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
          data-testid="tab-archived-projects"
        >
          Archived ({archivedProjects.length})
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Projects</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900" data-testid="stat-total-projects">{stats.total}</div>
            <div className="text-xs text-slate-500 mt-1">{stats.totalKwp.toLocaleString()} kWp total capacity</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Avg. Completion</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Activity className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900" data-testid="stat-avg-completion">{stats.avgCompletion.toFixed(0)}%</div>
            <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div className={`h-full rounded-full ${progressColor(stats.avgCompletion)}`} style={{ width: `${Math.min(stats.avgCompletion, 100)}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Behind Schedule</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stats.behindSchedule > 0 ? "bg-rose-50" : "bg-emerald-50"}`}>
                <TrendingDown className={`w-4 h-4 ${stats.behindSchedule > 0 ? "text-rose-600" : "text-emerald-600"}`} />
              </div>
            </div>
            <div className={`text-2xl font-bold ${stats.behindSchedule > 0 ? "text-rose-600" : "text-emerald-600"}`} data-testid="stat-behind-schedule">
              {stats.behindSchedule}
            </div>
            <div className="text-xs text-slate-500 mt-1">of {stats.total} projects ({stats.total > 0 ? ((stats.behindSchedule / stats.total) * 100).toFixed(0) : 0}%)</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Financial Close</span>
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                <Zap className="w-4 h-4 text-violet-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900" data-testid="stat-fin-close">{stats.finCloseCount}</div>
            <div className="text-xs text-slate-500 mt-1">of {stats.total} achieved ({stats.total > 0 ? ((stats.finCloseCount / stats.total) * 100).toFixed(0) : 0}%)</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px] sm:flex-none">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            data-testid="input-search"
            placeholder="Search projects..."
            className="pl-9 h-9 w-full sm:w-56 text-sm border-slate-200 bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <Select value={pmFilter} onValueChange={setPmFilter}>
          <SelectTrigger className="h-9 w-[calc(50%-0.25rem)] sm:w-40 text-sm border-slate-200" data-testid="select-pm-filter">
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
          <SelectTrigger className="h-9 w-[calc(50%-0.25rem)] sm:w-40 text-sm border-slate-200" data-testid="select-phase-filter">
            <SelectValue placeholder="All Phases" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Phases</SelectItem>
            {uniquePhases.map((ph) => (
              <SelectItem key={ph} value={ph}>{getPhaseLabel(ph)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-sm border-slate-200" data-testid="btn-column-toggle">
              {isDefaultView ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              <span className="hidden sm:inline">Columns</span>
              {!isDefaultView && (
                <Badge className="ml-1 h-5 px-1.5 text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100">
                  {effectiveVisible.size - (effectiveVisible.has("actions") ? 1 : 0)}/{ALL_COLUMN_KEYS_STATIC.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start" data-testid="popover-columns">
            <div className="p-3 border-b border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700">Column Visibility</span>
                <button
                  onClick={isDefaultView ? deselectAllColumns : selectAllColumns}
                  className="text-[10px] font-medium text-blue-600 hover:text-blue-800"
                  data-testid="btn-toggle-all-columns"
                >
                  {isDefaultView ? "Deselect All" : "Select All"}
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-2 space-y-3">
              {COLUMN_GROUPS_META.map(group => (
                <div key={group.label}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1">{group.label}</div>
                  {group.keys.map(key => {
                    const col = columns.find(c => c.key === key);
                    if (!col) return null;
                    const isProjectName = key === "project_name";
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50 cursor-pointer ${isProjectName ? "opacity-60" : ""}`}
                        data-testid={`toggle-col-${key}`}
                      >
                        <Checkbox
                          checked={effectiveVisible.has(key)}
                          onCheckedChange={() => toggleColumn(key)}
                          disabled={isProjectName}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs text-slate-700">{col.header}</span>
                        {isProjectName && <span className="text-[9px] text-slate-400 ml-auto">Required</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 p-3 space-y-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Save as View</div>
              <div className="flex items-center gap-1.5">
                <Input
                  placeholder="View name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="h-7 text-xs flex-1"
                  data-testid="input-view-name"
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrentView(); }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  onClick={saveCurrentView}
                  disabled={!newViewName.trim()}
                  data-testid="btn-save-view"
                >
                  <Save className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {savedViews.length > 0 && (
          <Select value={activeViewName || "__default__"} onValueChange={applyView}>
            <SelectTrigger className="h-9 w-[calc(50%-0.25rem)] sm:w-40 text-sm border-slate-200" data-testid="select-view">
              <SelectValue placeholder="Default (All)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">Default (All)</SelectItem>
              {savedViews.map((v) => (
                <SelectItem key={v.name} value={v.name}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {activeViewName && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteView(activeViewName)}
            className="h-9 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
            title="Delete current view"
            data-testid="btn-delete-view"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}

        {(searchTerm || pmFilter !== "all" || phaseFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearchTerm(""); setPmFilter("all"); setPhaseFilter("all"); }}
            className="h-9 text-xs text-slate-500 hover:text-slate-700"
          >
            <X className="w-3 h-3 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
        <div className="overflow-auto max-h-[calc(100vh-280px)] sm:max-h-[calc(100vh-340px)]">
          <table className="w-full text-[10px] border-collapse table-fixed" style={{ minWidth: "100%" }}>
            <colgroup>
              {filteredColumns.map(col => (
                <col key={col.key} style={{ width: `${getColWidth(col.key)}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                {dynamicColumnGroups.map((g, i) => (
                  <th
                    key={i}
                    colSpan={g.colSpan}
                    className={`px-1 py-1 text-[9px] font-bold uppercase tracking-wider border-b border-slate-200 ${g.color} ${
                      g.stickyFirst ? "sticky left-0 z-30" : ""
                    } ${i > 0 ? "border-l border-slate-200" : ""}`}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-white border-b-2 border-slate-200">
                {filteredColumns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-1 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:bg-slate-50 select-none transition-colors text-[9px] relative ${
                      col.sticky ? "sticky left-0 z-30 bg-white shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]" : ""
                    } ${col.align === "right" ? "text-right" : ""}`}
                    onClick={() => handleSort(col.key)}
                    data-testid={`sort-${col.key}`}
                  >
                    <div className={`inline-flex items-center gap-0.5 ${col.align === "right" ? "justify-end" : ""}`}>
                      {col.header}
                      <SortIcon col={col.key} />
                    </div>
                    <div
                      className="absolute right-0 top-0 bottom-0 w-[4px] cursor-col-resize hover:bg-blue-400/50 z-40"
                      onMouseDown={(e) => onResizeStart(e, col.key)}
                      data-testid={`resize-${col.key}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((project, idx) => (
                <tr
                  key={project.project_name}
                  className={`border-b border-slate-100 hover:bg-blue-50/40 transition-colors ${
                    idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"
                  }`}
                  data-testid={`row-project-${idx}`}
                >
                  {filteredColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-1 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis ${
                        col.sticky ? "sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]" : ""
                      } ${col.sticky ? (idx % 2 === 0 ? "bg-white" : "bg-slate-50/80") : ""} ${
                        col.align === "right" ? "text-right" : ""
                      }`}
                    >
                      {col.render(project)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                {filteredColumns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-1 py-1.5 whitespace-nowrap ${
                      col.sticky ? "sticky left-0 z-10 bg-slate-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]" : ""
                    } ${col.align === "right" ? "text-right" : ""}`}
                  >
                    {col.key === "project_name" ? (
                      <span className="font-bold text-slate-700 text-[10px]">Portfolio ({sorted.length})</span>
                    ) : col.key === "size_kwp" ? (
                      <span className="font-mono font-bold text-slate-700">{stats.totalKwp.toFixed(0)}</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {editProject && (
        <EditProjectInfoModal
          project={editProject}
          open={!!editProject}
          onOpenChange={(open) => { if (!open) setEditProject(null); }}
          onSaved={(name) => setWritebackPromptProject(name)}
        />
      )}

      
    </div>
  );
}

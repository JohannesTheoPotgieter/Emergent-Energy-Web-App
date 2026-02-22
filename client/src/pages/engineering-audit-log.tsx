import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import {
  History,
  Shield,
  User,
  ArrowRight,
  Filter,
  Clock,
  Activity,
  FileEdit,
  PlusCircle,
  Link2,
  Layers,
  ChevronLeft,
  ChevronRight,
  Loader2,
  BarChart3,
  Upload,
  FileSpreadsheet,
  RefreshCw,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

async function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface UnifiedEntry {
  id: string;
  category: string;
  actionType: string;
  summary: string;
  detail: string | null;
  actorName: string | null;
  projectName: string | null;
  timestamp: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Activity; color: string; bgColor: string }> = {
  task_changes: { label: "Task Changes", icon: FileEdit, color: "text-blue-600", bgColor: "bg-blue-50" },
  phase_changes: { label: "Phase Changes", icon: ArrowRight, color: "text-indigo-600", bgColor: "bg-indigo-50" },
  data_imports: { label: "Data Imports", icon: Upload, color: "text-emerald-600", bgColor: "bg-emerald-50" },
  writebacks: { label: "Writebacks", icon: FileSpreadsheet, color: "text-orange-600", bgColor: "bg-orange-50" },
  template_applications: { label: "Templates", icon: Layers, color: "text-violet-600", bgColor: "bg-violet-50" },
};

const ACTION_ICONS: Record<string, { icon: typeof Activity; color: string }> = {
  created: { icon: PlusCircle, color: "text-emerald-600 bg-emerald-50" },
  field_changed: { icon: FileEdit, color: "text-blue-600 bg-blue-50" },
  bulk_updated: { icon: Layers, color: "text-violet-600 bg-violet-50" },
  linked: { icon: Link2, color: "text-indigo-600 bg-indigo-50" },
  subtask_created: { icon: PlusCircle, color: "text-teal-600 bg-teal-50" },
  comment_added: { icon: Activity, color: "text-amber-600 bg-amber-50" },
  status_changed: { icon: ArrowRight, color: "text-orange-600 bg-orange-50" },
  phase_changed: { icon: ArrowLeftRight, color: "text-indigo-600 bg-indigo-50" },
  import_success: { icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
  import_failed: { icon: XCircle, color: "text-red-600 bg-red-50" },
  data_refresh: { icon: RefreshCw, color: "text-sky-600 bg-sky-50" },
  writeback_applied: { icon: FileSpreadsheet, color: "text-orange-600 bg-orange-50" },
  writeback_rolled_back: { icon: ArrowLeftRight, color: "text-amber-600 bg-amber-50" },
  writeback_error: { icon: AlertTriangle, color: "text-red-600 bg-red-50" },
  template_applied: { icon: Layers, color: "text-violet-600 bg-violet-50" },
};

function ActionBadge({ actionType }: { actionType: string }) {
  const config = ACTION_ICONS[actionType] || { icon: Activity, color: "text-gray-600 bg-gray-50" };
  const Icon = config.icon;
  const label = actionType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${config.color}`} data-testid={`badge-action-${actionType}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const config = CATEGORY_CONFIG[category] || { label: category, icon: Activity, color: "text-gray-600", bgColor: "bg-gray-50" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${config.color} ${config.bgColor}`}>
      {config.label}
    </span>
  );
}

function formatDateTime(d: string) {
  try {
    return new Date(d).toLocaleString("en-ZA", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return d; }
}

function formatRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateTime(d);
}

const TABS = [
  { key: "all", label: "All Activity" },
  { key: "task_changes", label: "Tasks" },
  { key: "phase_changes", label: "Phases" },
  { key: "data_imports", label: "Data Imports" },
  { key: "writebacks", label: "Writebacks" },
  { key: "template_applications", label: "Templates" },
];

export default function EngineeringAuditLog() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 50;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCurrentPage(0);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  if (!['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '')) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground" data-testid="audit-log-forbidden">
        <Shield className="h-16 w-16 mb-4 opacity-30" />
        <h2 className="text-xl font-semibold">Admin Access Required</h2>
        <p className="text-sm mt-2">Only administrators can view the audit log.</p>
      </div>
    );
  }

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(currentPage * pageSize));
    if (activeTab !== "all") params.set("category", activeTab);
    if (debouncedSearch) params.set("search", debouncedSearch);
    return params.toString();
  }, [activeTab, currentPage, debouncedSearch]);

  const { data, isLoading } = useQuery<{
    entries: UnifiedEntry[];
    total: number;
    categoryCounts: Record<string, number>;
  }>({
    queryKey: ["unified-audit", queryParams],
    queryFn: () => engFetch(`/api/eng/unified-audit?${queryParams}`),
    staleTime: 30000,
  });

  const entries = data?.entries || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);
  const categoryCounts = data?.categoryCounts || {};

  const totalAll = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6" data-testid="audit-log-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-sm">
            <History className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl md:text-2xl font-heading font-bold" data-testid="text-audit-title">
              Audit Log
            </h2>
            <p className="text-xs text-muted-foreground">
              Full history of all system changes &middot; Admin only
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {TABS.map(tab => {
          const count = tab.key === "all" ? totalAll : (categoryCounts[tab.key] || 0);
          const isActive = activeTab === tab.key;
          const config = CATEGORY_CONFIG[tab.key];
          const Icon = config?.icon || BarChart3;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setCurrentPage(0); }}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                isActive
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/30 hover:bg-muted/30"
              }`}
              data-testid={`tab-${tab.key}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? "bg-primary/10" : "bg-muted"}`}>
                <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <span className={`text-[11px] font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                {tab.label}
              </span>
              <span className={`text-lg font-bold ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="relative flex-1 max-w-sm">
              <Input
                placeholder="Search changes..."
                className="h-8 text-xs"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                data-testid="input-audit-search"
              />
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              {total} entries
            </span>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No audit entries found</p>
          <p className="text-sm mt-1">
            {total === 0
              ? "Activity will appear here as changes are made across the system."
              : "Try adjusting your search or filter."}
          </p>
        </div>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <div className="divide-y">
              {entries.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 p-4 hover:bg-muted/20 transition-colors" data-testid={`audit-entry-${entry.id}`}>
                  <div className="mt-1 shrink-0 space-y-1">
                    <ActionBadge actionType={entry.actionType} />
                    {activeTab === "all" && (
                      <div className="mt-1">
                        <CategoryBadge category={entry.category} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold truncate max-w-[400px]">{entry.summary}</span>
                      {entry.projectName && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">
                          {entry.projectName}
                        </Badge>
                      )}
                    </div>
                    {entry.detail && (
                      <p className="text-xs text-muted-foreground truncate max-w-[500px]">{entry.detail}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{entry.actorName || "System"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground" title={entry.timestamp ? formatDateTime(entry.timestamp) : ""}>
                      <Clock className="h-3 w-3" />
                      <span>{entry.timestamp ? formatRelative(entry.timestamp) : "—"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2 flex-wrap gap-2">
              <span className="text-xs text-muted-foreground">
                Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="p-1.5 rounded-md border bg-background hover:bg-muted disabled:opacity-30"
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage(p => p - 1)}
                  data-testid="btn-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs px-2">Page {currentPage + 1} of {totalPages}</span>
                <button
                  className="p-1.5 rounded-md border bg-background hover:bg-muted disabled:opacity-30"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setCurrentPage(p => p + 1)}
                  data-testid="btn-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

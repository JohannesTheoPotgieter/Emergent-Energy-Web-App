import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Zap,
  Search,
  Loader2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  FileText,
  Building2,
  CalendarDays,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { useLocation } from "wouter";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) h["X-CSRF-Token"] = csrf;
  return h;
}

type SsegApplication = {
  id: number;
  projectId: number;
  status: string;
  applicationRef?: string | null;
  municipality?: string | null;
  capacity_kw?: number | null;
  submittedDate?: string | null;
  approvedDate?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  approved: { label: "Approved", color: "bg-green-100 text-green-800 border-green-300", icon: CheckCircle2 },
  submitted: { label: "Submitted", color: "bg-blue-100 text-blue-800 border-blue-300", icon: Clock },
  pending: { label: "Pending", color: "bg-amber-100 text-amber-800 border-amber-300", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-800 border-blue-300", icon: Clock },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 border-red-300", icon: XCircle },
  expired: { label: "Expired", color: "bg-gray-100 text-gray-600 border-gray-300", icon: AlertTriangle },
};

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || "pending").toLowerCase().replace(/\s+/g, "_");
  const config = STATUS_CONFIG[normalized] || { label: status || "Unknown", color: "bg-gray-100 text-gray-600 border-gray-300", icon: Clock };
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.color} text-xs gap-1`} data-testid={`status-badge-${normalized}`}>
      <Icon className="h-3 w-3" /> {config.label}
    </Badge>
  );
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "\u2014";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
}

export default function SsegPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const { projects } = useProjectsSummary();
  const projectMap = useMemo(() => {
    const m = new Map<number, { name: string; code: string; client: string }>();
    if (projects) {
      for (const p of projects) {
        m.set(p.id, {
          name: p.projectName || p.name || `Project ${p.id}`,
          code: p.projectCode || "",
          client: p.clientName || p.client || "",
        });
      }
    }
    return m;
  }, [projects]);

  const { data: applications, isLoading } = useQuery<SsegApplication[]>({
    queryKey: ["sseg-applications"],
    queryFn: async () => {
      const res = await fetch("/api/sseg-applications", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!applications) return [];
    let list = applications;

    if (activeTab !== "all") {
      list = list.filter(a => (a.status || "").toLowerCase().replace(/\s+/g, "_") === activeTab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a => {
        const proj = projectMap.get(a.projectId);
        return (
          (proj?.name || "").toLowerCase().includes(q) ||
          (proj?.code || "").toLowerCase().includes(q) ||
          (proj?.client || "").toLowerCase().includes(q) ||
          (a.applicationRef || "").toLowerCase().includes(q) ||
          (a.municipality || "").toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [applications, activeTab, search, projectMap]);

  const stats = useMemo(() => {
    if (!applications) return { total: 0, approved: 0, submitted: 0, pending: 0, rejected: 0 };
    return {
      total: applications.length,
      approved: applications.filter(a => (a.status || "").toLowerCase() === "approved").length,
      submitted: applications.filter(a => (a.status || "").toLowerCase() === "submitted").length,
      pending: applications.filter(a => ["pending", "in_progress"].includes((a.status || "").toLowerCase().replace(/\s+/g, "_"))).length,
      rejected: applications.filter(a => (a.status || "").toLowerCase() === "rejected").length,
    };
  }, [applications]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-sseg">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="sseg-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
            <Zap className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="text-page-title">SSEG Applications</h1>
            <p className="text-sm text-gray-500">Small-Scale Embedded Generation application tracker</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-gray-200" data-testid="card-stat-total">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-500 mt-1">Total Applications</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/50" data-testid="card-stat-approved">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{stats.approved}</p>
            <p className="text-xs text-green-600 mt-1">Approved</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/50" data-testid="card-stat-submitted">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{stats.submitted}</p>
            <p className="text-xs text-blue-600 mt-1">Submitted</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/50" data-testid="card-stat-pending">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-700">{stats.pending}</p>
            <p className="text-xs text-amber-600 mt-1">Pending</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50" data-testid="card-stat-rejected">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-700">{stats.rejected}</p>
            <p className="text-xs text-red-600 mt-1">Rejected</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by project, client, municipality, or reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-status-filter">
          <TabsTrigger value="all">All ({stats.total})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({stats.approved})</TabsTrigger>
          <TabsTrigger value="submitted">Submitted ({stats.submitted})</TabsTrigger>
          <TabsTrigger value="pending">Pending ({stats.pending})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({stats.rejected})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {filtered.length === 0 ? (
            <Card className="border-gray-200">
              <CardContent className="py-12 text-center text-gray-500">
                <Zap className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No SSEG applications found</p>
                <p className="text-sm mt-1">
                  {search ? "Try adjusting your search filters" : "SSEG applications will appear here once created"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((app) => {
                const proj = projectMap.get(app.projectId);
                return (
                  <Card key={app.id} className="border-gray-200 hover:border-emerald-300 transition-colors cursor-pointer" data-testid={`card-sseg-${app.id}`}
                    onClick={() => proj && navigate(`/project/${encodeURIComponent(proj.name)}`)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            <span className="font-semibold text-gray-900 truncate" data-testid={`text-project-name-${app.id}`}>
                              {proj?.name || `Project #${app.projectId}`}
                            </span>
                            {proj?.code && (
                              <Badge variant="outline" className="text-xs text-gray-500 font-mono">{proj.code}</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 mt-1">
                            {proj?.client && <span>{proj.client}</span>}
                            {app.municipality && <span>Municipality: {app.municipality}</span>}
                            {app.applicationRef && (
                              <span className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                Ref: {app.applicationRef}
                              </span>
                            )}
                            {app.capacity_kw && (
                              <span className="flex items-center gap-1">
                                <Zap className="h-3 w-3" />
                                {app.capacity_kw} kW
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 mt-2">
                            {app.submittedDate && (
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                Submitted: {formatDate(app.submittedDate)}
                              </span>
                            )}
                            {app.approvedDate && (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                Approved: {formatDate(app.approvedDate)}
                              </span>
                            )}
                            {app.expiryDate && (
                              <span className="flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                                Expires: {formatDate(app.expiryDate)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <StatusBadge status={app.status} />
                          <ArrowRight className="h-4 w-4 text-gray-300" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

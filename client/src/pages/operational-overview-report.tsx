import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, FileBarChart, ArrowLeft, ChevronDown, ChevronRight, Circle } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

async function fetchReport(month: string, token: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/admin/reports/operational-overview?month=${month}`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Failed to fetch report");
  }
  return res.json();
}

interface KPIData {
  month: string;
  generatedAt: string;
  kpis: {
    activeProjects: number;
    constructionStarts: number;
    pdPmHandovers: number;
    commissionings: number;
    clientHandoversPlanned: number;
    rag: { green: number; amber: number; red: number; onTrack: number };
  };
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  const date = new Date(parseInt(y), parseInt(m) - 1, 1);
  return date.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

function KPITile({ value, label, sub }: { value: number | string; label: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-8 min-h-[160px]"
      style={{ backgroundColor: "#1a5c3a", color: "white" }}
    >
      <span className="text-5xl font-bold leading-none mb-2">{value}</span>
      <span className="text-sm font-medium text-center opacity-90 leading-tight">{label}</span>
      {sub && <span className="text-xs mt-2 opacity-70 text-center">{sub}</span>}
    </div>
  );
}

function ReportSlide({ data }: { data: KPIData }) {
  const { kpis } = data;

  return (
    <div
      className="relative w-full bg-white overflow-hidden"
      style={{
        aspectRatio: "16/9",
        maxWidth: "1100px",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      <div className="absolute right-0 top-0 bottom-0 w-16" style={{ backgroundColor: "#1a5c3a" }} />

      <div className="relative z-10 flex flex-col h-full pr-20 pl-10 py-8">
        <div className="flex items-center gap-3 mb-2">
          <img src="/logo.png" className="w-8 h-8 object-contain" alt="Logo" />
          <span className="text-lg font-bold tracking-wide" style={{ color: "#1a5c3a" }}>
            EMERGENT ENERGY
          </span>
        </div>

        <h1 className="text-2xl font-bold mt-4 mb-1" style={{ color: "#1a5c3a" }}>
          Operational Overview
        </h1>
        <p className="text-sm mb-8" style={{ color: "#4a7c5e" }}>
          {formatMonthLabel(data.month)}
        </p>

        <div className="grid grid-cols-3 gap-5 flex-1">
          <KPITile value={kpis.activeProjects} label="Active Projects" />
          <KPITile value={kpis.constructionStarts} label="Construction Starts (Actual)" />
          <KPITile
            value={kpis.pdPmHandovers}
            label="PD → PM Handovers"
          />
          <KPITile value={kpis.commissionings} label="Commissionings" />
          <KPITile
            value={kpis.clientHandoversPlanned}
            label="Client Handovers (Planned)"
          />
          <KPITile
            value={kpis.rag.onTrack}
            label="Projects On Track"
            sub={`G: ${kpis.rag.green} / A: ${kpis.rag.amber} / R: ${kpis.rag.red}`}
          />
        </div>

        <div className="mt-auto pt-4 flex items-center justify-between">
          <span className="text-[10px]" style={{ color: "#999" }}>
            Generated: {new Date(data.generatedAt).toLocaleString("en-ZA")}
          </span>
          <span className="text-[10px] font-medium" style={{ color: "#1a5c3a" }}>
            CONFIDENTIAL
          </span>
        </div>
      </div>
    </div>
  );
}

export default function OperationalOverviewReport() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<KPIData>({
    queryKey: ["operational-overview", activeMonth],
    queryFn: () => {
      const token = localStorage.getItem("auth_token");
      return fetchReport(activeMonth!, token);
    },
    enabled: !!activeMonth,
    staleTime: 0,
  });

  const handleGenerate = () => {
    setActiveMonth(selectedMonth);
  };

  const handleExportPdf = async () => {
    if (!slideRef.current) return;
    const el = slideRef.current;

    const { default: html2canvas } = await import("html2canvas");
    const { default: jsPDF } = await import("jspdf");

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [297, 167],
    });

    pdf.addImage(imgData, "PNG", 0, 0, 297, 167);
    const monthLabel = activeMonth ? formatMonthLabel(activeMonth) : "Report";
    pdf.save(`Operational Overview - ${monthLabel}.pdf`);
  };

  return (
    <div data-testid="operational-overview-report" className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/reports" className="hover:text-foreground transition-colors flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          Reports
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Operational Overview</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <FileBarChart className="h-7 w-7 text-emerald-600" />
          <h2 className="text-2xl font-heading font-bold" data-testid="text-report-title">
            Operational Overview
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-44 h-9"
            data-testid="input-report-month"
          />
          <Button
            onClick={handleGenerate}
            disabled={isLoading}
            className="bg-emerald-700 hover:bg-emerald-800 text-white"
            data-testid="button-generate-report"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Generate
          </Button>
          {data && (
            <Button
              variant="outline"
              onClick={handleExportPdf}
              data-testid="button-export-pdf"
            >
              <Download className="h-4 w-4 mr-1" />
              Export PDF
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="text-report-error">
          {(error as Error).message}
        </div>
      )}

      {!activeMonth && !data && (
        <div className="rounded-xl border-2 border-dashed p-16 text-center text-muted-foreground">
          <FileBarChart className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">Select a month and click Generate</p>
          <p className="text-sm mt-1">The report will render as a presentation slide</p>
        </div>
      )}

      {data && (
        <div className="flex justify-center">
          <div
            ref={slideRef}
            className="rounded-xl overflow-hidden shadow-2xl border"
            style={{ maxWidth: "1100px", width: "100%" }}
          >
            <ReportSlide data={data} />
          </div>
        </div>
      )}

      <RagManager />
    </div>
  );
}

interface RagProject {
  id: number;
  projectName: string;
  phase: string | null;
  ragStatus: string | null;
  ragUpdatedAt: string | null;
}

const RAG_COLORS: Record<string, string> = {
  GREEN: "bg-emerald-500",
  AMBER: "bg-amber-500",
  RED: "bg-red-500",
};

const RAG_BADGE: Record<string, string> = {
  GREEN: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  AMBER: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  RED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function RagManager() {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: ragData, isLoading } = useQuery<{ projects: RagProject[] }>({
    queryKey: ["admin-rag-summary"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/admin/projects/rag-summary", { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: expanded,
  });

  const updateRag = useMutation({
    mutationFn: async ({ id, ragStatus }: { id: number; ragStatus: string }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/projects/${id}/rag`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ ragStatus }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-rag-summary"] });
      queryClient.invalidateQueries({ queryKey: ["operational-overview"] });
      toast({ title: "RAG status updated" });
    },
  });

  const projects = ragData?.projects || [];

  return (
    <div className="border rounded-lg overflow-hidden" data-testid="rag-manager">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Manage Project RAG Status
        <span className="text-xs text-muted-foreground ml-1">({projects.length} active projects)</span>
      </button>

      {expanded && (
        <div className="border-t divide-y">
          {isLoading ? (
            <div className="p-6 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No active projects found</div>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`rag-row-${p.id}`}>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{p.projectName}</span>
                  {p.phase && <span className="text-[10px] text-muted-foreground">{p.phase}</span>}
                </div>

                <div className="flex items-center gap-1.5">
                  {p.ragStatus && (
                    <Badge className={`text-[9px] px-1.5 py-0 ${RAG_BADGE[p.ragStatus] || ""}`}>
                      {p.ragStatus}
                    </Badge>
                  )}
                  {p.ragUpdatedAt && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(p.ragUpdatedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                    </span>
                  )}
                </div>

                <div className="flex gap-1 shrink-0">
                  {(["GREEN", "AMBER", "RED"] as const).map((rag) => (
                    <button
                      key={rag}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        p.ragStatus === rag
                          ? `${RAG_COLORS[rag]} border-transparent shadow-md scale-110`
                          : `bg-transparent border-current opacity-30 hover:opacity-70`
                      }`}
                      style={{ color: rag === "GREEN" ? "#10b981" : rag === "AMBER" ? "#f59e0b" : "#ef4444" }}
                      onClick={() => updateRag.mutate({ id: p.id, ragStatus: rag })}
                      disabled={updateRag.isPending}
                      title={`Set ${rag}`}
                      data-testid={`button-rag-${p.id}-${rag.toLowerCase()}`}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

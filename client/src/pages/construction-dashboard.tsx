import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { HardHat, AlertTriangle, ClipboardCheck, Users, Plus } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

interface SnagSummary { id: number; title: string; severity: string; status: string; projectId: number; }
interface InspectionSummary { id: number; inspectionType: string; status: string; inspectionDate: string | null; projectId: number; }

function severityColor(s: string) {
  if (s === "critical") return "bg-red-100 text-red-700 border-red-200";
  if (s === "major") return "bg-amber-100 text-amber-700 border-amber-200";
  if (s === "minor") return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-muted text-muted-foreground";
}

function statusBadge(s: string) {
  if (s === "open") return "bg-red-50 text-red-600";
  if (s === "in_progress") return "bg-amber-50 text-amber-600";
  if (s === "resolved" || s === "completed") return "bg-green-50 text-green-600";
  return "bg-muted text-muted-foreground";
}

export default function ConstructionDashboardPage() {
  const [tab, setTab] = useState<"snags" | "inspections">("snags");

  const { data: snags = [], isLoading: snagsLoading, isError, error, refetch } = useQuery<SnagSummary[]>({
    queryKey: ["/api/construction/snags"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/construction/snags");
      if (!res.ok) throw new Error('Failed to fetch data (' + res.status + ')');
      return res.json();
    },
  });

  const { data: inspections = [], isLoading: inspectionsLoading } = useQuery<InspectionSummary[]>({
    queryKey: ["/api/construction/inspections"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/construction/inspections");
      return res.json();
    },
  });

  const openSnags = snags.filter(s => s.status === "open" || s.status === "in_progress");
  const criticalSnags = snags.filter(s => s.severity === "critical" && s.status !== "closed");
  const scheduledInspections = inspections.filter(i => i.status === "scheduled");

  if (snagsLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4 md:p-6"><PageError title="Unable to load Construction Dashboard" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-construction-dashboard">
      <SectionHeader
        icon={<HardHat className="h-5 w-5" />}
        eyebrow="Projects"
        title="Construction"
        description={`${openSnags.length} open snags, ${scheduledInspections.length} inspections scheduled`}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{openSnags.length}</div>
            <div className="text-xs text-muted-foreground">Open Snags</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-red-600">{criticalSnags.length}</div>
            <div className="text-xs text-muted-foreground">Critical Snags</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{scheduledInspections.length}</div>
            <div className="text-xs text-muted-foreground">Inspections Due</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{snags.filter(s => s.status === "resolved" || s.status === "verified").length}</div>
            <div className="text-xs text-muted-foreground">Resolved This Period</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 w-fit">
        {(["snags", "inspections"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
              tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Snags list */}
      {tab === "snags" && (
        <div className="space-y-2">
          {snagsLoading && <p className="text-sm text-muted-foreground">Loading snags...</p>}
          {!snagsLoading && snags.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No snags recorded yet.</p>
              </CardContent>
            </Card>
          )}
          {snags.map(snag => (
            <Card key={snag.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3 flex items-center gap-3">
                <Badge className={`text-[10px] ${severityColor(snag.severity)}`}>{snag.severity}</Badge>
                <span className="text-sm font-medium flex-1 truncate">{snag.title}</span>
                <Badge className={`text-[10px] ${statusBadge(snag.status)}`}>{snag.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Inspections list */}
      {tab === "inspections" && (
        <div className="space-y-2">
          {inspectionsLoading && <p className="text-sm text-muted-foreground">Loading inspections...</p>}
          {!inspectionsLoading && inspections.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <ClipboardCheck className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No inspections scheduled yet.</p>
              </CardContent>
            </Card>
          )}
          {inspections.map(insp => (
            <Card key={insp.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3 flex items-center gap-3">
                <ClipboardCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium flex-1">{insp.inspectionType}</span>
                <span className="text-xs text-muted-foreground">{insp.inspectionDate || "Not scheduled"}</span>
                <Badge className={`text-[10px] ${statusBadge(insp.status)}`}>{insp.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

    </PageShell>
  );
}

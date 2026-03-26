import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { ShieldAlert, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface HseIncidentSummary { id: number; incidentType: string; severity: string; description: string; status: string; incidentDate: string; }
interface CorrectiveActionSummary { id: number; title: string; sourceType: string; status: string; dueDate: string | null; }

function incidentTypeBadge(t: string) {
  const map: Record<string, string> = {
    near_miss: "bg-amber-50 text-amber-700",
    first_aid: "bg-blue-50 text-blue-700",
    medical: "bg-orange-50 text-orange-700",
    lost_time: "bg-red-50 text-red-700",
    fatality: "bg-red-100 text-red-800",
    environmental: "bg-green-50 text-green-700",
    property_damage: "bg-purple-50 text-purple-700",
  };
  return map[t] || "bg-muted text-muted-foreground";
}

function severityBadge(s: string) {
  if (s === "critical") return "bg-red-100 text-red-700";
  if (s === "high") return "bg-orange-100 text-orange-700";
  if (s === "medium") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

export default function HseDashboardPage() {
  const [tab, setTab] = useState<"incidents" | "corrective_actions">("incidents");

  const { data: incidents = [], isLoading: incidentsLoading } = useQuery<HseIncidentSummary[]>({
    queryKey: ["/api/hse/incidents"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/hse/incidents");
      return res.json();
    },
  });

  const { data: actions = [], isLoading: actionsLoading } = useQuery<CorrectiveActionSummary[]>({
    queryKey: ["/api/hse/corrective-actions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/hse/corrective-actions");
      return res.json();
    },
  });

  const openIncidents = incidents.filter(i => i.status !== "closed");
  const openActions = actions.filter(a => a.status !== "completed" && a.status !== "verified");
  const overdueActions = actions.filter(a => a.dueDate && new Date(a.dueDate) < new Date() && a.status !== "completed" && a.status !== "verified");

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-hse-dashboard">
      <SectionHeader
        icon={<ShieldAlert className="h-5 w-5" />}
        eyebrow="Quality & HSE"
        title="Health, Safety & Environment"
        description={`${openIncidents.length} open incidents, ${openActions.length} corrective actions pending`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{openIncidents.length}</div>
            <div className="text-xs text-muted-foreground">Open Incidents</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{openActions.length}</div>
            <div className="text-xs text-muted-foreground">Open Actions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-red-600">{overdueActions.length}</div>
            <div className="text-xs text-muted-foreground">Overdue Actions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-green-600">{incidents.filter(i => i.status === "closed").length}</div>
            <div className="text-xs text-muted-foreground">Resolved</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 w-fit">
        {([
          { key: "incidents" as const, label: "HSE Incidents" },
          { key: "corrective_actions" as const, label: "Corrective Actions" },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "incidents" && (
        <div className="space-y-2">
          {incidentsLoading && <p className="text-sm text-muted-foreground">Loading incidents...</p>}
          {!incidentsLoading && incidents.length === 0 && (
            <Card><CardContent className="py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No HSE incidents recorded. Keep up the good work.</p>
            </CardContent></Card>
          )}
          {incidents.map(incident => (
            <Card key={incident.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge className={`text-[10px] ${incidentTypeBadge(incident.incidentType)}`}>
                    {incident.incidentType.replace(/_/g, " ")}
                  </Badge>
                  <Badge className={`text-[10px] ${severityBadge(incident.severity)}`}>{incident.severity}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{incident.incidentDate}</span>
                </div>
                <p className="text-sm truncate">{incident.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "corrective_actions" && (
        <div className="space-y-2">
          {actionsLoading && <p className="text-sm text-muted-foreground">Loading actions...</p>}
          {!actionsLoading && actions.length === 0 && (
            <Card><CardContent className="py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No corrective actions pending.</p>
            </CardContent></Card>
          )}
          {actions.map(action => (
            <Card key={action.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3 flex items-center gap-3">
                <Badge variant="outline" className="text-[10px]">{action.sourceType.replace(/_/g, " ")}</Badge>
                <span className="text-sm font-medium flex-1 truncate">{action.title}</span>
                {action.dueDate && (
                  <span className={`text-xs ${new Date(action.dueDate) < new Date() ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                    <Clock className="h-3 w-3 inline mr-0.5" />{action.dueDate}
                  </span>
                )}
                <Badge variant="secondary" className="text-[10px]">{action.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}

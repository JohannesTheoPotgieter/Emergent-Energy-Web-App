import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Clock, Target, Layers, Shield, Loader2 } from "lucide-react";

interface Warning {
  title: string;
  severity: string;
}

interface ProjectAtRisk {
  id: number;
  projectName: string;
  phase: string;
  warningCount: number;
  warnings: Warning[];
}

interface Milestone {
  id: number;
  title: string;
  projectName: string;
  dueDate: string;
  status: string;
  priority: string;
}

interface OverdueTask {
  id: number;
  title: string;
  dueAt: string;
  status: string;
  projectName: string;
}

interface CockpitData {
  projectsAtRisk: ProjectAtRisk[];
  milestones: Milestone[];
  overdueByOwner: Record<string, OverdueTask[]>;
  overdueTotalCount: number;
  totalProjects: number;
  totalOpenWarnings: number;
  totalHighWarnings: number;
}

const phaseColor = (phase: string) => {
  if (phase?.startsWith("P0")) return "bg-slate-100 text-slate-700";
  if (phase?.startsWith("P1")) return "bg-blue-100 text-blue-700";
  if (phase?.startsWith("P2")) return "bg-indigo-100 text-indigo-700";
  if (phase?.startsWith("P3")) return "bg-violet-100 text-violet-700";
  if (phase?.startsWith("P4")) return "bg-orange-100 text-orange-700";
  if (phase?.startsWith("P5")) return "bg-teal-100 text-teal-700";
  if (phase?.startsWith("P6")) return "bg-emerald-100 text-emerald-700";
  if (phase?.startsWith("P7")) return "bg-gray-100 text-gray-700";
  return "bg-gray-100 text-gray-600";
};

const authFetch = async (url: string) => {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
};

export default function ExecCockpitPage() {
  const { isAdmin } = useAuth();

  const { data, isLoading } = useQuery<CockpitData>({
    queryKey: ["/api/exec/cockpit"],
    queryFn: () => authFetch("/api/exec/cockpit"),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <MyToolLayout>
        <div className="p-8 text-center" data-testid="text-admin-required">
          <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Admin Access Required</h2>
          <p className="text-muted-foreground">You do not have permission to view this page.</p>
        </div>
      </MyToolLayout>
    );
  }

  if (isLoading || !data) {
    return (
      <MyToolLayout>
        <div className="flex justify-center py-20" data-testid="loading-cockpit">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </MyToolLayout>
    );
  }

  return (
    <MyToolLayout>
    <div className="p-6 max-w-[1600px] mx-auto space-y-6" data-testid="exec-cockpit-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-cockpit-title">COO Execution Cockpit</h1>
        <p className="text-muted-foreground">Real-time executive overview of project risk, milestones, and overdue tasks</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Layers className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold" data-testid="text-total-projects">{data.totalProjects}</div>
                <div className="text-xs text-muted-foreground">Total Projects</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${data.totalHighWarnings > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                <AlertTriangle className={`w-5 h-5 ${data.totalHighWarnings > 0 ? "text-red-600" : "text-gray-400"}`} />
              </div>
              <div>
                <div className={`text-2xl font-bold ${data.totalHighWarnings > 0 ? "text-red-600" : ""}`} data-testid="text-high-warnings">
                  {data.totalHighWarnings}
                </div>
                <div className="text-xs text-muted-foreground">High Warnings</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${data.overdueTotalCount > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
                <Clock className={`w-5 h-5 ${data.overdueTotalCount > 0 ? "text-amber-600" : "text-gray-400"}`} />
              </div>
              <div>
                <div className={`text-2xl font-bold ${data.overdueTotalCount > 0 ? "text-amber-600" : ""}`} data-testid="text-overdue-count">
                  {data.overdueTotalCount}
                </div>
                <div className="text-xs text-muted-foreground">Overdue Tasks</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Projects at Risk
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.projectsAtRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-risk-projects">No projects with high warnings</p>
          ) : (
            <div className="space-y-2">
              {data.projectsAtRisk.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between border rounded-lg px-4 py-3"
                  data-testid={`card-risk-project-${p.id}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium" data-testid={`text-risk-project-name-${p.id}`}>{p.projectName}</span>
                    <Badge className={phaseColor(p.phase)} data-testid={`badge-risk-phase-${p.id}`}>{p.phase}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" data-testid={`badge-risk-warnings-${p.id}`}>
                      {p.warningCount} warning{p.warningCount !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-500" />
            Milestones Due in 14 Days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-milestones">No milestones due in the next 14 days</p>
          ) : (
            <Table data-testid="table-milestones">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.milestones.map((m) => (
                  <TableRow key={m.id} data-testid={`row-milestone-${m.id}`}>
                    <TableCell className="font-medium" data-testid={`text-milestone-title-${m.id}`}>{m.title}</TableCell>
                    <TableCell data-testid={`text-milestone-project-${m.id}`}>{m.projectName}</TableCell>
                    <TableCell data-testid={`text-milestone-due-${m.id}`}>
                      {new Date(m.dueDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-milestone-status-${m.id}`}>{m.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            Overdue Tasks
            {data.overdueTotalCount > 0 && (
              <Badge variant="secondary" className="ml-1">{data.overdueTotalCount}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(data.overdueByOwner).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-overdue">No overdue tasks</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(data.overdueByOwner).map(([owner, tasks]) => (
                <div key={owner} data-testid={`section-overdue-owner-${owner}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold" data-testid={`text-overdue-owner-${owner}`}>{owner}</span>
                    <Badge variant="outline" className="text-xs">{tasks.length}</Badge>
                  </div>
                  <div className="space-y-1 ml-6">
                    {tasks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between text-sm border rounded px-3 py-2"
                        data-testid={`row-overdue-task-${t.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium" data-testid={`text-overdue-title-${t.id}`}>{t.title}</span>
                          <span className="text-xs text-muted-foreground shrink-0">({t.projectName})</span>
                        </div>
                        <span className="text-xs text-red-500 shrink-0 ml-2" data-testid={`text-overdue-date-${t.id}`}>
                          Due {new Date(t.dueAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </MyToolLayout>
  );
}
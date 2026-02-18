import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Wrench,
  Users,
  Target,
  Package,
  Link2,
  Clock,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { EpmChallengeModal } from "@/components/EpmChallengeModal";

async function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface WorkloadRow {
  name: string;
  activeTasks: number;
  dueThisWeek: number;
  overdue: number;
  onHold: number;
  needsApproval: number;
  provideFeedback: number;
}

interface MilestoneAtRisk {
  id: number;
  projectName: string;
  milestoneName: string;
  dueDate: string;
  linkedTasks: number;
  incompleteTasks: number;
  highWarnings: number;
  deliverableStatuses: Array<{ name: string; status: string }>;
}

interface PipelineStatus {
  status: string;
  count: number;
}

interface WarningItem {
  id: number;
  projectName: string;
  title: string;
  description: string;
  ageDays: number;
  severity: string;
}

interface OrphanTask {
  id: number;
  title: string;
  projectName: string;
  assignee: string | null;
  status: string;
}

const PIPELINE_ORDER = [
  "TO DO",
  "IN PROGRESS",
  "NEEDS APPROVAL",
  "PROVIDE FEEDBACK",
  "QC APPROVED",
  "OPERATIONAL APPROVAL",
  "COMPLETE",
];

const pipelineColors: Record<string, string> = {
  "TO DO": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "IN PROGRESS": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "NEEDS APPROVAL": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "QC APPROVED": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "OPERATIONAL APPROVAL": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "COMPLETE": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

export default function EngineeringDashboard() {
  const [accessGranted, setAccessGranted] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  useEffect(() => {
    async function checkAccess() {
      try {
        const data = await engFetch("/api/engineering/access/status");
        if (data.needsChallenge) {
          setShowChallenge(true);
        } else {
          setAccessGranted(true);
        }
      } catch {
        setShowChallenge(true);
      } finally {
        setCheckingAccess(false);
      }
    }
    checkAccess();
  }, []);

  const { data: workload = [], isLoading: workloadLoading } = useQuery<WorkloadRow[]>({
    queryKey: ["eng-dashboard-workload"],
    queryFn: () => engFetch("/api/eng/dashboard/workload"),
    enabled: accessGranted,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: milestones = [], isLoading: milestonesLoading } = useQuery<MilestoneAtRisk[]>({
    queryKey: ["eng-dashboard-milestones"],
    queryFn: () => engFetch("/api/eng/dashboard/milestones-at-risk"),
    enabled: accessGranted,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: pipeline = [], isLoading: pipelineLoading } = useQuery<PipelineStatus[]>({
    queryKey: ["eng-dashboard-pipeline"],
    queryFn: () => engFetch("/api/eng/dashboard/deliverables-pipeline"),
    enabled: accessGranted,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: warnings = [], isLoading: warningsLoading } = useQuery<WarningItem[]>({
    queryKey: ["eng-dashboard-warnings"],
    queryFn: () => engFetch("/api/eng/dashboard/warning-tower"),
    enabled: accessGranted,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: orphanTasks = [], isLoading: orphansLoading } = useQuery<OrphanTask[]>({
    queryKey: ["eng-dashboard-orphans"],
    queryFn: () => engFetch("/api/eng/dashboard/orphan-tasks"),
    enabled: accessGranted,
    refetchOnMount: "always",
    staleTime: 0,
  });

  if (checkingAccess) {
    return (
      <div data-testid="eng-dashboard-loading" className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!accessGranted) {
    return (
      <div data-testid="eng-dashboard-locked" className="space-y-6">
        <div className="flex items-center gap-3">
          <Wrench className="h-8 w-8 text-orange-500" />
          <h2 className="text-3xl font-heading font-bold text-foreground">Engineering Dashboard</h2>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <ShieldAlert className="h-12 w-12 text-orange-500" />
            <p className="text-lg font-medium text-muted-foreground">Access verification required</p>
            <Button
              data-testid="button-unlock-engineering"
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => setShowChallenge(true)}
            >
              Enter Access Code
            </Button>
          </CardContent>
        </Card>
        <EpmChallengeModal
          open={showChallenge}
          onSuccess={() => {
            setShowChallenge(false);
            setAccessGranted(true);
          }}
          onClose={() => setShowChallenge(false)}
        />
      </div>
    );
  }

  const pipelineMap = new Map(pipeline.map((p) => [p.status, p.count]));
  const orderedPipeline = PIPELINE_ORDER.map((status) => ({
    status,
    count: pipelineMap.get(status) ?? 0,
  }));
  const totalPipeline = orderedPipeline.reduce((s, p) => s + p.count, 0);

  return (
    <div data-testid="eng-dashboard" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wrench className="h-8 w-8 text-orange-500" />
          <div>
            <h2 className="text-2xl sm:text-3xl font-heading font-bold text-foreground" data-testid="text-eng-dashboard-title">
              Engineering Dashboard
            </h2>
            <p className="text-sm text-muted-foreground">Engineering Program Manager overview</p>
          </div>
        </div>
      </div>

      {/* Team Workload */}
      <Card data-testid="card-team-workload">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            Team Workload
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workloadLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : workload.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-workload-empty">No workload data available</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-center">Active Tasks</TableHead>
                    <TableHead className="text-center">Due This Week</TableHead>
                    <TableHead className="text-center">Overdue</TableHead>
                    <TableHead className="text-center">On Hold</TableHead>
                    <TableHead className="text-center">Needs Approval</TableHead>
                    <TableHead className="text-center">Provide Feedback</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workload.map((row, i) => (
                    <TableRow key={i} data-testid={`row-workload-${i}`}>
                      <TableCell className="font-medium" data-testid={`text-workload-name-${i}`}>{row.name}</TableCell>
                      <TableCell className="text-center" data-testid={`text-workload-active-${i}`}>{row.activeTasks}</TableCell>
                      <TableCell className="text-center" data-testid={`text-workload-due-${i}`}>{row.dueThisWeek}</TableCell>
                      <TableCell className="text-center">
                        {row.overdue > 0 ? (
                          <Badge variant="destructive" className="bg-red-600 text-white" data-testid={`badge-workload-overdue-${i}`}>
                            {row.overdue}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground" data-testid={`text-workload-overdue-${i}`}>0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`text-workload-hold-${i}`}>{row.onHold}</TableCell>
                      <TableCell className="text-center" data-testid={`text-workload-approval-${i}`}>{row.needsApproval}</TableCell>
                      <TableCell className="text-center" data-testid={`text-workload-feedback-${i}`}>{row.provideFeedback}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Milestones at Risk */}
      <Card data-testid="card-milestones-risk">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-amber-500" />
            Milestones at Risk
            <span className="text-sm font-normal text-muted-foreground">(next 14 days)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {milestonesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : milestones.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-milestones-empty">No milestones at risk</p>
          ) : (
            <div className="space-y-3">
              {milestones.map((ms, i) => (
                <div
                  key={ms.id ?? i}
                  data-testid={`card-milestone-${i}`}
                  className={`p-4 rounded-lg border ${
                    ms.highWarnings > 0
                      ? "border-red-300 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800/50"
                      : "border-border"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <p className="font-medium" data-testid={`text-milestone-project-${i}`}>{ms.projectName}</p>
                      <p className="text-sm text-muted-foreground" data-testid={`text-milestone-name-${i}`}>{ms.milestoneName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs" data-testid={`badge-milestone-due-${i}`}>
                        <Clock className="h-3 w-3 mr-1" />
                        Due: {ms.dueDate ? new Date(ms.dueDate).toLocaleDateString() : "—"}
                      </Badge>
                      <Badge variant="secondary" className="text-xs" data-testid={`badge-milestone-tasks-${i}`}>
                        {ms.linkedTasks} tasks ({ms.incompleteTasks} incomplete)
                      </Badge>
                      {ms.highWarnings > 0 && (
                        <Badge className="bg-red-600 text-white text-xs font-bold" data-testid={`badge-milestone-warnings-${i}`}>
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {ms.highWarnings} HIGH
                        </Badge>
                      )}
                    </div>
                  </div>
                  {ms.deliverableStatuses && ms.deliverableStatuses.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {ms.deliverableStatuses.map((d, di) => (
                        <Badge
                          key={di}
                          variant="outline"
                          className="text-[10px]"
                          data-testid={`badge-deliverable-${i}-${di}`}
                        >
                          {d.name}: {d.status}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deliverables Pipeline */}
      <Card data-testid="card-deliverables-pipeline">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5 text-indigo-500" />
            Deliverables Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pipelineLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-4">
                {orderedPipeline.map((p) => (
                  <div
                    key={p.status}
                    data-testid={`card-pipeline-${p.status.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`rounded-lg p-3 text-center ${pipelineColors[p.status] ?? "bg-gray-100 text-gray-700"}`}
                  >
                    <p className="text-2xl font-bold" data-testid={`text-pipeline-count-${p.status.toLowerCase().replace(/\s+/g, "-")}`}>
                      {p.count}
                    </p>
                    <p className="text-[10px] font-medium uppercase tracking-wider mt-1">{p.status}</p>
                  </div>
                ))}
              </div>
              {totalPipeline > 0 && (
                <div className="flex h-4 rounded-full overflow-hidden" data-testid="bar-pipeline-progress">
                  {orderedPipeline
                    .filter((p) => p.count > 0)
                    .map((p) => (
                      <div
                        key={p.status}
                        className={`${pipelineColors[p.status]?.split(" ")[0] ?? "bg-gray-200"} transition-all`}
                        style={{ width: `${(p.count / totalPipeline) * 100}%` }}
                        title={`${p.status}: ${p.count}`}
                      />
                    ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Warning Control Tower */}
      <Card data-testid="card-warning-tower" className="border-red-200 dark:border-red-800/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Warning Control Tower
            {warnings.length > 0 && (
              <Badge className="bg-red-600 text-white ml-2" data-testid="badge-warning-count">
                {warnings.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {warningsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : warnings.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-warnings-empty">No active high-severity warnings</p>
          ) : (
            <div className="space-y-2">
              {warnings.map((w, i) => (
                <div
                  key={w.id ?? i}
                  data-testid={`card-warning-${i}`}
                  className="p-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800/60"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-red-800 dark:text-red-300" data-testid={`text-warning-title-${i}`}>
                          {w.title}
                        </span>
                        <Badge className="bg-red-600 text-white text-[10px] font-bold" data-testid={`badge-warning-severity-${i}`}>
                          HIGH
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 dark:text-red-400" data-testid={`badge-warning-age-${i}`}>
                          {w.ageDays}d old
                        </Badge>
                      </div>
                      <p className="text-sm text-red-700/80 dark:text-red-400/80 mt-0.5" data-testid={`text-warning-project-${i}`}>
                        {w.projectName}
                      </p>
                      {w.description && (
                        <p className="text-xs text-red-600/70 dark:text-red-400/60 mt-1 line-clamp-2" data-testid={`text-warning-desc-${i}`}>
                          {w.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Orphan Tasks */}
      <Card data-testid="card-orphan-tasks">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Link2 className="h-5 w-5 text-gray-500" />
            Orphan Tasks (Unlinked)
            {orphanTasks.length > 0 && (
              <Badge variant="secondary" className="ml-2" data-testid="badge-orphan-count">
                {orphanTasks.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {orphansLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orphanTasks.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-orphans-empty">No orphan tasks</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orphanTasks.map((task, i) => (
                    <TableRow key={task.id ?? i} data-testid={`row-orphan-${i}`}>
                      <TableCell className="font-medium" data-testid={`text-orphan-title-${i}`}>{task.title}</TableCell>
                      <TableCell data-testid={`text-orphan-project-${i}`}>{task.projectName}</TableCell>
                      <TableCell data-testid={`text-orphan-assignee-${i}`}>{task.assignee ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs" data-testid={`badge-orphan-status-${i}`}>
                          {task.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          data-testid={`button-link-orphan-${i}`}
                        >
                          <Link2 className="h-3 w-3 mr-1" />
                          Link
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

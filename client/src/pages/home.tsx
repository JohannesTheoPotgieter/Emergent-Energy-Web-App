import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2, Mail, MessageSquare } from "lucide-react";
import { getRoleQuickActions, normalizeRoleLabel } from "@/config/home-brief";

type Task = { id: number; title?: string; status?: string; dueDate?: string; projectName?: string; assignees?: string };
type PriorityData = {
  overdueTasks?: Array<{ id: number; projectName: string; taskName: string; endDate: string; severity?: string }>;
  projectsBehindPlan?: Array<{ projectName: string; severity: string; pm: string | null }>;
  upcomingMilestones?: Array<{ projectName: string; milestoneType: string; date: string }>;
};

type CompanyPriorityLink = {
  id: number;
  linkType: string;
  projectName: string | null;
  taskId: number | null;
  taskType: string | null;
};

type CompanyPriority = {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  ownerRole: string | null;
  status: string;
  priorityRank: number | null;
  links?: CompanyPriorityLink[];
};

function normalizeText(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function isDueToday(dateValue?: string) {
  if (!dateValue) return false;
  const today = new Date();
  const due = new Date(dateValue);
  if (Number.isNaN(due.getTime())) return false;
  return due.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
}

function isOverdue(dateValue?: string) {
  if (!dateValue) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateValue);
  if (Number.isNaN(due.getTime())) return false;
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function getPriorityDestination(priority: CompanyPriority) {
  const firstLink = priority.links?.[0];
  if (!firstLink) return "/company-priorities";
  if (firstLink.linkType === "project" && firstLink.projectName) {
    return `/project/${encodeURIComponent(firstLink.projectName)}`;
  }
  if (firstLink.linkType === "task" && firstLink.taskType === "operational" && firstLink.taskId) {
    return `/my-work/tasks?taskId=${firstLink.taskId}`;
  }
  return "/company-priorities";
}

export default function Home() {
  const { user } = useAuth();
  const role = normalizeRoleLabel(user?.role);

  const { data: tasks = [], error: tasksError, refetch: refetchTasks, isFetching: tasksFetching } = useQuery<Task[]>({
    queryKey: ["home-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/tasks", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load tasks. Refresh and retry. If this continues, contact your admin.");
      return res.json();
    },
  });

  const { data: highPriority, error: highPriorityError, refetch: refetchHighPriority, isFetching: priorityFetching } = useQuery<PriorityData>({
    queryKey: ["home-high-priority"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/high-priority", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load high-priority dashboard data. Refresh and retry, then contact admin if it persists.");
      return res.json();
    },
  });

  const { data: companyPriorities = [], error: companyPrioritiesError, refetch: refetchCompanyPriorities, isFetching: prioritiesFetching } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities?horizon=week"],
    queryFn: async () => {
      const res = await fetch("/api/mytool/company-priorities?horizon=week", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load company priorities.");
      return res.json();
    },
  });

  const dueToday = useMemo(() => tasks.filter((task) => isDueToday(task.dueDate)).slice(0, 4), [tasks]);
  const waitingApproval = useMemo(() => tasks.filter((task) => normalizeText(task.status).includes("approval")).slice(0, 4), [tasks]);
  const blocked = useMemo(() => tasks.filter((task) => normalizeText(task.status).includes("blocked")).slice(0, 4), [tasks]);
  const overdue = useMemo(() => {
    const direct = tasks.filter((task) => isOverdue(task.dueDate) && !["done", "closed", "completed"].includes(normalizeText(task.status)));
    if (direct.length > 0) return direct.slice(0, 4);
    return (highPriority?.overdueTasks || []).slice(0, 4).map((item) => ({
      id: item.id,
      title: item.taskName,
      dueDate: item.endDate,
      projectName: item.projectName,
      status: "Overdue",
    }));
  }, [highPriority, tasks]);

  const roleActions = useMemo(() => getRoleQuickActions(role).slice(0, 5), [role]);

  const filteredPriorities = useMemo(() => {
    const userDepartment = normalizeText((user as any)?.department || (user as any)?.businessUnit || (user as any)?.team);
    return companyPriorities
      .filter((priority) => !["closed", "complete"].includes(normalizeText(priority.status)))
      .filter((priority) => {
        const roleTarget = normalizeText(priority.ownerRole);
        const departmentTarget = normalizeText(priority.department);
        const roleMatch = !roleTarget || roleTarget === role || roleTarget === "company-wide" || roleTarget === "all";
        const departmentMatch = !departmentTarget || departmentTarget === "company-wide" || departmentTarget === "all" || (userDepartment && departmentTarget === userDepartment);
        return roleMatch && departmentMatch;
      })
      .sort((a, b) => (a.priorityRank ?? 999) - (b.priorityRank ?? 999))
      .slice(0, 5);
  }, [companyPriorities, role, user]);

  const roleKpis = {
    "Open Tasks": tasks.filter((task) => !["done", "completed", "closed"].includes(normalizeText(task.status))).length,
    "Overdue Work": overdue.length,
    "Waiting Approval": waitingApproval.length,
    "Blocked": blocked.length,
  };

  const hasErrors = tasksError || highPriorityError || companyPrioritiesError;
  const isRetrying = tasksFetching || priorityFetching || prioritiesFetching;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="text-sm text-slate-600">Daily operating brief for {user?.username || "your"} day.</p>
      </div>

      {hasErrors ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-2">
          <p>Some home data could not load. Please refresh or retry.</p>
          <Button variant="outline" size="sm" onClick={() => { refetchTasks(); refetchHighPriority(); refetchCompanyPriorities(); }} disabled={isRetrying}>
            {isRetrying ? "Retrying..." : "Retry home data"}
          </Button>
        </div>
      ) : null}

      <Card className="border-emerald-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Company Priorities</CardTitle>
          <p className="text-sm text-slate-600">What matters most for Emergent Energy today.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredPriorities.length ? filteredPriorities.map((priority) => (
            <div key={priority.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-sm">{priority.title}</p>
                <div className="flex items-center gap-2">
                  {priority.department ? <Badge variant="outline">{priority.department}</Badge> : null}
                  {priority.ownerRole ? <Badge className="bg-slate-100 text-slate-700">{priority.ownerRole}</Badge> : <Badge className="bg-emerald-100 text-emerald-700">Company-wide</Badge>}
                </div>
              </div>
              {priority.description ? <p className="mt-1 text-sm text-slate-600">{priority.description}</p> : null}
              <div className="mt-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={getPriorityDestination(priority)}>Open priority</Link>
                </Button>
              </div>
            </div>
          )) : <p className="text-sm text-slate-500">No active priorities are published for your scope. Visit Company Priorities for full context.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">My Morning Focus</CardTitle>
            <p className="text-sm text-slate-600">What you need to do first.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {[{ label: "Due today", count: dueToday.length, items: dueToday }, { label: "Waiting for my approval", count: waitingApproval.length, items: waitingApproval }, { label: "Overdue", count: overdue.length, items: overdue }, { label: "Blocked / needs escalation", count: blocked.length, items: blocked }].map((bucket) => (
              <div key={bucket.label} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{bucket.label}</p>
                  <Badge className="bg-slate-100 text-slate-700">{bucket.count}</Badge>
                </div>
                {bucket.items.length ? (
                  <div className="mt-2 space-y-1">
                    {bucket.items.slice(0, 2).map((item) => (
                      <p key={item.id} className="text-xs text-slate-600 truncate">• {item.title || `Task #${item.id}`} {item.projectName ? `· ${item.projectName}` : ""}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Role Quick Actions</CardTitle>
            <p className="text-sm text-slate-600">Where to go next as {role || "your"}.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {roleActions.map((action) => (
              <Link key={action.label} href={action.path} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium">{action.label}</p>
                  <p className="text-xs text-slate-500">{action.description}</p>
                </div>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200/80 shadow-sm bg-slate-50/40">
          <CardHeader><CardTitle className="text-base text-slate-700">Microsoft Integration</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Link href="/my-work/calendar" className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><Calendar className="h-4 w-4" />Calendar</span><span className="text-xs text-slate-500">Open</span></Link>
            <Link href="/my-work/email" className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><Mail className="h-4 w-4" />Email</span><span className="text-xs text-slate-500">Open</span></Link>
            <Link href="/my-work/teams" className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />Teams</span><span className="text-xs text-slate-500">Open</span></Link>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-sm bg-slate-50/40">
          <CardHeader><CardTitle className="text-base text-slate-700">KPI Snapshot</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {Object.entries(roleKpis).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 p-2.5 bg-white">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-semibold">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

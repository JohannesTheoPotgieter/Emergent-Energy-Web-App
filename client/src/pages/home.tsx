import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardList, Mail, MessageSquare, Target } from "lucide-react";
import { getRoleQuickActions, normalizeRoleLabel } from "@/config/home-brief";
import { formatSouthAfricanDate, getDeterministicRoleQuote, getWelcomeHeading } from "@/lib/home-welcome";

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

type ExceptionSummary = { total: number; bySeverity: Record<string, number> };

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

  const { data: exceptionSummary } = useQuery<ExceptionSummary>({
    queryKey: ["home-exception-summary"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/exceptions/summary", { credentials: "include", headers });
      if (!res.ok) return { total: 0, bySeverity: {} };
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

  const myOpenTasks = useMemo(
    () => tasks.filter((task) => !["done", "closed", "completed"].includes(normalizeText(task.status))).slice(0, 6),
    [tasks],
  );

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

  const keyExceptions = useMemo(
    () => [
      ...overdue.map((item) => ({
        id: `overdue-${item.id}`,
        title: item.title || `Task #${item.id}`,
        detail: item.projectName ? `Overdue task · ${item.projectName}` : "Overdue task",
        path: `/my-work/tasks?taskId=${item.id}`,
      })),
      ...blocked.map((item) => ({
        id: `blocked-${item.id}`,
        title: item.title || `Task #${item.id}`,
        detail: item.projectName ? `Blocked task · ${item.projectName}` : "Blocked task",
        path: `/my-work/tasks?taskId=${item.id}`,
      })),
      ...(highPriority?.projectsBehindPlan || []).slice(0, 3).map((project) => ({
        id: `project-${project.projectName}`,
        title: project.projectName,
        detail: `Behind plan · ${project.severity}`,
        path: `/project/${encodeURIComponent(project.projectName)}`,
      })),
    ].slice(0, 6),
    [blocked, highPriority, overdue],
  );

  const projectHealth = useMemo(() => {
    const behind = (highPriority?.projectsBehindPlan || []).slice(0, 4).map((project) => ({
      id: `behind-${project.projectName}`,
      title: project.projectName,
      detail: `Behind plan (${project.severity})`,
      path: `/project/${encodeURIComponent(project.projectName)}`,
    }));
    const milestones = (highPriority?.upcomingMilestones || []).slice(0, 4).map((item) => ({
      id: `milestone-${item.projectName}-${item.milestoneType}`,
      title: item.projectName,
      detail: `${item.milestoneType} · ${item.date}`,
      path: `/project/${encodeURIComponent(item.projectName)}`,
    }));
    return [...behind, ...milestones].slice(0, 6);
  }, [highPriority]);

  const welcomeUser = useMemo(() => ({
    id: user?.id,
    email: user?.email,
    name: user?.name,
    role: user?.role,
  }), [user]);

  const welcomeHeading = useMemo(() => getWelcomeHeading(welcomeUser), [welcomeUser]);
  const welcomeDate = useMemo(() => formatSouthAfricanDate(), []);
  const welcomeQuote = useMemo(() => getDeterministicRoleQuote(welcomeUser, role), [welcomeUser, role]);

  const hasErrors = tasksError || highPriorityError || companyPrioritiesError;
  const isRetrying = tasksFetching || priorityFetching || prioritiesFetching;

  return (
    <div className="ee-page space-y-6 p-0">
      <header className="space-y-4 rounded-xl border border-primary/20 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground md:text-2xl">{welcomeHeading}</h1>
              <p className="text-sm text-muted-foreground">{welcomeDate}</p>
              <p className="mt-1 text-sm text-primary/90">{welcomeQuote}</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
            <Link href="/my-work/tasks">Open My Tasks</Link>
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/company-priorities" className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary hover:bg-primary/15">
            Company priorities: {filteredPriorities.length}
          </Link>
          <Link href="/my-work/tasks" className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted/50">
            Open tasks: {myOpenTasks.length}
          </Link>
          <Link href="/my-work/calendar" className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted/50">
            Due today: {dueToday.length}
          </Link>
        </div>
      </header>

      {hasErrors ? (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>Some home data could not load. Please refresh or retry.</p>
          <Button variant="outline" size="sm" onClick={() => { refetchTasks(); refetchHighPriority(); refetchCompanyPriorities(); }} disabled={isRetrying}>
            {isRetrying ? "Retrying..." : "Retry home data"}
          </Button>
        </div>
      ) : null}

      <Card className="border-primary/30 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Target className="h-4 w-4 text-primary" />Company Priorities / Strategic Focus</CardTitle>
          <p className="text-sm text-muted-foreground">Start here first. These priorities drive today&apos;s execution.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredPriorities.length ? filteredPriorities.map((priority) => (
            <Link key={priority.id} href={getPriorityDestination(priority)} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 hover:border-primary/30 hover:bg-primary/10/40">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{priority.title}</p>
                {priority.description ? <p className="text-xs text-muted-foreground">{priority.description}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {priority.department ? <Badge variant="outline">{priority.department}</Badge> : null}
                <ArrowRight className="h-4 w-4 text-primary" />
              </div>
            </Link>
          )) : <p className="text-sm text-muted-foreground">No active priorities are published for your role. Open Company Priorities for full context.</p>}
        </CardContent>
      </Card>

      <Card className="border-red-100 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><AlertTriangle className="h-4 w-4 text-red-600" />Exception focus</CardTitle>
          <p className="text-sm text-slate-600">Action the highest-risk exceptions first.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {["critical", "high", "medium", "low"].map((sev) => (
              <div key={sev} className="rounded border px-2 py-1">
                <p className="text-[10px] uppercase text-slate-500">{sev}</p>
                <p className="text-sm font-semibold">{exceptionSummary?.bySeverity?.[sev] || 0}</p>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" size="sm"><Link href="/exceptions">Open Exceptions ({exceptionSummary?.total || 0})</Link></Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-4 w-4 text-primary" />My Tasks</CardTitle>
            <p className="text-sm text-muted-foreground">Action your queue now, then clear approvals and blockers.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {myOpenTasks.length ? myOpenTasks.map((task) => (
              <Link key={task.id} href={`/my-work/tasks?taskId=${task.id}`} className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{task.title || `Task #${task.id}`}</p>
                  <p className="text-xs text-muted-foreground">{task.projectName || "General"}{task.dueDate ? ` · Due ${task.dueDate}` : ""}</p>
                </div>
                {task.status ? <Badge className="bg-slate-100 text-foreground">{task.status}</Badge> : null}
              </Link>
            )) : <p className="text-sm text-muted-foreground">No open tasks in your queue.</p>}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg"><AlertTriangle className="h-4 w-4 text-amber-600" />Important Exceptions</CardTitle>
            <p className="text-sm text-muted-foreground">Escalate or resolve these exceptions before normal work.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {keyExceptions.length ? keyExceptions.map((item) => (
              <Link key={item.id} href={item.path} className="flex items-center justify-between rounded-lg border border-amber-200/70 bg-amber-50/50 p-3 hover:bg-amber-50">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-amber-700" />
              </Link>
            )) : <p className="text-sm text-muted-foreground">No urgent exceptions right now.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Role-Based Quick Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {roleActions.map((action) => (
              <Link key={action.label} href={action.path} className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted/50">
                <div>
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  <p className="text-xs text-muted-foreground">{action.description}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-primary" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Meetings, Calendar & Microsoft</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/my-work/calendar" className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted/50 text-sm"><span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" />My Calendar & Meetings</span><ArrowRight className="h-4 w-4 text-muted-foreground/80" /></Link>
            <Link href="/my-work/email" className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted/50 text-sm"><span className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Important Email & Reminders</span><ArrowRight className="h-4 w-4 text-muted-foreground/80" /></Link>
            <Link href="/my-work/teams" className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted/50 text-sm"><span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" />Teams Summary</span><ArrowRight className="h-4 w-4 text-muted-foreground/80" /></Link>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Project Health Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {projectHealth.length ? projectHealth.map((item) => (
              <Link key={item.id} href={item.path} className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted/50">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/80" />
              </Link>
            )) : <p className="text-sm text-muted-foreground">No project health exceptions for your current scope.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Morning Checklist</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          <Link href="/my-work/tasks" className="rounded-lg border border-border p-3 text-sm text-foreground hover:bg-muted/50">1) Clear overdue + blocked items ({overdue.length + blocked.length})</Link>
          <Link href="/my-work/tasks" className="rounded-lg border border-border p-3 text-sm text-foreground hover:bg-muted/50">2) Review approvals waiting ({waitingApproval.length})</Link>
          <Link href="/my-work/calendar" className="rounded-lg border border-border p-3 text-sm text-foreground hover:bg-muted/50">3) Confirm first meetings and dependencies</Link>
          <Link href="/company-priorities" className="rounded-lg border border-border p-3 text-sm text-foreground hover:bg-muted/50">4) Align work to strategic focus</Link>
        </CardContent>
      </Card>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Calendar, CheckCircle2, ClipboardCheck, Clock3, FolderKanban, ListTodo, Mail, MessageSquare, Pin, TrendingUp } from "lucide-react";

type Task = { id: number; title?: string; status?: string; dueDate?: string; projectName?: string; assignees?: string };
type PriorityData = {
  overdueTasks?: Array<{ id: number; projectName: string; taskName: string; endDate: string; severity?: string }>;
  projectsBehindPlan?: Array<{ projectName: string; severity: string; pm: string | null }>;
  upcomingMilestones?: Array<{ projectName: string; milestoneType: string; date: string }>;
};

type ProjectSummary = { id: number; projectName: string; executionPhase?: string; pm?: string; pd?: string; rag?: string };

function statusTone(status?: string) {
  const s = (status || "").toLowerCase();
  if (["done", "complete", "completed", "closed"].includes(s)) return "bg-emerald-100 text-emerald-700";
  if (["overdue", "blocked", "critical"].includes(s)) return "bg-red-100 text-red-700";
  if (["pending", "in progress", "at risk", "warning"].includes(s)) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function Home() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: tasks = [], error: tasksError } = useQuery<Task[]>({
    queryKey: ["home-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/tasks", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load tasks. Refresh and retry. If this continues, contact your admin.");
      return res.json();
    },
  });

  const { data: highPriority, error: highPriorityError } = useQuery<PriorityData>({
    queryKey: ["home-high-priority"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/high-priority", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load high-priority dashboard data. Refresh and retry, then contact admin if it persists.");
      return res.json();
    },
  });

  const { data: projects = [], error: projectsError } = useQuery<ProjectSummary[]>({
    queryKey: ["home-projects-summary"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load project summaries. Refresh and retry. If this keeps failing, contact your admin.");
      return res.json();
    },
  });

  const recentTasks = useMemo(() => tasks.slice(0, 8), [tasks]);
  const overdueItems = useMemo(() => (highPriority?.overdueTasks || []).slice(0, 6), [highPriority]);
  const atRisk = useMemo(() => (highPriority?.projectsBehindPlan || []).slice(0, 6), [highPriority]);
  const recentProjects = useMemo(() => projects.slice(0, 6), [projects]);

  const approvalsNeeded = tasks.filter((t) => (t.status || "").toLowerCase().includes("approval")).slice(0, 5);

  const roleKpis = {
    "Open Tasks": tasks.filter((t) => !["done", "completed", "closed"].includes((t.status || "").toLowerCase())).length,
    "Overdue Work": overdueItems.length,
    "At-Risk Projects": atRisk.length,
    "Upcoming Milestones": highPriority?.upcomingMilestones?.length || 0,
  };

  const sections = [
    {
      key: "actions",
      title: "Actions",
      icon: CheckCircle2,
      body: <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700"><Link href="/pd/tickets/create">New PD Ticket</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href="/actions/launchpad?action=engineering-request">Create Engineering Request</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href="/actions/launchpad?action=task">Create Task</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href="/actions/launchpad?action=handover">Start Handover</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href="/actions/launchpad?action=create-po">Create PO</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href="/actions/launchpad?action=link-invoice">Link Invoice</Link></Button>
      </div>,
    },
    {
      key: "tasks",
      title: "Recent Tasks",
      icon: ListTodo,
      body: <div className="space-y-2">{recentTasks.length ? recentTasks.map((task) => <Link key={task.id} href="/my-work/tasks" className="block rounded-lg border border-slate-200 p-2.5 transition-colors hover:bg-slate-50"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium truncate">{task.title || `Task #${task.id}`}</p><Badge className={statusTone(task.status)}>{task.status || "Open"}</Badge></div><p className="text-xs text-slate-500">{task.projectName || "General"}</p></Link>) : <p className="text-sm text-slate-500">No tasks available.</p>}</div>,
    },
    {
      key: "overdue",
      title: "Overdue Items",
      icon: AlertTriangle,
      body: <div className="space-y-2">{overdueItems.length ? overdueItems.map((item) => <Link key={item.id} href={`/project/${encodeURIComponent(item.projectName)}?tab=plan`} className="block rounded-lg border border-slate-200 p-2.5 transition-colors hover:bg-slate-50"><p className="text-sm font-medium">{item.taskName}</p><p className="text-xs text-slate-500">{item.projectName} · Due {item.endDate}</p></Link>) : <p className="text-sm text-slate-500">No overdue work.</p>}</div>,
    },
    {
      key: "approvals",
      title: "Awaiting Approvals",
      icon: ClipboardCheck,
      body: <div className="space-y-2">{approvalsNeeded.length ? approvalsNeeded.map((item) => <Link key={item.id} href="/my-work/approvals" className="block rounded-lg border border-slate-200 p-2.5 transition-colors hover:bg-slate-50"><p className="text-sm font-medium">{item.title || `Task #${item.id}`}</p><p className="text-xs text-slate-500">{item.projectName || "General"}</p></Link>) : <p className="text-sm text-slate-500">No approvals waiting.</p>}</div>,
    },
    {
      key: "risk",
      title: "At-Risk Items",
      icon: TrendingUp,
      body: <div className="space-y-2">{atRisk.length ? atRisk.map((item) => <Link key={item.projectName} href={`/project/${encodeURIComponent(item.projectName)}`} className="block rounded-lg border border-slate-200 p-2.5 transition-colors hover:bg-slate-50"><p className="text-sm font-medium">{item.projectName}</p><p className="text-xs text-slate-500">{item.pm || "Unassigned"} · {item.severity}</p></Link>) : <p className="text-sm text-slate-500">No at-risk projects.</p>}</div>,
    },
    {
      key: "projects",
      title: "Recent Projects",
      icon: Pin,
      body: <div className="space-y-2">{recentProjects.length ? recentProjects.map((p) => <Link key={p.id} href={`/project/${encodeURIComponent(p.projectName)}`} className="block rounded-lg border border-slate-200 p-2.5 transition-colors hover:bg-slate-50"><div className="flex items-center justify-between"><p className="text-sm font-medium">{p.projectName}</p><Badge className={statusTone(p.rag)}>{p.rag || "Info"}</Badge></div><p className="text-xs text-slate-500">Owner: {p.pm || p.pd || "Unassigned"}</p></Link>) : <p className="text-sm text-slate-500">No projects available.</p>}</div>,
    },
    {
      key: "alerts",
      title: "Operational Alerts",
      icon: Clock3,
      body: <div className="space-y-2">{(highPriority?.upcomingMilestones || []).slice(0, 5).map((m, idx) => <Link key={idx} href={`/project/${encodeURIComponent(m.projectName)}?tab=revenue`} className="block rounded-lg border border-slate-200 p-2.5 transition-colors hover:bg-slate-50"><p className="text-sm font-medium">{m.projectName}</p><p className="text-xs text-slate-500">{m.milestoneType} · {m.date}</p></Link>)}</div>,
    },
  ];

  return (
    <div className="space-y-4 lg:space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="text-sm text-slate-600">Operational command center for {user?.username || "your"} day.</p>
      </div>

      {(tasksError || highPriorityError || projectsError) ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Some home data could not load. Likely reason: temporary server or network issue. How to fix: refresh this page and retry. If it persists, contact your admin.</div> : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {sections.map((section) => (
            <Card key={section.key} className="border-slate-200 shadow-sm">
              <CardHeader className="py-3">
                <button className="w-full flex items-center justify-between" onClick={() => setCollapsed((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}>
                  <CardTitle className="text-base flex items-center gap-2"><section.icon className="h-4 w-4 text-emerald-600" />{section.title}</CardTitle>
                  <span className="text-xs text-slate-500">{collapsed[section.key] ? "Show" : "Hide"}</span>
                </button>
              </CardHeader>
              {!collapsed[section.key] ? <CardContent>{section.body}</CardContent> : null}
            </Card>
          ))}
        </div>

        <div className="space-y-3">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">Microsoft Integration</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Link href="/my-work/calendar" className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><Calendar className="h-4 w-4" />Calendar</span><span className="text-xs text-slate-500">Open</span></Link>
              <Link href="/my-work/email" className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><Mail className="h-4 w-4" />Email</span><span className="text-xs text-slate-500">Open</span></Link>
              <Link href="/my-work/meetings" className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><Calendar className="h-4 w-4" />Meetings</span><span className="text-xs text-slate-500">Today</span></Link>
              <Link href="/my-work/teams" className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />Teams</span><span className="text-xs text-slate-500">Open</span></Link>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">KPI Snapshot</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {Object.entries(roleKpis).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 p-2.5 bg-white">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">Lifecycle Visibility</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Link href="/projects" className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 text-sm"><span className="flex items-center gap-2"><FolderKanban className="h-4 w-4" />Cross-Functional Projects</span><span>Open</span></Link>
              <Link href="/pd" className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 text-sm"><span>Pre-Handover (PD)</span><span>Open</span></Link>
              <Link href="/pm-dashboard" className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 text-sm"><span>Post-Handover (PM)</span><span>Open</span></Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

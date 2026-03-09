import { useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell, SectionHeader, KPIStrip } from "@/components/layout/page-shell";
import {
  AlertTriangle, ArrowRight, BarChart3, Calendar, CheckCircle2,
  CircleDot, Clock, DollarSign, FileCheck, FolderOpen, Gauge,
  Layers, ListTodo, ShieldCheck, Target, TrendingUp, Users, Wallet,
  Wrench, Zap, AlertCircle, ClipboardList, Briefcase,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

type RoleGroup = "coo_admin" | "pd" | "engineer" | "pm" | "qm" | "program_manager" | "finance" | "default";

function getRoleGroup(role: string): RoleGroup {
  const r = role?.toUpperCase() || "";
  if (r === "ADMIN" || r === "COO_ADMIN" || r === "CEO_ADMIN") return "coo_admin";
  if (r === "PROJECT_DEVELOPER") return "pd";
  if (r === "ENGINEER" || r === "ENGINEERING_MANAGER" || r === "ENG_PROGRAM_MANAGER") return "engineer";
  if (r === "PROJECT_MANAGER_SITE" || r === "CONSTRUCTION_MANAGER") return "pm";
  if (r === "QUALITY_MANAGER") return "qm";
  if (r === "PROGRAM_MANAGER") return "program_manager";
  if (r === "CFO" || r === "PROGRAM_FINANCE_MANAGER" || r === "ACCOUNTANT" || r === "CCO") return "finance";
  return "default";
}

const ROLE_GROUP_LABELS: Record<RoleGroup, string> = {
  coo_admin: "Executive Overview",
  pd: "Project Development",
  engineer: "Engineering Operations",
  pm: "Project Management",
  qm: "Quality Management",
  program_manager: "Program Management",
  finance: "Finance & Commercial",
  default: "Operations Overview",
};

interface TaskSummary {
  total: number;
  overdue: number;
  blocked: number;
  inProgress: number;
  todo: number;
  review: number;
  complete: number;
}

interface ProjectSummary {
  name: string;
  phase?: string;
  ragStatus?: string;
  progress?: number;
}

function normalizeTaskStatus(s: string): string {
  const v = (s || "").toLowerCase().trim();
  if (["done", "complete", "completed", "closed", "finished", "resolved", "pass"].includes(v)) return "complete";
  if (["in progress", "in_progress", "active", "pending", "started", "wip"].includes(v)) return "in_progress";
  if (["blocked", "on hold", "on_hold", "waiting"].includes(v)) return "blocked";
  if (["review", "in review", "in_review", "qa_review", "needs review"].includes(v)) return "review";
  if (["cancelled", "canceled", "archived", "removed"].includes(v)) return "cancelled";
  return "todo";
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Green: "bg-emerald-500", Amber: "bg-amber-500", Red: "bg-red-500",
    green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500",
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status] || "bg-slate-300"}`} />;
}

function KpiCard({ label, value, icon: Icon, color, subtitle }: {
  label: string; value: string | number; icon: any; color: string; subtitle?: string;
}) {
  return (
    <Card data-testid={`kpi-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AttentionItem({ title, subtitle, urgency, link }: {
  title: string; subtitle: string; urgency: "overdue" | "blocked" | "pending"; link?: string;
}) {
  const styles = {
    overdue: "border-l-red-500 bg-red-50/50",
    blocked: "border-l-amber-500 bg-amber-50/50",
    pending: "border-l-blue-500 bg-blue-50/50",
  };
  const icons = { overdue: AlertTriangle, blocked: AlertCircle, pending: Clock };
  const Icon = icons[urgency];
  const content = (
    <div className={`flex items-center gap-3 p-3 rounded-lg border-l-4 ${styles[urgency]} hover:shadow-sm transition-shadow`}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
  return link ? <Link href={link} data-testid={`attention-item-${urgency}`}>{content}</Link> : <div data-testid={`attention-item-${urgency}`}>{content}</div>;
}

function StatusBreakdownBar({ summary }: { summary: TaskSummary }) {
  const total = summary.total || 1;
  const segments = [
    { key: "complete", count: summary.complete, color: "bg-emerald-500", label: "Complete" },
    { key: "inProgress", count: summary.inProgress, color: "bg-blue-500", label: "In Progress" },
    { key: "review", count: summary.review, color: "bg-amber-500", label: "Review" },
    { key: "todo", count: summary.todo, color: "bg-slate-400", label: "To Do" },
    { key: "blocked", count: summary.blocked, color: "bg-red-500", label: "Blocked" },
  ].filter(s => s.count > 0);

  return (
    <div className="space-y-2" data-testid="status-breakdown">
      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
        {segments.map(s => (
          <div key={s.key} className={`${s.color} transition-all`} style={{ width: `${(s.count / total) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${s.color}`} />
            {s.label}: {s.count}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommandCenterPage() {
  const { user } = useAuth();
  const roleGroup = getRoleGroup(user?.role || "");

  const { data: allTaskData, isLoading: tasksLoading } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  const { data: projectsData, isLoading: projectsLoading } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  const { data: financialData } = useQuery<any>({
    queryKey: ["/api/financial-headline"],
  });

  const taskSummary = useMemo<TaskSummary>(() => {
    if (!allTaskData) return { total: 0, overdue: 0, blocked: 0, inProgress: 0, todo: 0, review: 0, complete: 0 };
    const allTasks: any[] = [];
    for (const t of (allTaskData.personal || [])) allTasks.push(t);
    for (const t of (allTaskData.operational || [])) allTasks.push(t);
    for (const t of (allTaskData.trRegister || [])) allTasks.push({ ...t, status: t.status });
    for (const t of (allTaskData.planTasks || [])) allTasks.push(t);
    for (const t of (allTaskData.engineeringTasks || [])) allTasks.push(t);
    for (const t of (allTaskData.qualityTasks || [])) allTasks.push(t);
    for (const t of (allTaskData.deliverables || [])) allTasks.push(t);

    const normalize = (s: string) => {
      const v = (s || "").toLowerCase().trim();
      if (["done", "complete", "completed", "closed", "finished", "resolved", "pass"].includes(v)) return "complete";
      if (["in progress", "in_progress", "active", "pending", "started", "wip"].includes(v)) return "in_progress";
      if (["blocked", "on hold", "on_hold", "waiting"].includes(v)) return "blocked";
      if (["review", "in review", "in_review", "qa_review", "needs review"].includes(v)) return "review";
      if (["cancelled", "canceled", "archived", "removed"].includes(v)) return "cancelled";
      return "todo";
    };

    let overdue = 0, blocked = 0, inProgress = 0, todo = 0, review = 0, complete = 0;
    const now = new Date();
    for (const t of allTasks) {
      const status = normalize(t.status || "todo");
      if (status === "complete" || status === "cancelled") { complete++; continue; }
      if (status === "blocked") { blocked++; continue; }
      if (status === "in_progress") { inProgress++; }
      else if (status === "review") { review++; }
      else { todo++; }
      const due = t.dueAt || t.dueDate || t.due_date || t.endDate || t.end_date;
      if (due) {
        try { if (new Date(due) < now) overdue++; } catch {}
      }
    }
    return { total: allTasks.length, overdue, blocked, inProgress, todo, review, complete };
  }, [allTaskData]);

  const attentionItems = useMemo(() => {
    if (!allTaskData) return [];
    const items: { title: string; subtitle: string; urgency: "overdue" | "blocked" | "pending"; link?: string }[] = [];
    const now = new Date();

    const checkOverdue = (tasks: any[], source: string) => {
      for (const t of (tasks || [])) {
        const due = t.dueAt || t.dueDate || t.due_date || t.endDate || t.end_date;
        const status = (t.status || "").toLowerCase();
        if (due && !["complete", "done", "closed", "cancelled"].includes(status)) {
          try {
            if (new Date(due) < now) {
              items.push({
                title: t.title || t.actionDescription || t.taskName || t.task_name || "Untitled",
                subtitle: `${source} · Overdue`,
                urgency: "overdue",
                link: "/my-work/tasks",
              });
            }
          } catch {}
        }
        if (["blocked", "on hold", "on_hold"].includes(status)) {
          items.push({
            title: t.title || t.actionDescription || "Untitled",
            subtitle: `${source} · Blocked`,
            urgency: "blocked",
            link: "/my-work/tasks",
          });
        }
      }
    };

    checkOverdue(allTaskData.personal || [], "Personal");
    checkOverdue(allTaskData.operational || [], "Project Task");
    checkOverdue(allTaskData.trRegister || [], "Action Item");
    checkOverdue(allTaskData.planTasks || [], "Plan Task");
    checkOverdue(allTaskData.engineeringTasks || [], "Engineering");
    checkOverdue(allTaskData.qualityTasks || [], "Quality");

    const pendingApprovals = [
      ...(allTaskData.approvals?.engineering || []),
      ...(allTaskData.approvals?.quality || []),
    ].filter((a: any) => (a.status || "").toLowerCase() === "pending" || (a.status || "").toLowerCase() === "review");
    for (const a of pendingApprovals.slice(0, 5)) {
      items.push({
        title: a.title || a.stageName || "Pending Approval",
        subtitle: `${a.projectName || "Unknown"} · Awaiting review`,
        urgency: "pending",
        link: "/my-work/approvals",
      });
    }

    items.sort((a, b) => {
      const order = { overdue: 0, blocked: 1, pending: 2 };
      return order[a.urgency] - order[b.urgency];
    });
    return items.slice(0, 10);
  }, [allTaskData]);

  const myProjects = useMemo<ProjectSummary[]>(() => {
    if (!projectsData) return [];
    return (projectsData as any[])
      .filter((p: any) => p.isActive !== false && p.archivedStatus !== "ARCHIVED")
      .map((p: any) => ({
        name: p.projectName || p.project_name,
        phase: p.executionPhase || p.phase,
        ragStatus: p.ragStatus || p.rag_status,
        progress: 0,
      }))
      .slice(0, 12);
  }, [projectsData]);

  const roleKpis = useMemo(() => {
    const kpis: { label: string; value: string | number; icon: any; color: string; subtitle?: string }[] = [];
    kpis.push({ label: "My Tasks", value: taskSummary.total, icon: ListTodo, color: "bg-blue-500", subtitle: `${taskSummary.inProgress} in progress` });
    kpis.push({ label: "Overdue", value: taskSummary.overdue, icon: AlertTriangle, color: taskSummary.overdue > 0 ? "bg-red-500" : "bg-slate-400", subtitle: taskSummary.overdue > 0 ? "Needs attention" : "All on track" });
    kpis.push({ label: "Blocked", value: taskSummary.blocked, icon: AlertCircle, color: taskSummary.blocked > 0 ? "bg-amber-500" : "bg-slate-400" });

    if (roleGroup === "coo_admin" || roleGroup === "program_manager") {
      kpis.push({ label: "Active Projects", value: myProjects.length, icon: FolderOpen, color: "bg-emerald-500" });
      if (allTaskData) {
        const allT: any[] = [...(allTaskData.operational || []), ...(allTaskData.planTasks || []), ...(allTaskData.engineeringTasks || []), ...(allTaskData.qualityTasks || [])];
        const unassignedCount = allT.filter((t: any) => {
          const st = normalizeTaskStatus(t.status || "todo");
          return !t.assignedTo && !t.assigned_to && st !== "complete" && st !== "cancelled";
        }).length;
        if (unassignedCount > 0) {
          kpis.push({ label: "Unassigned", value: unassignedCount, icon: Users, color: "bg-red-500", subtitle: "Needs owner" });
        }
      }
    }
    if (roleGroup === "finance" || roleGroup === "coo_admin") {
      const rev = financialData?.totalRevenue;
      const cos = financialData?.totalCOS;
      if (rev !== undefined) kpis.push({ label: "Revenue", value: `R${(Number(rev) / 1000000).toFixed(1)}M`, icon: TrendingUp, color: "bg-emerald-600" });
      if (cos !== undefined) kpis.push({ label: "COS", value: `R${(Number(cos) / 1000000).toFixed(1)}M`, icon: DollarSign, color: "bg-orange-500" });
    }
    if (roleGroup === "engineer") {
      const engCount = (allTaskData?.engineeringTasks || []).length;
      kpis.push({ label: "Eng Tasks", value: engCount, icon: Wrench, color: "bg-cyan-500" });
    }
    if (roleGroup === "qm") {
      const qcCount = (allTaskData?.qualityTasks || []).length;
      const pendingQc = (allTaskData?.approvals?.quality || []).length;
      kpis.push({ label: "QC Items", value: qcCount, icon: ShieldCheck, color: "bg-rose-500" });
      if (pendingQc > 0) kpis.push({ label: "Pending Reviews", value: pendingQc, icon: FileCheck, color: "bg-amber-500" });
    }
    if (roleGroup === "pm") {
      const opCount = (allTaskData?.operational || []).length;
      kpis.push({ label: "Project Tasks", value: opCount, icon: ClipboardList, color: "bg-violet-500" });
    }
    if (roleGroup === "pd") {
      kpis.push({ label: "Active Projects", value: myProjects.length, icon: Briefcase, color: "bg-indigo-500" });
    }

    return kpis;
  }, [taskSummary, myProjects, financialData, roleGroup, allTaskData]);

  const quickLinks = useMemo(() => {
    const links: { label: string; path: string; icon: any }[] = [];
    links.push({ label: "My Tasks", path: "/my-work/tasks", icon: ListTodo });

    switch (roleGroup) {
      case "coo_admin":
        links.push({ label: "Lifecycle Board", path: "/lifecycle-board", icon: Layers });
        links.push({ label: "Execution Board", path: "/execution-board", icon: Gauge });
        links.push({ label: "Cashflow", path: "/cashflow", icon: Wallet });
        links.push({ label: "Approvals", path: "/my-work/approvals", icon: CheckCircle2 });
        links.push({ label: "Admin", path: "/admin/settings", icon: Target });
        break;
      case "program_manager":
        links.push({ label: "Execution Board", path: "/execution-board", icon: Gauge });
        links.push({ label: "Projects", path: "/projects", icon: FolderOpen });
        links.push({ label: "Portfolios", path: "/portfolios", icon: Layers });
        links.push({ label: "Weekly Reviews", path: "/weekly-reviews", icon: Calendar });
        break;
      case "pm":
        links.push({ label: "PM Dashboard", path: "/pm-dashboard", icon: Gauge });
        links.push({ label: "PM On-the-Go", path: "/pm/on-the-go", icon: Zap });
        links.push({ label: "Projects", path: "/projects", icon: FolderOpen });
        links.push({ label: "Quality", path: "/quality", icon: ShieldCheck });
        break;
      case "engineer":
        links.push({ label: "Engineering", path: "/engineering", icon: Wrench });
        links.push({ label: "Eng Tasks", path: "/engineering/tasks", icon: ClipboardList });
        links.push({ label: "Quality", path: "/quality", icon: ShieldCheck });
        links.push({ label: "Projects", path: "/projects", icon: FolderOpen });
        break;
      case "qm":
        links.push({ label: "Quality Dashboard", path: "/quality", icon: ShieldCheck });
        links.push({ label: "Approvals", path: "/my-work/approvals", icon: CheckCircle2 });
        links.push({ label: "Projects", path: "/projects", icon: FolderOpen });
        break;
      case "finance":
        links.push({ label: "Cashflow", path: "/cashflow", icon: Wallet });
        links.push({ label: "COS Tracker", path: "/cos", icon: TrendingUp });
        links.push({ label: "Revenue", path: "/revenue-tracker", icon: DollarSign });
        links.push({ label: "GP Tracker", path: "/gp-tracker", icon: BarChart3 });
        break;
      case "pd":
        links.push({ label: "PD Dashboard", path: "/pd", icon: Gauge });
        links.push({ label: "PD Tickets", path: "/pd/tickets", icon: ClipboardList });
        links.push({ label: "Clients", path: "/clients", icon: Users });
        links.push({ label: "Projects", path: "/projects", icon: FolderOpen });
        break;
      default:
        links.push({ label: "Projects", path: "/projects", icon: FolderOpen });
        links.push({ label: "Calendar", path: "/my-work/calendar", icon: Calendar });
        links.push({ label: "Approvals", path: "/my-work/approvals", icon: CheckCircle2 });
        break;
    }
    return links;
  }, [roleGroup]);

  const isLoading = tasksLoading || projectsLoading;

  return (
    <PageShell className="p-4 md:p-6" data-testid="command-center-page">
      <SectionHeader
        icon={<Gauge className="h-5 w-5" />}
        title="Command Center"
        description={`${ROLE_GROUP_LABELS[roleGroup]} · ${user?.name || "User"}`}
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <KPIStrip className="grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="kpi-cards-section">
            {roleKpis.map((kpi, i) => (
              <KpiCard key={i} {...kpi} />
            ))}
          </KPIStrip>

          {attentionItems.length > 0 && (
            <Card data-testid="attention-section">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  What Needs Your Attention
                  <Badge variant="secondary" className="ml-auto">{attentionItems.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {attentionItems.map((item, i) => (
                    <AttentionItem key={i} {...item} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <Card data-testid="task-status-section">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ListTodo className="h-4 w-4" />
                    My Tasks
                  </CardTitle>
                  <Link href="/my-work/tasks">
                    <Button variant="ghost" size="sm" className="text-xs" data-testid="link-view-all-tasks">
                      View All <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <StatusBreakdownBar summary={taskSummary} />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{taskSummary.total - taskSummary.complete}</p>
                    <p className="text-xs text-muted-foreground">Open Tasks</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{taskSummary.complete}</p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="projects-section">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Projects
                  </CardTitle>
                  <Link href="/projects">
                    <Button variant="ghost" size="sm" className="text-xs" data-testid="link-view-all-projects">
                      View All <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {myProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No active projects</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {myProjects.map((p, i) => (
                      <Link key={i} href={`/project/${encodeURIComponent(p.name)}`}>
                        <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`project-row-${i}`}>
                          <StatusDot status={p.ragStatus || ""} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.name}</p>
                            {p.phase && <p className="text-xs text-muted-foreground">{p.phase}</p>}
                          </div>
                          {p.ragStatus && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              {p.ragStatus}
                            </Badge>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card data-testid="quick-links-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Quick Access
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {quickLinks.map((link, i) => (
                  <Link key={i} href={link.path}>
                    <div className="flex flex-col items-center gap-2 p-3 rounded-lg border hover:bg-muted/50 hover:border-primary/30 transition-all cursor-pointer text-center" data-testid={`quick-link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <link.icon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs font-medium">{link.label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}

import { useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell, SectionHeader, KPIStrip } from "@/components/layout/page-shell";
import { deriveProjectOperationalStatus } from "@/lib/project-operational-status";
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

interface ApprovalSummaryItem {
  title: string;
  projectName: string;
  status: string;
  ageDays: number;
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
  const roleGroup: RoleGroup = "coo_admin";
  const isMobile = useIsMobile();

  const { data: allTaskData, isLoading: tasksLoading, dataUpdatedAt: tasksUpdatedAt } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  const { data: projectsData, isLoading: projectsLoading, dataUpdatedAt: projectsUpdatedAt } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  const { data: financialData, dataUpdatedAt: financialUpdatedAt } = useQuery<any>({
    queryKey: ["/api/financial-headline"],
  });

  const { data: handoverControlData } = useQuery<{ items: any[] }>({
    queryKey: ["/api/pd-pm-handover/control"],
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

  const approvalQueue = useMemo(() => {
    const pending = [
      ...(allTaskData?.approvals?.engineering || []),
      ...(allTaskData?.approvals?.quality || []),
    ].filter((a: any) => {
      const status = (a.status || "").toLowerCase();
      return status === "pending" || status === "review";
    });

    const parseAgeDays = (value: any) => {
      if (!value) return 0;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return 0;
      return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
    };

    const queue: ApprovalSummaryItem[] = pending.map((a: any) => ({
      title: a.title || a.stageName || "Pending Approval",
      projectName: a.projectName || a.project || "Unknown Project",
      status: a.status || "Pending",
      ageDays: parseAgeDays(a.updatedAt || a.updated_at || a.createdAt || a.created_at || a.requestedAt || a.requested_at),
    }));

    const overdue = queue.filter((item) => item.ageDays >= 3).length;
    return {
      totalPending: queue.length,
      overdue,
      items: queue.sort((a, b) => b.ageDays - a.ageDays).slice(0, 6),
    };
  }, [allTaskData]);

  const riskHotspots = useMemo(() => {
    const redProjects = myProjects.filter((p) => (p.ragStatus || "").toLowerCase() === "red");
    const amberProjects = myProjects.filter((p) => (p.ragStatus || "").toLowerCase() === "amber");
    const greenProjects = myProjects.filter((p) => (p.ragStatus || "").toLowerCase() === "green");

    const engineeringBlocked = (allTaskData?.engineeringTasks || []).filter((t: any) => normalizeTaskStatus(t.status || "") === "blocked").length;
    const qualityBlocked = (allTaskData?.qualityTasks || []).filter((t: any) => normalizeTaskStatus(t.status || "") === "blocked").length;
    const operationalBlocked = (allTaskData?.operational || []).filter((t: any) => normalizeTaskStatus(t.status || "") === "blocked").length;

    return {
      redProjects,
      amberProjects,
      greenProjects,
      engineeringBlocked,
      qualityBlocked,
      operationalBlocked,
    };
  }, [myProjects, allTaskData]);

  const executiveSignals = useMemo(() => {
    return [
      {
        label: "Immediate Exceptions",
        value: taskSummary.overdue + taskSummary.blocked,
        subtitle: `${taskSummary.overdue} overdue · ${taskSummary.blocked} blocked`,
        icon: AlertTriangle,
        tone: taskSummary.overdue + taskSummary.blocked > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50",
        href: "/my-work/tasks",
      },
      {
        label: "Projects At Risk",
        value: riskHotspots.redProjects.length + riskHotspots.amberProjects.length,
        subtitle: `${riskHotspots.redProjects.length} red · ${riskHotspots.amberProjects.length} amber`,
        icon: FolderOpen,
        tone: riskHotspots.redProjects.length > 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50",
        href: "/projects",
      },
      {
        label: "Overdue Approvals",
        value: approvalQueue.overdue,
        subtitle: `${approvalQueue.totalPending} pending decisions`,
        icon: FileCheck,
        tone: approvalQueue.overdue > 0 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50",
        href: "/my-work/approvals",
      },
      {
        label: "Open Workload",
        value: taskSummary.total - taskSummary.complete,
        subtitle: `${taskSummary.inProgress} in progress · ${taskSummary.review} in review`,
        icon: ListTodo,
        tone: "border-slate-200 bg-slate-50",
        href: "/my-work/tasks",
      },
    ];
  }, [approvalQueue, riskHotspots, taskSummary]);

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
    return [
      { label: "Lifecycle Board", path: "/lifecycle-board", icon: Layers },
      { label: "Project Management", path: "/projects", icon: FolderOpen },
      { label: "Finance", path: "/cashflow", icon: Wallet },
      { label: "Admin", path: "/admin/control-center", icon: Target },
      { label: "Approvals", path: "/my-work/approvals", icon: CheckCircle2 },
      { label: "Imports", path: "/smart-import", icon: FileCheck },
      { label: "Knowledge", path: "/training", icon: Users },
    ];
  }, []);

  const operationalProjects = useMemo(() => (projectsData || []).map((p: any) => ({ ...p, ...deriveProjectOperationalStatus(p) })), [projectsData]);

  const exceptionStrip = useMemo(() => {
    const handovers = handoverControlData?.items || [];
    return [
      { label: "Overdue PD→PM handovers", count: handovers.filter((h) => h.handover_status === "SUBMITTED_FOR_PM_REVIEW" && (h.days_in_status || 0) > 5).length, owner: "PM", action: "Review handovers", link: "/handover-control" },
      { label: "Accepted with no tracker", count: handovers.filter((h) => h.handover_status === "ACCEPTED" && !h.tracker_linked).length, owner: "PM", action: "Link tracker", link: "/handover-control" },
      { label: "Projects with no PM", count: operationalProjects.filter((p: any) => !p.pm).length, owner: "Operations", action: "Assign PM", link: "/projects" },
      { label: "Overdue approvals", count: approvalQueue.overdue, owner: "Approvers", action: "Process approvals", link: "/my-work/approvals" },
      { label: "Blocked engineering", count: riskHotspots.engineeringBlocked, owner: "Engineering", action: "Remove blockers", link: "/engineering/tasks" },
      { label: "Blocked quality", count: riskHotspots.qualityBlocked, owner: "Quality", action: "Resolve QC blockers", link: "/quality" },
      { label: "Procurement blockers", count: (allTaskData?.operational || []).filter((t: any) => String(t.department || '').toLowerCase().includes('procurement') && normalizeTaskStatus(t.status) === 'blocked').length, owner: "Procurement", action: "Unblock procurement", link: "/subcontractor-dashboard" },
    ].filter((x) => x.count > 0);
  }, [handoverControlData, operationalProjects, approvalQueue.overdue, riskHotspots, allTaskData]);

  const departmentCards = useMemo(() => {
    const handovers = handoverControlData?.items || [];
    return {
      executive: { active: operationalProjects.length, blocked: taskSummary.blocked, overdue: taskSummary.overdue, waiting: approvalQueue.totalPending, queue: "Resolve exception strip first" },
      pd: { active: handovers.length, blocked: handovers.filter((h) => h.handover_status === 'REJECTED').length, overdue: handovers.filter((h) => h.handover_status === 'SUBMITTED_FOR_PM_REVIEW' && (h.days_in_status || 0) > 5).length, waiting: handovers.filter((h) => h.handover_status === 'SUBMITTED_FOR_PM_REVIEW').length, queue: "Submit complete handovers" },
      engineering: { active: (allTaskData?.engineeringTasks || []).length, blocked: riskHotspots.engineeringBlocked, overdue: (allTaskData?.engineeringTasks || []).filter((t: any) => normalizeTaskStatus(t.status) !== 'complete' && t.dueDate && new Date(t.dueDate) < new Date()).length, waiting: (allTaskData?.engineeringTasks || []).filter((t: any) => normalizeTaskStatus(t.status) === 'review').length, queue: "Clear blocked and review queue" },
      quality: { active: (allTaskData?.qualityTasks || []).length, blocked: riskHotspots.qualityBlocked, overdue: 0, waiting: (allTaskData?.approvals?.quality || []).length, queue: "Process pending inspections" },
      pm: { active: (allTaskData?.operational || []).length, blocked: riskHotspots.operationalBlocked, overdue: taskSummary.overdue, waiting: handovers.filter((h) => h.handover_status === 'ACCEPTED' && !h.tracker_linked).length, queue: "Enable tracker-linked execution" },
      finance: { active: Number(financialData?.projectCount || 0), blocked: 0, overdue: approvalQueue.overdue, waiting: Number(financialData?.pendingInvoices || 0), queue: "Close overdue approvals and procurement constraints" },
    } as Record<string, any>;
  }, [handoverControlData, operationalProjects, taskSummary, approvalQueue, allTaskData, riskHotspots, financialData]);

  const isLoading = tasksLoading || projectsLoading;

  const primaryActions = useMemo(() => {
    const actions = [
      {
        label: "Resolve Exceptions",
        helper: taskSummary.overdue + taskSummary.blocked > 0
          ? `${taskSummary.overdue + taskSummary.blocked} open exceptions`
          : "No open exceptions",
        path: "/my-work/tasks",
        icon: AlertTriangle,
        tone: taskSummary.overdue + taskSummary.blocked > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600",
        urgent: taskSummary.overdue + taskSummary.blocked > 0,
      },
      {
        label: "Process Approvals",
        helper: approvalQueue.totalPending > 0
          ? `${approvalQueue.totalPending} waiting decisions`
          : "Approval queue is clear",
        path: "/my-work/approvals",
        icon: FileCheck,
        tone: approvalQueue.totalPending > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600",
        urgent: approvalQueue.overdue > 0,
      },
      {
        label: "Review Risk Projects",
        helper: riskHotspots.redProjects.length + riskHotspots.amberProjects.length > 0
          ? `${riskHotspots.redProjects.length} red · ${riskHotspots.amberProjects.length} amber`
          : "Portfolio risk low",
        path: "/projects",
        icon: FolderOpen,
        tone: riskHotspots.redProjects.length > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700",
        urgent: riskHotspots.redProjects.length > 0,
      },
    ];

    return actions;
  }, [approvalQueue, riskHotspots, taskSummary]);

  const freshnessLabel = useMemo(() => {
    const latest = Math.max(tasksUpdatedAt || 0, projectsUpdatedAt || 0, financialUpdatedAt || 0);
    if (!latest) return "Waiting for live data";
    const minutes = Math.floor((Date.now() - latest) / 60000);
    if (minutes <= 0) return "Live data synced just now";
    if (minutes === 1) return "Live data synced 1 minute ago";
    return `Live data synced ${minutes} minutes ago`;
  }, [financialUpdatedAt, projectsUpdatedAt, tasksUpdatedAt]);


  const mobilePrimaryActions = [
    { label: "Approvals", path: "/my-work/approvals", icon: CheckCircle2 },
    { label: "Update Tasks", path: "/my-work/tasks", icon: ListTodo },
    { label: "Upload / Send", path: "/smart-import", icon: FolderOpen },
    { label: "Escalate", path: "/feedback", icon: AlertTriangle },
    { label: "Create from Microsoft", path: "/pd/tickets/create", icon: ClipboardList },
  ];

  return (
    <PageShell className="p-4 md:p-6" data-testid="command-center-page">
      <SectionHeader
        icon={<Gauge className="h-5 w-5" />}
        title="Command Center"
        description={`${ROLE_GROUP_LABELS[roleGroup]} · ${user?.name || "User"}`}
      />

      <div className="-mt-2 mb-3 flex items-center gap-2">
        <CircleDot className="h-3.5 w-3.5 text-emerald-600" />
        <p className="text-xs text-muted-foreground" data-testid="command-center-data-freshness">{freshnessLabel}</p>
      </div>

      <Card className="mb-4" data-testid="exception-first-strip">
        <CardHeader className="pb-2"><CardTitle className="text-base">Exception First</CardTitle></CardHeader>
        <CardContent>
          {exceptionStrip.length === 0 ? <p className="text-sm text-muted-foreground">No cross-department exceptions right now.</p> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {exceptionStrip.map((item) => (
                <Link key={item.label} href={item.link}><div className="rounded border border-red-200 bg-red-50 p-2"><p className="text-xs font-semibold">{item.label}: {item.count}</p><p className="text-[11px] text-muted-foreground">Owner: {item.owner} · Next: {item.action}</p></div></Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="executive" className="mb-4" data-testid="department-command-tabs">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="executive">Company / Executive</TabsTrigger><TabsTrigger value="pd">Project Development</TabsTrigger><TabsTrigger value="engineering">Engineering</TabsTrigger><TabsTrigger value="quality">Quality</TabsTrigger><TabsTrigger value="pm">Project Management</TabsTrigger><TabsTrigger value="finance">Finance / Procurement</TabsTrigger>
        </TabsList>
        {Object.entries(departmentCards).map(([key, v]) => (
          <TabsContent key={key} value={key}><Card><CardContent className="p-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs"><div><p className="text-muted-foreground">Active</p><p className="font-semibold">{(v as any).active}</p></div><div><p className="text-muted-foreground">Blocked</p><p className="font-semibold">{(v as any).blocked}</p></div><div><p className="text-muted-foreground">Overdue</p><p className="font-semibold">{(v as any).overdue}</p></div><div><p className="text-muted-foreground">Waiting on dept</p><p className="font-semibold">{(v as any).waiting}</p></div><div><p className="text-muted-foreground">Next action queue</p><p className="font-semibold">{(v as any).queue}</p></div></CardContent></Card></TabsContent>
        ))}
      </Tabs>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          {isMobile && (
            <Card data-testid="mobile-action-first-section">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4 text-green-600" />
                  Action First
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {mobilePrimaryActions.map((action) => (
                    <Link key={action.path} href={action.path}>
                      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                        <action.icon className="h-4 w-4" />
                        <span>{action.label}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3" data-testid="executive-signals">
            {executiveSignals.map((signal) => (
              <Link key={signal.label} href={signal.href}>
                <Card className={`border ${signal.tone} hover:shadow-sm transition-shadow`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{signal.label}</p>
                        <p className="text-2xl font-bold leading-tight">{signal.value}</p>
                        <p className="text-xs text-muted-foreground mt-1">{signal.subtitle}</p>
                      </div>
                      <signal.icon className="h-4 w-4 text-green-700" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <Card data-testid="primary-actions-section">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-green-600" />
                  Primary Actions
                </CardTitle>
                <Badge variant="outline">One-click execution</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {primaryActions.map((action) => (
                  <Link key={action.path} href={action.path}>
                    <div className={`rounded-lg border px-3 py-3 transition-all hover:shadow-sm ${action.tone}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <action.icon className="h-4 w-4" />
                          <p className="text-sm font-semibold">{action.label}</p>
                        </div>
                        {action.urgent && <Badge variant="destructive">Now</Badge>}
                      </div>
                      <p className="mt-1 text-xs opacity-80">{action.helper}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7 space-y-6">
              <Card data-testid="attention-section">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Immediate Attention Queue
                    </CardTitle>
                    <Badge variant="secondary">{attentionItems.length}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {attentionItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No urgent exceptions currently open.</p>
                  ) : (
                    <div className="space-y-2 max-h-[360px] overflow-y-auto">
                      {attentionItems.map((item, i) => (
                        <AttentionItem key={i} {...item} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="approvals-command-section">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileCheck className="h-4 w-4 text-green-600" />
                      Approval Command Queue
                    </CardTitle>
                    <Link href="/my-work/approvals">
                      <Button variant="ghost" size="sm" className="text-xs">Open Approvals <ArrowRight className="h-3 w-3 ml-1" /></Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Pending approvals</p>
                      <p className="text-xl font-semibold">{approvalQueue.totalPending}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Overdue (&gt;= 3 days)</p>
                      <p className="text-xl font-semibold">{approvalQueue.overdue}</p>
                    </div>
                  </div>
                  {approvalQueue.items.length > 0 ? (
                    <div className="space-y-2">
                      {approvalQueue.items.map((item, idx) => (
                        <div key={`${item.title}-${idx}`} className="flex items-center gap-3 rounded-lg border p-2.5">
                          <Clock className="h-4 w-4 text-amber-500" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{item.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{item.projectName} · {item.status}</p>
                          </div>
                          <Badge variant={item.ageDays >= 3 ? "destructive" : "outline"}>{item.ageDays}d</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No approvals waiting for decision.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="xl:col-span-5 space-y-6">
              <Card data-testid="risk-hotspots-section">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-green-600" />
                      Risk Hotspots
                    </CardTitle>
                    <Link href="/projects"><Button variant="ghost" size="sm" className="text-xs">View Projects <ArrowRight className="h-3 w-3 ml-1" /></Button></Link>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Red</p>
                      <p className="text-xl font-semibold">{riskHotspots.redProjects.length}</p>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Amber</p>
                      <p className="text-xl font-semibold">{riskHotspots.amberProjects.length}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Green</p>
                      <p className="text-xl font-semibold">{riskHotspots.greenProjects.length}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {riskHotspots.redProjects.slice(0, 4).map((p, i) => (
                      <Link key={`${p.name}-${i}`} href={`/project/${encodeURIComponent(p.name)}`}>
                        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/60 p-2.5">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.phase || "No phase set"}</p>
                          </div>
                          <Badge variant="destructive">Red</Badge>
                        </div>
                      </Link>
                    ))}
                    {riskHotspots.redProjects.length === 0 && (
                      <p className="text-sm text-muted-foreground">No red projects right now.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="portfolio-health-section">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-green-600" />
                    Portfolio & Delivery Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <StatusBreakdownBar summary={taskSummary} />
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg border bg-muted/40 p-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Engineering blocked</p>
                      <p className="text-lg font-semibold">{riskHotspots.engineeringBlocked}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Quality blocked</p>
                      <p className="text-lg font-semibold">{riskHotspots.qualityBlocked}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Ops blocked</p>
                      <p className="text-lg font-semibold">{riskHotspots.operationalBlocked}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <KPIStrip className="grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="kpi-cards-section">
            {(isMobile ? roleKpis.slice(0, 4) : roleKpis).map((kpi, i) => (
              <KpiCard key={i} {...kpi} />
            ))}
          </KPIStrip>

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

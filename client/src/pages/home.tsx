import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FileSpreadsheet,
  Wallet,
  TrendingUp,
  Target,
  BarChart3,
  Kanban,
  AlertTriangle,
  Settings,
  ArrowRight,
  Flag,
  Loader2,
  ShieldCheck,
  Wrench,
  ListTodo,
  Package,
  Briefcase,
} from "lucide-react";

interface CompanyPriority {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  horizon: string;
  ownerRole: string | null;
  linkedProjectName: string | null;
  severity: string;
  status: string;
  priorityRank: number | null;
  assignedTo: string | null;
  nextAction: string | null;
  support: string[] | null;
  definitionOfDone: string | null;
  dueDate: string | null;
  linkedTaskId: number | null;
  linkedTaskType: string | null;
}

interface QuickLink {
  label: string;
  description: string;
  icon: any;
  path: string;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  not_started: { label: "Not started", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  in_progress: { label: "In progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  complete: { label: "Complete", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  monitoring: { label: "Monitoring", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

const deptColors: Record<string, string> = {
  Accounts: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  "Project Development": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  "Project Management": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  Operations: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  Engineering: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  Finance: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
};

function CompanyPrioritiesCard({ isAdmin }: { isAdmin: boolean }) {
  const { data: priorities = [], isLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  const active = priorities.filter(p => !["closed", "complete"].includes(p.status));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (active.length === 0 && !isAdmin) return null;

  return (
    <Card data-testid="company-priorities-section">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold">Company Priorities</h3>
            <span className="text-xs text-muted-foreground">{active.length} active</span>
          </div>
          {isAdmin && (
            <Link href="/my-tool/priorities">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-manage-priorities">
                Manage <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>

        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4 px-4">No active priorities.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-y bg-muted/20">
                  <th className="text-left px-3 py-1.5 w-28">Dept</th>
                  <th className="text-left px-3 py-1.5">Priority</th>
                  <th className="text-left px-3 py-1.5 w-24">Status</th>
                  <th className="text-left px-3 py-1.5 w-28 hidden md:table-cell">Assigned</th>
                  <th className="text-left px-3 py-1.5 hidden lg:table-cell">Next Action</th>
                </tr>
              </thead>
              <tbody>
                {active.sort((a, b) => (a.priorityRank ?? 999) - (b.priorityRank ?? 999)).map((p) => {
                  const stat = statusLabels[p.status] || statusLabels.active;
                  const dept = p.department || "—";
                  const dc = deptColors[dept] || "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/5" data-testid={`priority-row-${p.id}`}>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${dc}`}>
                          {dept.length > 14 ? dept.slice(0, 12) + "…" : dept}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-sm font-medium" data-testid={`text-priority-title-${p.id}`}>{p.title}</span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${stat.color}`}>{stat.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">{p.assignedTo || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px] hidden lg:table-cell">{p.nextAction || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickNav({ links }: { links: QuickLink[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {links.map(link => (
        <Link key={link.path} href={link.path} data-testid={`tile-${link.label.toLowerCase().replace(/\s+/g, '-')}`}>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer group">
            <link.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{link.label}</p>
              <p className="text-[11px] text-muted-foreground truncate">{link.description}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function Home() {
  const { user, isAdmin, isQm } = useAuth();
  const isEpm = user?.role === "eng_program_manager";

  const adminLinks: QuickLink[] = [
    { label: "Dashboard", description: "Overview & alerts", icon: LayoutDashboard, path: "/dashboard" },
    { label: "Projects", description: "All project summaries", icon: FileSpreadsheet, path: "/projects" },
    { label: "Eng Dashboard", description: "Engineering workload", icon: Wrench, path: "/engineering" },
    { label: "Task Board", description: "Engineering tasks", icon: ListTodo, path: "/engineering/tasks" },
    { label: "Cashflow", description: "Inflow/outflow tracking", icon: Wallet, path: "/cashflow" },
    { label: "COS Tracker", description: "Cost of sales", icon: TrendingUp, path: "/cos" },
    { label: "Planning", description: "Capacity & scheduling", icon: Kanban, path: "/planning" },
    { label: "Quality", description: "QM dashboard", icon: ShieldCheck, path: "/quality" },
    { label: "My Tool", description: "Personal workspace", icon: Briefcase, path: "/my-tool" },
    { label: "Reports", description: "Admin reports", icon: Settings, path: "/admin/reports" },
  ];

  const epmLinks: QuickLink[] = [
    { label: "Projects", description: "All project summaries", icon: FileSpreadsheet, path: "/projects" },
    { label: "Eng Dashboard", description: "Engineering workload", icon: Wrench, path: "/engineering" },
    { label: "Task Board", description: "Engineering tasks", icon: ListTodo, path: "/engineering/tasks" },
    { label: "Deliverables", description: "Versions & approvals", icon: Package, path: "/engineering/deliverables" },
    { label: "Quality", description: "QM dashboard", icon: ShieldCheck, path: "/quality" },
  ];

  const qmLinks: QuickLink[] = [
    { label: "Quality Dashboard", description: "Warnings & completion", icon: ShieldCheck, path: "/quality" },
    { label: "Projects", description: "View project checklists", icon: FileSpreadsheet, path: "/projects" },
  ];

  const viewerLinks: QuickLink[] = [
    { label: "Dashboard", description: "Overview & alerts", icon: LayoutDashboard, path: "/dashboard" },
    { label: "Projects", description: "All project summaries", icon: FileSpreadsheet, path: "/projects" },
    { label: "Cashflow", description: "Inflow/outflow tracking", icon: Wallet, path: "/cashflow" },
    { label: "COS Tracker", description: "Cost of sales", icon: TrendingUp, path: "/cos" },
  ];

  let links = adminLinks;
  let greeting = "Emergent Energy Dashboard";
  if (isQm) {
    links = qmLinks;
    greeting = "Quality Management";
  } else if (isEpm) {
    links = epmLinks;
    greeting = "Engineering Program Management";
  } else if (!isAdmin) {
    links = viewerLinks;
  }

  return (
    <div className="space-y-5" data-testid="home-page">
      <div>
        <h1 className="text-2xl font-bold">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Welcome back, {user?.name?.split(" ")[0] || "User"}</p>
      </div>

      <CompanyPrioritiesCard isAdmin={isAdmin} />

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Quick Access</h2>
        <QuickNav links={links} />
      </div>
    </div>
  );
}

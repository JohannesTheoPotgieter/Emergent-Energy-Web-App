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
  Settings,
  ArrowRight,
  Flag,
  Loader2,
  ShieldCheck,
  Wrench,
  ListTodo,
  Package,
  Users,
  Briefcase,
  FileBarChart,
  History,
  Upload,
} from "lucide-react";

interface QuickLink {
  label: string;
  description: string;
  icon: any;
  path: string;
  color: string;
  bg: string;
}

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

const excoLinks: QuickLink[] = [
  {
    label: "Dashboard",
    description: "High-priority actions, milestones, and PM summary",
    icon: LayoutDashboard,
    path: "/dashboard",
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 hover:border-blue-400",
  },
  {
    label: "My Tool",
    description: "Personal execution cockpit with tasks and time blocks",
    icon: Briefcase,
    path: "/my-tool",
    color: "text-slate-600",
    bg: "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800 hover:border-slate-400",
  },
];

const pmLinks: QuickLink[] = [
  {
    label: "Project Summary",
    description: "All projects with progress, financials, and status",
    icon: FileSpreadsheet,
    path: "/projects",
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400",
  },
  {
    label: "Cashflow",
    description: "Weekly cashflow with inflow/outflow detail and forecast",
    icon: Wallet,
    path: "/cashflow",
    color: "text-violet-600",
    bg: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 hover:border-violet-400",
  },
  {
    label: "COS Tracker",
    description: "Monthly cost of sales: planned vs realised vs budget",
    icon: TrendingUp,
    path: "/cos",
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:border-amber-400",
  },
];

const engLinks: QuickLink[] = [
  {
    label: "Engineering Dashboard",
    description: "Workload, milestones at risk, pipeline, warnings",
    icon: Wrench,
    path: "/engineering",
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 hover:border-orange-400",
  },
  {
    label: "Task Board",
    description: "Manage engineering tasks across all projects",
    icon: ListTodo,
    path: "/engineering/tasks",
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 hover:border-blue-400",
  },
  {
    label: "Deliverables Register",
    description: "Track deliverables, versions, and approvals",
    icon: Package,
    path: "/engineering/deliverables",
    color: "text-indigo-600",
    bg: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 hover:border-indigo-400",
  },
];

const qualityLinks: QuickLink[] = [
  {
    label: "Quality Dashboard",
    description: "Overview of quality status, warnings, and project completion",
    icon: ShieldCheck,
    path: "/quality",
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400",
  },
];

const adminLinks: QuickLink[] = [
  {
    label: "Reports",
    description: "Operational overview and project RAG reports",
    icon: FileBarChart,
    path: "/admin/reports",
    color: "text-purple-600",
    bg: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 hover:border-purple-400",
  },
  {
    label: "Audit Log",
    description: "Task changes, phase transitions, and activity history",
    icon: History,
    path: "/admin/audit-log",
    color: "text-slate-600",
    bg: "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800 hover:border-slate-400",
  },
  {
    label: "Teams & Roles",
    description: "Manage users, roles, and team assignments",
    icon: Users,
    path: "/admin/teams",
    color: "text-cyan-600",
    bg: "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800 hover:border-cyan-400",
  },
  {
    label: "Data Import",
    description: "Upload trackers and manage data ingestion",
    icon: Upload,
    path: "/admin",
    color: "text-teal-600",
    bg: "bg-teal-50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800 hover:border-teal-400",
  },
];

function NavTile({ link }: { link: QuickLink }) {
  return (
    <Link href={link.path} data-testid={`tile-${link.label.toLowerCase().replace(/\s+/g, '-')}`}>
      <Card className={`${link.bg} border transition-all duration-200 cursor-pointer hover:shadow-md group h-full`}>
        <CardContent className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className={`p-2.5 rounded-lg bg-white/60 dark:bg-white/10 ${link.color}`}>
              <link.icon className="h-6 w-6" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div>
            <h3 className="font-semibold text-base">{link.label}</h3>
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{link.description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
  not_started: { label: "Not started", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  in_progress: { label: "In progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  complete: { label: "Complete", color: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
  monitoring: { label: "Monitoring", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

const homeDeptColors: Record<string, string> = {
  Accounts: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400",
  "Project Development": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
  "Project Management": "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
  Operations: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400",
  Engineering: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-400",
  Finance: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400",
};

function CompanyPrioritiesSection({ isAdmin }: { isAdmin: boolean }) {
  const { data: priorities = [], isLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  const activePriorities = priorities.filter(p => !["closed", "complete"].includes(p.status));

  const grouped = (() => {
    const groups: Record<string, CompanyPriority[]> = {};
    activePriorities.forEach(p => {
      const dept = p.department || "Unassigned";
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(p);
    });
    Object.values(groups).forEach(items => items.sort((a, b) => (a.priorityRank ?? 999) - (b.priorityRank ?? 999)));
    return Object.keys(groups).sort((a, b) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)).map(d => ({ department: d, items: groups[d] }));
  })();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (activePriorities.length === 0 && !isAdmin) return null;

  return (
    <Card className="border-red-200 dark:border-red-900/50 bg-gradient-to-br from-red-50/50 to-orange-50/30 dark:from-red-950/20 dark:to-orange-950/10" data-testid="company-priorities-section">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/40">
              <Flag className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Company Priorities</h3>
              <p className="text-xs text-muted-foreground">{activePriorities.length} active across {grouped.length} departments</p>
            </div>
          </div>
          {isAdmin && (
            <Link href="/company-priorities">
              <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="button-manage-priorities">
                Manage
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          )}
        </div>

        {activePriorities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 px-4">
            No active company priorities.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-y bg-muted/30">
                  <th className="text-center px-2 py-1.5 w-8">#</th>
                  <th className="text-left px-2 py-1.5 w-28">Department</th>
                  <th className="text-left px-2 py-1.5">Priority</th>
                  <th className="text-left px-2 py-1.5 w-24">Status</th>
                  <th className="text-left px-2 py-1.5 w-28">Assigned to</th>
                  <th className="text-left px-2 py-1.5 hidden lg:table-cell">Next Action</th>
                  <th className="text-left px-2 py-1.5 w-20 hidden md:table-cell">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ department, items }) => (
                  items.map((p, idx) => {
                    const stat = statusLabels[p.status] || statusLabels.active;
                    const deptColor = homeDeptColors[department] || "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
                    return (
                      <tr key={p.id} className="border-b hover:bg-muted/10 transition-colors" data-testid={`priority-row-${p.id}`}>
                        <td className="text-center px-2 py-2 text-xs text-muted-foreground">{p.priorityRank ?? (idx + 1)}</td>
                        <td className="px-2 py-2">
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0.5 ${deptColor} truncate`}>
                            {department.length > 12 ? department.slice(0, 10) + "..." : department}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">
                          <span className="font-medium text-sm" data-testid={`text-priority-title-${p.id}`}>{p.title}</span>
                          {p.linkedProjectName && (
                            <span className="ml-1.5 text-[10px] text-primary">
                              {p.linkedProjectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0.5 ${stat.color}`}>
                            {stat.label}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground truncate">{p.assignedTo || ""}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground truncate hidden lg:table-cell max-w-[200px]">{p.nextAction || ""}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground hidden md:table-cell">{p.dueDate || ""}</td>
                      </tr>
                    );
                  })
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface HomeSection {
  heading: string;
  links: QuickLink[];
  visibleTo?: string[];
  cols?: number;
}

const homeSections: HomeSection[] = [
  {
    heading: "EXCO",
    visibleTo: ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "admin"],
    links: excoLinks,
    cols: 4,
  },
  {
    heading: "PROJECT MANAGEMENT",
    links: pmLinks,
  },
  {
    heading: "ENGINEERING",
    visibleTo: ["COO_ADMIN", "CEO_ADMIN", "CCO", "ENGINEERING_MANAGER", "CONSTRUCTION_MANAGER", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "admin", "eng_program_manager"],
    links: engLinks,
  },
  {
    heading: "QUALITY",
    visibleTo: ["COO_ADMIN", "CEO_ADMIN", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "admin", "quality_manager"],
    links: qualityLinks,
  },
  {
    heading: "ADMIN",
    visibleTo: ["COO_ADMIN", "admin"],
    links: adminLinks,
    cols: 4,
  },
];

export default function Home() {
  const { user, isAdmin } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const role = user?.role;
  const pmCompanyRoles = ["PROGRAM_MANAGER", "CONSTRUCTION_MANAGER", "PROGRAM_FINANCE_MANAGER"];

  const canEdit = isAdmin || (companyRole && ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO"].includes(companyRole));

  const visibleSections = homeSections.filter(section => {
    const cr = companyRole;
    if (cr) {
      if (cr === "COO_ADMIN") return true;
      if (pmCompanyRoles.includes(cr)) {
        return ["PROJECT MANAGEMENT", "ENGINEERING", "QUALITY"].includes(section.heading);
      }
      if (section.visibleTo) return section.visibleTo.includes(cr);
      return true;
    }
    if (role === "quality_manager") {
      return section.heading === "QUALITY" || section.heading === "PROJECT MANAGEMENT";
    }
    if (role === "eng_program_manager") {
      return section.heading === "ENGINEERING" || section.heading === "QUALITY" || section.heading === "PROJECT MANAGEMENT";
    }
    if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return true;
    return section.heading === "PROJECT MANAGEMENT";
  }).map(section => {
    let links = [...section.links];
    if (role === "quality_manager" && section.heading === "PROJECT MANAGEMENT") {
      links = links.filter(l => l.path === "/projects");
    }
    if (role === "eng_program_manager" && section.heading === "PROJECT MANAGEMENT") {
      links = links.filter(l => l.path === "/projects");
    }
    if (companyRole && pmCompanyRoles.includes(companyRole) && section.heading === "ENGINEERING") {
      links = links.filter(l => l.path === "/engineering");
    }
    return { ...section, links };
  }).filter(section => section.links.length > 0);

  return (
    <div className="space-y-8" data-testid="home-page">
      <div>
        <h1 className="text-3xl font-bold">Emergent Energy Dashboard</h1>
        <p className="text-muted-foreground mt-1">Navigate to the section you need below.</p>
      </div>

      <CompanyPrioritiesSection isAdmin={!!canEdit} />

      {visibleSections.map(section => (
        <div key={section.heading}>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">
            {section.heading === "EXCO" ? "Exco" : section.heading === "ADMIN" ? "Admin / Settings" : section.heading.split(" ").map(w => w[0] + w.slice(1).toLowerCase()).join(" ")}
          </h2>
          <div className={`grid gap-4 sm:grid-cols-2 ${section.cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {section.links.map((link) => (
              <NavTile key={link.path} link={link} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { AttentionBadges, type AttentionItem } from "@/components/dashboard/AttentionBadges";
import {
  LayoutDashboard,
  FolderOpen,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Wrench,
  ShieldCheck,
  Briefcase,
  BarChart3,
  Clock,
  Target,
  Zap,
  ArrowRight,
  Flame,
  ClipboardCheck,
  Receipt,
  Shield,
  Truck,
  Building2,
} from "lucide-react";

const token = () => localStorage.getItem("auth_token") || "";
const money = (n: number | null | undefined) =>
  `R ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

type RoleCategory = "executive" | "finance" | "project" | "engineering" | "quality" | "business";

function getRoleCategory(role: string | undefined): RoleCategory {
  if (!role) return "executive";
  const r = role.toUpperCase();
  if (["COO_ADMIN", "CEO_ADMIN", "CCO"].includes(r)) return "executive";
  if (["CFO", "ACCOUNTANT", "PROGRAM_FINANCE_MANAGER"].includes(r)) return "finance";
  if (["PROGRAM_MANAGER", "PROJECT_MANAGER_SITE", "CONSTRUCTION_MANAGER"].includes(r)) return "project";
  if (["ENGINEER", "ENGINEERING_MANAGER"].includes(r)) return "engineering";
  if (["QUALITY_MANAGER"].includes(r)) return "quality";
  if (["PROJECT_DEVELOPER", "KEY_ACCOUNTS_MANAGER"].includes(r)) return "business";
  return "executive";
}

function getRoleLabel(role: string | undefined): string {
  if (!role) return "Team Member";
  const map: Record<string, string> = {
    COO_ADMIN: "Chief Operating Officer",
    CEO_ADMIN: "Chief Executive Officer",
    CCO: "Chief Commercial Officer",
    CFO: "Chief Financial Officer",
    ACCOUNTANT: "Accountant",
    PROGRAM_FINANCE_MANAGER: "Finance Manager",
    PROGRAM_MANAGER: "Program Manager",
    PROJECT_MANAGER_SITE: "Project Manager",
    CONSTRUCTION_MANAGER: "Construction Manager",
    ENGINEER: "Engineer",
    ENGINEERING_MANAGER: "Engineering Manager",
    QUALITY_MANAGER: "Quality Manager",
    PROJECT_DEVELOPER: "Project Developer",
    KEY_ACCOUNTS_MANAGER: "Key Accounts Manager",
  };
  return map[role.toUpperCase()] || "Team Member";
}

const QUOTES: Record<RoleCategory, string[]> = {
  executive: [
    "Leadership is not about being in charge. It's about taking care of those in your charge.",
    "The best way to predict the future is to create it.",
    "Vision without execution is hallucination.",
    "Great leaders don't set out to be a leader — they set out to make a difference.",
    "Strategy is about making choices, trade-offs. It's about deliberately choosing to be different.",
    "The measure of intelligence is the ability to change.",
    "Innovation distinguishes between a leader and a follower.",
    "Energy and persistence conquer all things.",
    "A good plan violently executed now is better than a perfect plan executed next week.",
    "Success usually comes to those who are too busy to be looking for it.",
    "The best leaders are those most interested in surrounding themselves with people smarter than they are.",
    "People buy into the leader before they buy into the vision.",
    "Renewable energy is not just the future — it's the present, and we're building it.",
    "Efficiency is doing things right; effectiveness is doing the right things.",
  ],
  finance: [
    "Cash flow is the lifeblood of every project. Guard it wisely.",
    "Numbers tell stories — make sure yours tells the right one.",
    "Profit is a consequence of doing things well, not the goal.",
    "A budget tells you where your money went. A forecast tells you where it's going.",
    "Revenue is vanity, profit is sanity, cash is reality.",
    "Financial discipline today builds project success tomorrow.",
    "The best investment you can make is in the quality of your data.",
    "Good financial controls don't slow progress — they protect it.",
    "Every rand saved on a project is a rand earned for the next one.",
    "Transparency in finances builds trust with every stakeholder.",
    "Cost overruns are almost always symptoms of deeper project issues.",
    "Accurate forecasting is the bridge between ambition and reality.",
    "In renewable energy, every financial decision is also an environmental one.",
    "Strong margins aren't luck — they're the result of disciplined execution.",
  ],
  project: [
    "A project is complete when it starts working for you, rather than you working for it.",
    "Plans are nothing; planning is everything.",
    "Deliver today what you promised yesterday.",
    "The secret of getting ahead is getting started.",
    "Progress, not perfection, is what we should be asking of ourselves.",
    "Scope creep is the silent killer of project timelines.",
    "Good project management is not about avoiding problems — it's about solving them fast.",
    "Every completed milestone is proof that renewable energy works.",
    "The critical path is only as strong as its weakest dependency.",
    "A well-run site today is a legacy for generations.",
    "Communication is the real work of leadership on site.",
    "Safety first, quality always, and delivery on time.",
    "Every solar panel installed and turbine raised is a step toward a cleaner future.",
    "The best project managers turn constraints into creative solutions.",
  ],
  engineering: [
    "Engineering is the art of directing the great sources of power in nature for the use of man.",
    "First, solve the problem. Then, write the code.",
    "Quality means doing it right when no one is looking.",
    "Good engineering is the difference between a project that works and one that lasts.",
    "Simplicity is the ultimate sophistication in engineering design.",
    "Measure twice, cut once — and document everything.",
    "Great engineers don't just build systems — they build confidence.",
    "Every technical problem has an elegant solution waiting to be found.",
    "Standards exist because someone learned the hard way.",
    "Renewable energy engineering isn't just a career — it's a calling.",
    "The best engineers anticipate problems before they become emergencies.",
    "Precision in engineering is precision in outcome.",
    "Innovation thrives where technical excellence meets practical wisdom.",
    "A well-engineered system speaks for itself — silently, reliably.",
  ],
  quality: [
    "Quality is never an accident; it is always the result of intelligent effort.",
    "Inspection does not improve the quality, nor guarantee quality.",
    "Quality is everyone's responsibility.",
    "The bitterness of poor quality remains long after the sweetness of meeting the schedule.",
    "If you don't have time to do it right, when will you have time to do it over?",
    "Quality in a service or product is not what you put into it. It's what the customer gets out of it.",
    "Continuous improvement is better than delayed perfection.",
    "A culture of quality is a culture of accountability.",
    "Non-conformances aren't failures — they're opportunities to improve.",
    "In renewable energy, quality isn't optional — it's structural.",
    "The cost of prevention is always less than the cost of correction.",
    "Excellence is not a skill. It is an attitude.",
    "Quality assurance is the bridge between design intent and built reality.",
    "Every checklist completed correctly is a guarantee kept.",
  ],
  business: [
    "Opportunities don't happen. You create them.",
    "Your network is your net worth in project development.",
    "Every conversation is a chance to build a partnership.",
    "The best deals are the ones where everyone walks away feeling like they won.",
    "Pipeline today is revenue tomorrow.",
    "Client relationships are the foundation of every successful project.",
    "In renewable energy, every new project is a vote for the future.",
    "The best developers see potential where others see obstacles.",
    "Know your client's problems better than they do.",
    "Strong client relationships aren't built in boardrooms — they're built in follow-through.",
    "A well-qualified lead saves months of wasted effort.",
    "Business development is a marathon, not a sprint.",
    "Today's prospect is tomorrow's partner.",
    "The energy transition is the biggest business opportunity of our generation.",
  ],
};

function getDailyQuote(category: RoleCategory): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  const quotes = QUOTES[category];
  return quotes[dayOfYear % quotes.length];
}

const PRIORITY_SEVERITY_ICONS: Record<string, { icon: any; color: string }> = {
  critical: { icon: Shield, color: "bg-red-100 text-red-700" },
  high: { icon: Target, color: "bg-amber-100 text-amber-700" },
  important: { icon: Target, color: "bg-amber-100 text-amber-700" },
  normal: { icon: TrendingUp, color: "bg-emerald-100 text-emerald-700" },
  low: { icon: Zap, color: "bg-blue-100 text-blue-700" },
};

function QuickLink({
  href,
  icon,
  label,
  description,
  color,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: string;
}) {
  return (
    <Link href={href}>
      <Card
        className="hover:border-primary/30 transition-colors cursor-pointer border-border/50 h-full group"
        data-testid={`link-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <CardContent className="p-3.5 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-md ${color} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

function StatCard({
  value,
  label,
  color,
  loading,
  testId,
}: {
  value: string | number;
  label: string;
  color?: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3.5 text-center">
        {loading ? (
          <Skeleton className="h-7 w-10 mx-auto" />
        ) : (
          <p className={`text-xl font-semibold font-mono ${color || "text-foreground"}`} data-testid={testId}>
            {value}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-1 uppercase tracking-wide">{label}</p>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  icon,
  label,
  value,
  loading,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3.5">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
          {icon}
          <span className="text-[11px] uppercase tracking-wide">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <p className="text-base font-semibold font-mono text-foreground" data-testid={testId}>
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function getQuickLinksForRole(category: RoleCategory) {
  const all = {
    myWork: {
      href: "/my-work",
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
      label: "My Work",
      description: "Your tasks, approvals & calendar",
      color: "bg-emerald-100",
    },
    lifecycle: {
      href: "/project-lifecycle",
      icon: <FolderOpen className="w-5 h-5 text-blue-600" />,
      label: "Project Lifecycle",
      description: "Lifecycle stages & stage gates",
      color: "bg-blue-100",
    },
    pm: {
      href: "/pm-dashboard",
      icon: <Briefcase className="w-5 h-5 text-violet-600" />,
      label: "Project Management",
      description: "Execution overview & controls",
      color: "bg-violet-100",
    },
    engineering: {
      href: "/engineering",
      icon: <Wrench className="w-5 h-5 text-orange-600" />,
      label: "Engineering",
      description: "Engineering overview & tasks",
      color: "bg-orange-100",
    },
    finance: {
      href: "/cashflow",
      icon: <DollarSign className="w-5 h-5 text-teal-600" />,
      label: "Finance",
      description: "Cashflow, COS, revenue & GP",
      color: "bg-teal-100",
    },
    quality: {
      href: "/quality",
      icon: <ShieldCheck className="w-5 h-5 text-indigo-600" />,
      label: "Quality",
      description: "Quality dashboard & checklists",
      color: "bg-indigo-100",
    },
    procurement: {
      href: "/procurement",
      icon: <Truck className="w-5 h-5 text-cyan-600" />,
      label: "Procurement",
      description: "Procurement pipeline & POs",
      color: "bg-cyan-100",
    },
    projects: {
      href: "/projects",
      icon: <Building2 className="w-5 h-5 text-slate-600" />,
      label: "All Projects",
      description: "View full project portfolio",
      color: "bg-slate-100",
    },
    approvals: {
      href: "/approvals",
      icon: <ClipboardCheck className="w-5 h-5 text-violet-600" />,
      label: "Approvals",
      description: "Pending approvals & decisions",
      color: "bg-violet-100",
    },
    invoices: {
      href: "/invoice-capture",
      icon: <Receipt className="w-5 h-5 text-pink-600" />,
      label: "Invoice Capture",
      description: "Record & track invoices",
      color: "bg-pink-100",
    },
  };

  switch (category) {
    case "executive":
      return [all.myWork, all.projects, all.pm, all.finance, all.quality, all.engineering];
    case "finance":
      return [all.myWork, all.finance, all.invoices, all.procurement, all.projects, all.approvals];
    case "project":
      return [all.myWork, all.pm, all.procurement, all.engineering, all.quality, all.finance];
    case "engineering":
      return [all.myWork, all.engineering, all.quality, all.pm, all.projects, all.procurement];
    case "quality":
      return [all.myWork, all.quality, all.engineering, all.pm, all.projects, all.approvals];
    case "business":
      return [all.myWork, all.lifecycle, all.projects, all.pm, all.finance, all.procurement];
    default:
      return [all.myWork, all.projects, all.pm, all.finance, all.engineering, all.quality];
  }
}

function getRoleKpis(
  category: RoleCategory,
  kpis: any,
  stats: any,
  isLoading: boolean
): React.ReactNode {
  switch (category) {
    case "executive":
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            <StatCard value={stats.totalProjects} label="Total Projects" loading={isLoading} testId="text-total-projects" />
            <StatCard value={stats.inConstruction} label="In Construction" color="text-emerald-600" loading={isLoading} testId="text-in-construction" />
            <StatCard value={stats.inCompany} label="In Company" color="text-blue-600" loading={isLoading} testId="text-in-company" />
            <StatCard value={stats.inPipeline} label="Pipeline" color="text-violet-600" loading={isLoading} testId="text-in-pipeline" />
            <StatCard value={stats.greenProjects} label="Green RAG" color="text-emerald-600" loading={isLoading} testId="text-green-projects" />
            <StatCard value={stats.amberProjects} label="Amber RAG" color="text-amber-600" loading={isLoading} testId="text-amber-projects" />
            <StatCard value={stats.redProjects} label="Red RAG" color="text-red-600" loading={isLoading} testId="text-red-projects" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Inflow Received (FY)" value={money(kpis.receivedInflowFy)} loading={isLoading} testId="text-inflow-received" />
            <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Gross Margin" value={kpis.grossMarginPctFy != null ? `${(Number(kpis.grossMarginPctFy) * 100).toFixed(1)}%` : "—"} loading={isLoading} testId="text-gp-pct" />
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Gross Profit (FY)" value={money(kpis.grossProfitFy)} loading={isLoading} testId="text-gross-profit" />
            <KpiCard icon={<Clock className="w-4 h-4" />} label="Behind Plan" value={kpis.projectsBehindPlan ?? "—"} loading={isLoading} testId="text-behind-plan" />
          </div>
        </div>
      );

    case "finance":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Inflow Received (FY)" value={money(kpis.receivedInflowFy)} loading={isLoading} testId="text-inflow-received" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Open Inflow (FY)" value={money(kpis.openInflowFy)} loading={isLoading} testId="text-open-inflow" />
          <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Gross Margin" value={kpis.grossMarginPctFy != null ? `${(Number(kpis.grossMarginPctFy) * 100).toFixed(1)}%` : "—"} loading={isLoading} testId="text-gp-pct" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Gross Profit (FY)" value={money(kpis.grossProfitFy)} loading={isLoading} testId="text-gross-profit" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Planned Revenue (FY)" value={money(kpis.plannedRevenueFy)} loading={isLoading} testId="text-planned-revenue" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Paid Expenditure (FY)" value={money(kpis.paidExpenditureFy)} loading={isLoading} testId="text-paid-expenditure" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Open Expenditure (FY)" value={money(kpis.openExpenditureFy)} loading={isLoading} testId="text-open-expenditure" />
          <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Stale Imports" value={kpis.staleImports ?? "—"} loading={isLoading} testId="text-stale-imports" />
        </div>
      );

    case "project":
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <StatCard value={stats.activeProjects} label="Active Projects" loading={isLoading} testId="text-active-projects" />
            <StatCard value={stats.inConstruction} label="In Construction" color="text-emerald-600" loading={isLoading} testId="text-in-construction" />
            <StatCard value={stats.greenProjects} label="Green RAG" color="text-emerald-600" loading={isLoading} testId="text-green-projects" />
            <StatCard value={stats.amberProjects} label="Amber RAG" color="text-amber-600" loading={isLoading} testId="text-amber-projects" />
            <StatCard value={stats.redProjects} label="Red RAG" color="text-red-600" loading={isLoading} testId="text-red-projects" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Avg Progress" value={kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "—"} loading={isLoading} testId="text-avg-progress" />
            <KpiCard icon={<Clock className="w-4 h-4" />} label="Behind Plan" value={kpis.projectsBehindPlan ?? "—"} loading={isLoading} testId="text-behind-plan" />
            <KpiCard icon={<CheckCircle2 className="w-4 h-4" />} label="Pending Approvals" value={kpis.pendingApprovals ?? "—"} loading={isLoading} testId="text-pending-approvals" />
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Open Expenditure (FY)" value={money(kpis.openExpenditureFy)} loading={isLoading} testId="text-open-expenditure" />
          </div>
        </div>
      );

    case "engineering":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard value={stats.activeProjects} label="Active Projects" loading={isLoading} testId="text-active-projects" />
          <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Avg Progress" value={kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "—"} loading={isLoading} testId="text-avg-progress" />
          <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Eng. Blockers" value={kpis.openEngineeringBlockers ?? "—"} loading={isLoading} testId="text-eng-blockers" />
          <KpiCard icon={<Clock className="w-4 h-4" />} label="Behind Plan" value={kpis.projectsBehindPlan ?? "—"} loading={isLoading} testId="text-behind-plan" />
        </div>
      );

    case "quality":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard value={stats.activeProjects} label="Active Projects" loading={isLoading} testId="text-active-projects" />
          <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Quality Warnings" value={kpis.openQualityWarnings ?? "—"} loading={isLoading} testId="text-quality-warnings" />
          <KpiCard icon={<CheckCircle2 className="w-4 h-4" />} label="Pending Approvals" value={kpis.pendingApprovals ?? "—"} loading={isLoading} testId="text-pending-approvals" />
          <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Avg Progress" value={kpis.averageActualProgressPct != null ? `${Number(kpis.averageActualProgressPct).toFixed(0)}%` : "—"} loading={isLoading} testId="text-avg-progress" />
        </div>
      );

    case "business":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard value={stats.totalProjects} label="Total Projects" loading={isLoading} testId="text-total-projects" />
          <StatCard value={stats.activeProjects} label="Active" loading={isLoading} testId="text-active-projects" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Planned Revenue (FY)" value={money(kpis.plannedRevenueFy)} loading={isLoading} testId="text-planned-revenue" />
          <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Inflow Received (FY)" value={money(kpis.receivedInflowFy)} loading={isLoading} testId="text-inflow-received" />
        </div>
      );

    default:
      return null;
  }
}

export default function HomePage() {
  const { user } = useAuth();

  const { data: summaryData, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: dashData, isLoading: dashLoading } = useQuery<any>({
    queryKey: ["/api/program-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/program-dashboard", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: companyPriorities, isLoading: prioritiesLoading } = useQuery<any[]>({
    queryKey: ["/api/mytool/company-priorities"],
    queryFn: async () => {
      const res = await fetch("/api/mytool/company-priorities", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: myWorkData } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const userRole = (user as any)?.role;
  const roleCategory = getRoleCategory(userRole);
  const roleLabel = getRoleLabel(userRole);

  const stats = useMemo(() => {
    const projects = Array.isArray(summaryData) ? summaryData : summaryData?.projects || [];
    const active = projects.filter((p: any) => p.is_active === true);
    const totalProjects = projects.length;
    const activeProjects = active.length;

    const constructionPhases = new Set(["construction", "qa"]);
    const companyPhases = new Set(["compliance handover", "handover", "financial close", "commercial close out", "dlp"]);

    const getCategory = (phase: string | null | undefined) => {
      const p = (phase || "").toLowerCase().trim();
      if (constructionPhases.has(p)) return "construction";
      if (companyPhases.has(p)) return "company";
      return "pipeline";
    };

    const inConstruction = active.filter((p: any) => getCategory(p.phase) === "construction").length;
    const inCompany = active.filter((p: any) => getCategory(p.phase) === "company").length;
    const inPipeline = active.filter((p: any) => getCategory(p.phase) === "pipeline").length;

    const greenProjects = active.filter((p: any) => p.rag_status === "Green").length;
    const amberProjects = active.filter((p: any) => p.rag_status === "Amber").length;
    const redProjects = active.filter((p: any) => p.rag_status === "Red").length;
    return { totalProjects, activeProjects, inConstruction, inCompany, inPipeline, greenProjects, amberProjects, redProjects };
  }, [summaryData]);

  const kpis = dashData?.kpis || {};
  const isLoading = summaryLoading || dashLoading;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const displayName =
    (user as any)?.name ||
    (user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "User");

  const dailyQuote = useMemo(() => getDailyQuote(roleCategory), [roleCategory]);
  const quickLinks = useMemo(() => getQuickLinksForRole(roleCategory), [roleCategory]);

  const myPendingActions = useMemo(() => {
    if (!myWorkData) return 0;
    const items: any[] = myWorkData.items || myWorkData.tasks || [];
    return items.filter((t: any) => {
      if (!t.dueDate) return false;
      const isOverdue = new Date(t.dueDate) < new Date();
      const isOpen = !["complete", "done", "closed", "cancelled"].includes(
        String(t.status || "").toLowerCase()
      );
      return isOverdue && isOpen;
    }).length;
  }, [myWorkData]);

  const attentionItems = useMemo((): AttentionItem[] => {
    const items: AttentionItem[] = [];
    if (stats.redProjects > 0) items.push({ label: "Red RAG Projects", value: stats.redProjects, color: "text-red-600 bg-red-50 border-red-200", href: "/projects" });
    if (Number(kpis.projectsBehindPlan) > 0) items.push({ label: "Behind Plan", value: Number(kpis.projectsBehindPlan), color: "text-amber-700 bg-amber-50 border-amber-200", href: "/pm-dashboard" });
    if (Number(kpis.pendingApprovals) > 0) items.push({ label: "Pending Approvals", value: Number(kpis.pendingApprovals), color: "text-blue-700 bg-blue-50 border-blue-200", href: "/approvals" });
    if (Number(kpis.openEngineeringBlockers) > 0) items.push({ label: "Eng. Blockers", value: Number(kpis.openEngineeringBlockers), color: "text-violet-700 bg-violet-50 border-violet-200", href: "/engineering" });
    if (Number(kpis.openQualityWarnings) > 0) items.push({ label: "Quality Warnings", value: Number(kpis.openQualityWarnings), color: "text-orange-700 bg-orange-50 border-orange-200", href: "/quality" });
    if (myPendingActions > 0) items.push({ label: "My Overdue Actions", value: myPendingActions, color: "text-rose-700 bg-rose-50 border-rose-200", href: "/my-work/tasks" });
    return items;
  }, [stats, kpis, myPendingActions]);

  return (
    <PageShell data-testid="home-page">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground" data-testid="text-greeting">
              {greeting}, {displayName}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-role-badge">{roleLabel}</p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground/60 italic max-w-xs text-right" data-testid="text-daily-quote">
            <p className="leading-relaxed">{dailyQuote}</p>
          </div>
        </div>
      </div>

      {/* Company Priorities */}
      {(companyPriorities && companyPriorities.length > 0) && (
        <Card className="border-border/60 mb-6" data-testid="card-company-priorities">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Company Priorities</h2>
                <Badge variant="secondary" className="text-[11px]">{companyPriorities.filter((p: any) => p.status === "active" || p.status === "in_progress").length} active</Badge>
              </div>
              <Link href="/project-lifecycle">
                <span className="text-xs text-primary hover:underline font-medium cursor-pointer">Manage</span>
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {companyPriorities.filter((p: any) => p.status === "active" || p.status === "in_progress").slice(0, 6).map((priority: any, i: number) => {
                const sev = PRIORITY_SEVERITY_ICONS[priority.severity] || PRIORITY_SEVERITY_ICONS.normal;
                const Icon = sev.icon;
                return (
                  <Card key={priority.id || i} className="border-border/50 hover:border-primary/20 transition-colors">
                    <CardContent className="p-3 flex items-center gap-3" data-testid={`text-priority-${i}`}>
                      <div className={`w-7 h-7 rounded-md ${sev.color} flex items-center justify-center shrink-0`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground font-medium leading-snug truncate">{priority.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {[priority.department, priority.assignedTo ? `Owner: ${priority.assignedTo}` : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
      {prioritiesLoading && (
        <div>
          <Skeleton className="h-5 w-48 mb-2.5" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </div>
      )}

      {!isLoading && (
        <AttentionBadges items={attentionItems} threshold={5} />
      )}

      <div className="mb-6">
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
          Key Metrics
        </h2>
        {getRoleKpis(roleCategory, kpis, stats, isLoading)}
      </div>

      {/* Quick Access */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
          Quick Access
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {quickLinks.map((link) => (
            <QuickLink key={link.href} {...link} />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

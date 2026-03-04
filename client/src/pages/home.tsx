import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { MetricStrip } from "@/components/ui/metric-strip";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { ROLE_QUICK_ACTIONS } from "@shared/schema";
import { EnergyLoader } from "@/components/ui/energy-loader";
import {
  Flag,
  Loader2,
  ArrowRight,
  AlertTriangle,
  Calendar,
  Target,
  Users,
  ChevronRight,
  ExternalLink,
  BarChart3,
  Wallet,
  ClipboardCheck,
  Layers,
  FileSpreadsheet,
  Settings2,
  Activity,
  TrendingUp,
  ClipboardList,
  FolderOpen,
  ShieldCheck,
  HardHat,
  ListTodo,
  Inbox,
  FolderKanban,
  Briefcase,
  FileEdit,
  Gauge,
  Zap,
  DollarSign,
  Clock,
} from "lucide-react";

const ROLE_COMPLIMENTS: Record<string, string[]> = {
  CEO_ADMIN: [
    "The whole company runs better because of your leadership.",
    "Your vision is turning into reality — one project at a time.",
    "You set the bar and somehow keep raising it.",
    "The way you steer this ship is genuinely impressive.",
    "Your strategic thinking is what keeps us ahead of the game.",
    "Every decision you make moves the company forward.",
  ],
  COO_ADMIN: [
    "Nobody keeps the wheels turning quite like you do.",
    "Your operational grip on things is second to none.",
    "You make complex operations look effortless.",
    "The team runs like clockwork because of your oversight.",
    "Your ability to balance priorities is remarkable.",
    "Processes don't optimise themselves — that's all you.",
  ],
  PROGRAM_MANAGER: [
    "You're the glue holding multiple projects together — and it's working.",
    "Your ability to see the big picture across projects is a real asset.",
    "The way you coordinate across teams makes everyone's life easier.",
    "Program-level visibility like yours is rare and valuable.",
    "You keep the portfolio on track even when things get chaotic.",
  ],
  PROJECT_MANAGER_SITE: [
    "You're the boots on the ground making things happen.",
    "Your site management is why projects actually get delivered.",
    "The team on site trusts you — and that's earned, not given.",
    "Your weekly reports show real ownership of the work.",
    "Projects under your watch consistently move in the right direction.",
  ],
  ENGINEER: [
    "Your technical skills are the backbone of these projects.",
    "The engineering quality you deliver speaks for itself.",
    "You turn complex problems into clean solutions.",
    "Your attention to technical detail saves us from costly mistakes.",
    "Engineering tasks don't close themselves — your execution is excellent.",
  ],
  QUALITY_MANAGER: [
    "Quality doesn't happen by accident — it happens because of you.",
    "Your standards keep the whole team honest.",
    "Every green checkmark on the quality dashboard is your doing.",
    "The way you catch issues before they escalate is invaluable.",
    "Your QA process gives everyone confidence in what we deliver.",
  ],
  CONSTRUCTION_MANAGER: [
    "You keep construction on track — and that's no small feat.",
    "Your site coordination skills are what make builds run smoothly.",
    "The progress on site is a direct reflection of your management.",
    "You manage complexity on the ground better than anyone.",
    "Timelines stay intact because of your day-to-day leadership.",
  ],
  HEAD_OF_ENGINEERING: [
    "Your engineering leadership shapes the quality of everything we build.",
    "The engineering team thrives under your direction.",
    "You set the standard for technical excellence across the company.",
    "Your oversight ensures nothing falls through the cracks.",
    "The engineering pipeline moves because you keep pushing it forward.",
  ],
  CFO: [
    "You keep the financial engine running with precision.",
    "Your financial oversight gives the company stability and confidence.",
    "Numbers tell a story — and you always know the plot.",
    "COS tracking, cashflow, budgets — you've got it all covered.",
    "The financial clarity you provide helps everyone make better decisions.",
  ],
  default: [
    "You're making a real difference on these projects.",
    "Your attention to detail keeps everything running smoothly.",
    "The team is lucky to have you driving things forward.",
    "Every project you touch gets better because of your effort.",
    "Your dedication to quality really shows in the results.",
    "You bring great energy to the work — keep it up.",
    "The progress you're making is impressive, well done.",
    "Your problem-solving skills are next level.",
    "Today is going to be a great day — you've got this.",
    "You're building something great — one step at a time.",
  ],
};

const ROLE_SARCASM: Record<string, string[]> = {
  CEO_ADMIN: [
    "Another day of pretending the dashboard doesn't stress you out.",
    "Welcome back — the decisions won't make themselves. Unfortunately.",
    "The good news: you're in charge. The bad news: you're in charge.",
    "Let's see which fire needs extinguishing first today.",
    "You wanted to lead a renewable energy company. This is what that looks like.",
    "The portfolio is waiting for your attention. It's been very patient.",
  ],
  COO_ADMIN: [
    "Operations called — they want more of your time. Shocker.",
    "Another day of making sure nothing falls apart. You're welcome, everyone.",
    "The system is only running smoothly because you refuse to let it not.",
    "You optimised yesterday. Time to optimise the optimisation.",
    "Without you, this place would be chaos. With you, it's controlled chaos.",
    "Processes don't run themselves. But they definitely run you.",
  ],
  PROGRAM_MANAGER: [
    "Multiple projects, one brain. Good luck with that ratio.",
    "Your calendar doesn't have gaps — it has tiny miracles.",
    "Managing one project is hard. You volunteered for several. Bold choice.",
    "Somewhere right now, a task is being marked as 'in progress' when it hasn't started.",
    "The portfolio view looks clean. We both know the reality is messier.",
  ],
  PROJECT_MANAGER_SITE: [
    "Time for another weekly review. Try to sound optimistic this time.",
    "Your site is definitely running on schedule. Definitely. Absolutely.",
    "The Excel tracker misses you. It's been at least 20 minutes.",
    "You're basically a professional herder of subcontractors.",
    "The PM Dashboard is up — let's see how many things need your attention. Spoiler: all of them.",
  ],
  ENGINEER: [
    "Engineering tasks are piling up. But sure, check the dashboard first.",
    "Another day of turning vague requirements into actual solutions.",
    "The task board has feelings and they're hurt you haven't visited today.",
    "You solve problems nobody else even notices exist. That's both a gift and a curse.",
    "Technical signoff awaits. No pressure — just everyone's timeline depending on it.",
  ],
  QUALITY_MANAGER: [
    "The checklists miss you. They've been waiting since yesterday.",
    "Another day of telling people their work isn't quite up to standard. Living the dream.",
    "QA warnings don't generate themselves. Actually wait — they do. That's the problem.",
    "You're the reason people double-check their work. You're welcome, quality.",
    "Somewhere a deliverable is missing evidence. Your spidey senses are probably tingling.",
  ],
  CONSTRUCTION_MANAGER: [
    "Construction is on track. In the same way that a train that's 10 minutes late is 'on track'.",
    "Your subcontractors are definitely all showing up today. Probably.",
    "The weather is cooperating. Just kidding — when does it ever?",
    "You manage construction sites. People manage their Netflix queues. Same energy. Different stakes.",
    "Another day of explaining why the timeline shifted. Again.",
  ],
  HEAD_OF_ENGINEERING: [
    "Your engineers are definitely all updating their task statuses. In theory.",
    "Engineering pipeline is flowing. Like a pipe with a few interesting bends.",
    "Stage gates don't approve themselves — though some people act like they should.",
    "The standup dashboard is ready. The actual standup energy... we'll see.",
    "You lead the engineers. They lead the technical complexity. Everyone leads something.",
  ],
  CFO: [
    "The numbers are looking... numerical. That's a start.",
    "COS realisation is at whatever percent it is. Deep breaths.",
    "Cashflow is a bit like the weather — everyone talks about it, nobody controls it.",
    "Cost variance is just a fancy way of saying 'surprise spending'.",
    "You keep the money straight. Everyone else keeps spending it. Classic teamwork.",
  ],
  default: [
    "Back again? The dashboard definitely missed you.",
    "Another day, another chance to pretend everything is under control.",
    "Your inbox isn't going to triage itself. Just saying.",
    "Let's see what needs attention today. Spoiler: everything.",
    "You showed up — that's already more than some dashboards expected.",
    "The system is running. The coffee should be too.",
    "Time to make some decisions. Or at least scroll through some charts.",
    "Projects are waiting. They're not very patient though.",
    "Welcome back. The data hasn't changed, but somehow there's more of it.",
    "Ready to be productive? The task list certainly hopes so.",
  ],
};

const DAD_JOKES = [
  "Why did the solar panel break up with the cloud? It needed more space.",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "What do you call a fake noodle? An impasta.",
  "Why don't skeletons fight each other? They don't have the guts.",
  "I'm reading a book about anti-gravity. It's impossible to put down.",
  "What did the ocean say to the beach? Nothing, it just waved.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I used to hate facial hair, but then it grew on me.",
  "What do you call a bear with no teeth? A gummy bear.",
  "Why don't eggs tell jokes? They'd crack each other up.",
  "I only know 25 letters of the alphabet. I don't know y.",
  "What do you call a dog that does magic tricks? A Labracadabrador.",
  "Why did the bicycle fall over? Because it was two-tired.",
  "What did the electrician say to his apprentice? You're grounded!",
  "I'm on a seafood diet. I see food and I eat it.",
  "Why do engineers prefer dark mode? Because light attracts bugs.",
  "What's the best thing about Switzerland? I don't know, but the flag is a big plus.",
  "Why did the project manager bring a ladder? To reach the next milestone.",
  "I told a construction joke. I'm still working on it.",
  "What did the roof say to the solar panel? You're really on top of things.",
  "Why did the engineer cross the road? To get to the other site.",
  "What's a solar panel's favourite music? Heavy metal — because of all the racking.",
  "I asked the inverter how it was doing. It said 'I'm having a conversion.'",
  "Why don't construction workers ever get lost? Because they always follow the plan.",
  "What did one cable tray say to the other? 'I'm feeling a bit unsupported.'",
];

function getGreeting(role: string): string {
  const isSarcastic = Math.random() < 0.5;
  const pool = isSarcastic ? ROLE_SARCASM : ROLE_COMPLIMENTS;
  const messages = pool[role] || pool.default;
  return messages[Math.floor(Math.random() * messages.length)];
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
  links?: { id: number; linkType: string; projectName: string | null; taskId: number | null }[];
}

function severityOrder(s: string): number {
  if (s === "critical") return 0;
  if (s === "important") return 1;
  return 2;
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
    case "in_progress":
      return "bg-emerald-600 text-white";
    case "monitoring":
      return "bg-blue-600 text-white";
    case "not_started":
      return "bg-slate-400 text-white";
    case "complete":
      return "bg-emerald-700 text-white";
    case "closed":
      return "bg-gray-400 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

function severityBorder(severity: string): string {
  if (severity === "critical") return "border-l-red-500";
  if (severity === "important") return "border-l-amber-500";
  return "border-l-border";
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function CompanyPrioritiesCards({ isAdmin, priorities, isLoading }: { isAdmin: boolean; priorities: CompanyPriority[]; isLoading: boolean }) {
  const activePriorities = priorities.filter(p => !["closed", "complete"].includes(p.status));

  const sorted = [...activePriorities].sort((a, b) => {
    const aOverdue = isOverdue(a.dueDate) ? 0 : 1;
    const bOverdue = isOverdue(b.dueDate) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aSev = severityOrder(a.severity);
    const bSev = severityOrder(b.severity);
    if (aSev !== bSev) return aSev - bSev;
    return (a.priorityRank ?? 999) - (b.priorityRank ?? 999);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <EnergyLoader size="md" label="Powering up dashboard..." />
      </div>
    );
  }

  if (activePriorities.length === 0 && !isAdmin) return null;

  return (
    <div data-testid="company-priorities-section">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Flag className="h-4 w-4 text-red-600" />
          Company Priorities
          <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
            {activePriorities.length} active
          </span>
        </h2>
        {isAdmin && (
          <Link href="/company-priorities">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-manage-priorities">
              Manage <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        )}
      </div>
      {activePriorities.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No active company priorities.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => {
            const overdue = isOverdue(p.dueDate);
            const linkedCount = (p.links?.length ?? 0) + (p.linkedProjectName ? 1 : 0);
            return (
              <div
                key={p.id}
                className={`border-l-4 ${severityBorder(p.severity)} border rounded-lg bg-card p-3 space-y-2 ${overdue ? "ring-1 ring-red-500/30" : ""}`}
                data-testid={`priority-card-${p.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-sm leading-snug" data-testid={`text-priority-title-${p.id}`}>{p.title}</h3>
                  <div className="flex items-center gap-1 shrink-0">
                    {p.department && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-200 text-blue-600 bg-blue-50" data-testid={`badge-dept-${p.id}`}>
                        {p.department}
                      </Badge>
                    )}
                    <Badge className={`text-[10px] px-1.5 py-0 ${statusColor(p.status)}`}>
                      {p.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                {p.assignedTo && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>{p.assignedTo}</span>
                  </div>
                )}
                {p.nextAction && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Target className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{p.nextAction}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-border/50">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {p.dueDate && (
                      <span className={`flex items-center gap-1 ${overdue ? "text-red-600 font-medium" : ""}`}>
                        <Calendar className="h-3 w-3" />
                        {p.dueDate}
                        {overdue && <AlertTriangle className="h-3 w-3" />}
                      </span>
                    )}
                    {linkedCount > 0 && (
                      <span className="flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                        {linkedCount} linked
                      </span>
                    )}
                  </div>
                  <Link href="/company-priorities">
                    <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2 gap-0.5" data-testid={`button-view-priority-${p.id}`}>
                      Details <ChevronRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ICON_MAP: Record<string, any> = {
  BarChart3, Wallet, ClipboardCheck, Layers, FileSpreadsheet, Settings: Settings2,
  Activity, TrendingUp, ClipboardList, FolderOpen, ShieldCheck, HardHat,
  ListTodo, Inbox, FolderKanban, Briefcase, FileEdit, Gauge,
};

function QuickActionsWidget({ role }: { role: string }) {
  const [, navigate] = useLocation();
  const actions = ROLE_QUICK_ACTIONS[role] || ROLE_QUICK_ACTIONS["PROGRAM_MANAGER"] || [];
  if (actions.length === 0) return null;

  return (
    <div data-testid="quick-actions-card">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-primary" />
        Quick Actions
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2" data-testid="quick-actions">
        {actions.map((action) => {
          const Icon = ICON_MAP[action.icon] || ArrowRight;
          return (
            <button
              key={action.path}
              className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group"
              onClick={() => navigate(action.path)}
              data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="p-2 rounded-md bg-primary/10 group-hover:bg-primary/15 transition-colors">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] font-medium text-center leading-tight">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const { user, isAdmin } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const canEdit = isAdmin || (companyRole && ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO"].includes(companyRole));

  const isFriday = new Date().getDay() === 5;
  const userRole = companyRole || user?.role || "default";
  const compliment = useMemo(() => {
    if (isFriday) {
      return DAD_JOKES[Math.floor(Math.random() * DAD_JOKES.length)];
    }
    return getGreeting(userRole);
  }, []);

  const firstName = user?.name ? user.name.split(" ")[0] : "there";

  const { data: priorities = [], isLoading: prioritiesLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  const { data: projectsSummary } = useQuery<any[]>({
    queryKey: ["projects-summary"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/projects-summary", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const activeProjects = projectsSummary?.filter((p: any) => p.is_active)?.length ?? 0;
  const totalRevenue = projectsSummary?.reduce((sum: number, p: any) => sum + (p.actual_revenue || 0), 0) ?? 0;
  const totalExpenses = projectsSummary?.reduce((sum: number, p: any) => sum + (p.actual_expenses || 0), 0) ?? 0;
  const avgCompletion = projectsSummary?.length
    ? Math.round((projectsSummary.reduce((sum: number, p: any) => sum + (p.project_pct_complete || 0), 0) / projectsSummary.length) * 100)
    : 0;

  const formatCurrency = (val: number) => {
    if (val >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `R${(val / 1_000).toFixed(0)}K`;
    return `R${val.toFixed(0)}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto" data-testid="home-page">
      <PageHeader
        title={`Welcome, ${firstName}`}
        subtitle={isFriday ? `\uD83D\uDE04 ${compliment}` : compliment}
      />

      <MetricStrip
        metrics={[
          {
            label: "Active Projects",
            value: activeProjects,
            icon: <FolderKanban className="h-4 w-4" />,
          },
          {
            label: "Inflows Realised",
            value: formatCurrency(totalRevenue),
            icon: <DollarSign className="h-4 w-4" />,
          },
          {
            label: "Total Expenses",
            value: formatCurrency(totalExpenses),
            icon: <Wallet className="h-4 w-4" />,
          },
          {
            label: "Avg Completion",
            value: `${avgCompletion}%`,
            icon: <Clock className="h-4 w-4" />,
          },
        ]}
      />

      <CompanyPrioritiesCards isAdmin={!!canEdit} priorities={priorities} isLoading={prioritiesLoading} />

      <QuickActionsWidget role={userRole} />
    </div>
  );
}

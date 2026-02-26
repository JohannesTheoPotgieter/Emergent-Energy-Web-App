import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import {
  Flag,
  Loader2,
  ArrowRight,
  AlertTriangle,
  Clock,
  ChevronRight,
  ExternalLink,
  Users,
  Calendar,
  Target,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  ListTodo,
  FileCheck,
  Shield,
  Zap,
  TrendingDown,
  AlertCircle,
  CircleDot,
  Eye,
  MailCheck,
  Wrench,
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

interface ActionHubData {
  unreadCount: number;
  actionRequired: any[];
  recentNotifications: any[];
  myTasks: any[];
  overdueTaskCount: number;
  pendingApprovals: any[];
  approvalCounts: { engineering: number; quality: number; deliverable: number; total: number };
  projectsAtRisk: any[];
  userRole: string;
  isAdmin: boolean;
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
  return "border-l-slate-300 dark:border-l-slate-600";
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function cleanProjectName(name: string): string {
  return (name || "").replace(/_Tracker\d*$/i, "").replace(/_/g, " ").trim();
}

const EVENT_ICONS: Record<string, any> = {
  "plan.change_confirmation": ClipboardCheck,
  "task.assigned": ListTodo,
  "task.status_changed": CircleDot,
  "deliverable.submitted_for_approval": FileCheck,
  "deliverable.qc_approved": CheckCircle2,
  "deliverable.feedback_requested": MailCheck,
  "milestone.approaching": Clock,
  "milestone.commissioning_soon": AlertTriangle,
  "project.behind_schedule": TrendingDown,
  "project.phase_changed": Zap,
};

function NotificationItem({ notif, onMarkRead }: { notif: any; onMarkRead?: (id: number) => void }) {
  const Icon = EVENT_ICONS[notif.eventType] || Bell;
  const isAction = notif.requiresConfirmation && !notif.confirmedAt;
  const projectDisplay = notif.projectName ? cleanProjectName(notif.projectName) : null;

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        isAction
          ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800"
          : "border-border/50 bg-card hover:bg-muted/30"
      }`}
      data-testid={`notification-item-${notif.id}`}
    >
      <div className={`mt-0.5 p-1.5 rounded-md ${isAction ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug truncate" data-testid={`notification-title-${notif.id}`}>
          {notif.title}
        </p>
        {projectDisplay && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{projectDisplay}</p>
        )}
        {isAction && (
          <Badge variant="outline" className="text-[10px] mt-1 border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700">
            Action Required
          </Badge>
        )}
      </div>
      {onMarkRead && !notif.isRead && (
        <button
          onClick={(e) => { e.stopPropagation(); onMarkRead(notif.id); }}
          className="text-muted-foreground hover:text-foreground p-1"
          title="Mark as read"
          data-testid={`mark-read-${notif.id}`}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function TaskItem({ task }: { task: any }) {
  const [, navigate] = useLocation();
  const overdue = task.dueDate && new Date(task.dueDate) < new Date();
  const projectDisplay = cleanProjectName(task.projectName);

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted/30 ${
        overdue ? "border-red-200 bg-red-50/30 dark:bg-red-950/10 dark:border-red-900" : "border-border/50 bg-card"
      }`}
      onClick={() => navigate(`/engineering?project=${encodeURIComponent(task.projectName)}`)}
      data-testid={`task-item-${task.id}`}
    >
      <div className={`p-1.5 rounded-md ${overdue ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>
        <ListTodo className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug truncate">{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-muted-foreground">{projectDisplay}</span>
          {task.priority && task.priority !== "Med" && (
            <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
              task.priority === "Critical" ? "border-red-300 text-red-600" :
              task.priority === "High" ? "border-amber-300 text-amber-600" : "border-gray-300 text-gray-500"
            }`}>{task.priority}</Badge>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {task.dueDate && (
          <span className={`text-[11px] flex items-center gap-1 ${overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
            {overdue && <AlertTriangle className="w-3 h-3" />}
            {task.dueDate}
          </span>
        )}
        <Badge variant="outline" className="text-[10px] mt-0.5">{task.status}</Badge>
      </div>
    </div>
  );
}

function ApprovalItem({ approval }: { approval: any }) {
  const [, navigate] = useLocation();
  const projectDisplay = cleanProjectName(approval.projectName);
  const typeIcons: Record<string, any> = {
    engineering: Wrench,
    quality: Shield,
    deliverable: FileCheck,
  };
  const Icon = typeIcons[approval.type] || ClipboardCheck;
  const typeColors: Record<string, string> = {
    engineering: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400",
    quality: "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400",
    deliverable: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400",
  };

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card cursor-pointer transition-colors hover:bg-muted/30"
      onClick={() => navigate("/approvals")}
      data-testid={`approval-item-${approval.id}`}
    >
      <div className={`p-1.5 rounded-md ${typeColors[approval.type] || "bg-muted text-muted-foreground"}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug truncate">{approval.title}</p>
        <span className="text-[11px] text-muted-foreground">{projectDisplay}</span>
      </div>
      <Badge variant="outline" className="text-[10px] capitalize shrink-0">{approval.type}</Badge>
    </div>
  );
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
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activePriorities.length === 0 && !isAdmin) return null;

  return (
    <Card className="shadow-sm" data-testid="company-priorities-section">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Flag className="h-4 w-4 text-red-500" />
            Company Priorities
            <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
              {activePriorities.length} active
            </span>
          </CardTitle>
          {isAdmin && (
            <Link href="/company-priorities">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-manage-priorities">
                Manage <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {activePriorities.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No active company priorities.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((p, idx) => {
              const overdue = isOverdue(p.dueDate);
              const linkedCount = (p.links?.length ?? 0) + (p.linkedProjectName ? 1 : 0);
              return (
                <div
                  key={p.id}
                  className={`border-l-4 ${severityBorder(p.severity)} border rounded-lg bg-card p-3 space-y-2 ${overdue ? "ring-1 ring-red-300 dark:ring-red-800" : ""}`}
                  data-testid={`priority-card-${p.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-snug" data-testid={`text-priority-title-${p.id}`}>{p.title}</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      {p.department && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-700" data-testid={`badge-dept-${p.id}`}>
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
      </CardContent>
    </Card>
  );
}

function StatCard({ icon: Icon, label, value, color, href, testId }: {
  icon: any; label: string; value: number; color: string; href?: string; testId: string;
}) {
  const [, navigate] = useLocation();
  const content = (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card ${href ? "cursor-pointer hover:bg-muted/30 transition-colors" : ""}`}
      onClick={href ? () => navigate(href) : undefined}
      data-testid={testId}
    >
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none" data-testid={`${testId}-value`}>{value}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
  return content;
}

export default function Home() {
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
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

  const { data: hub, isLoading: hubLoading } = useQuery<ActionHubData>({
    queryKey: ["/api/home/action-hub"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 60000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await apiRequest("POST", "/api/notifications/mark-read", { notificationIds: ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/home/action-hub"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const hasActions = hub && (
    hub.actionRequired.length > 0 ||
    hub.overdueTaskCount > 0 ||
    hub.approvalCounts.total > 0
  );

  return (
    <div className="space-y-5 max-w-7xl mx-auto" data-testid="home-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-welcome">Welcome, {firstName}</h1>
          <p className="text-sm text-muted-foreground italic" data-testid="text-compliment">
            {isFriday ? `\uD83D\uDE04 ${compliment}` : compliment}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      {hubLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : hub ? (
        <>
          {hasActions && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-center gap-3" data-testid="action-banner">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div className="flex-1 text-sm">
                <span className="font-medium text-amber-800 dark:text-amber-300">Items need your attention: </span>
                <span className="text-amber-700 dark:text-amber-400">
                  {[
                    hub.overdueTaskCount > 0 && `${hub.overdueTaskCount} overdue task${hub.overdueTaskCount > 1 ? 's' : ''}`,
                    hub.approvalCounts.total > 0 && `${hub.approvalCounts.total} pending approval${hub.approvalCounts.total > 1 ? 's' : ''}`,
                    hub.actionRequired.length > 0 && `${hub.actionRequired.length} action${hub.actionRequired.length > 1 ? 's' : ''} required`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="stat-cards">
            <StatCard
              icon={Bell}
              label="Unread Notifications"
              value={hub.unreadCount}
              color="bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400"
              href="/notifications"
              testId="stat-unread"
            />
            <StatCard
              icon={ListTodo}
              label="My Open Tasks"
              value={hub.myTasks.length}
              color="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400"
              href="/engineering"
              testId="stat-tasks"
            />
            <StatCard
              icon={ClipboardCheck}
              label="Pending Approvals"
              value={hub.approvalCounts.total}
              color="bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400"
              href="/approvals"
              testId="stat-approvals"
            />
            <StatCard
              icon={AlertTriangle}
              label="Overdue Tasks"
              value={hub.overdueTaskCount}
              color={hub.overdueTaskCount > 0 ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400"}
              href="/engineering"
              testId="stat-overdue"
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {hub.myTasks.length > 0 && (
              <Card className="shadow-sm" data-testid="card-my-tasks">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <ListTodo className="h-4 w-4 text-indigo-500" />
                      My Tasks
                      {hub.overdueTaskCount > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{hub.overdueTaskCount} overdue</Badge>
                      )}
                    </CardTitle>
                    <Link href="/engineering">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-view-all-tasks">
                        View all <ArrowRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {hub.myTasks.map(task => (
                      <TaskItem key={task.id} task={task} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {hub.approvalCounts.total > 0 && (
              <Card className="shadow-sm" data-testid="card-approvals">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-purple-500" />
                      Pending Approvals
                      <Badge className="text-[10px] px-1.5 py-0 bg-purple-600">{hub.approvalCounts.total}</Badge>
                    </CardTitle>
                    <Link href="/approvals">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-view-approvals">
                        View all <ArrowRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {hub.approvalCounts.engineering > 0 && (
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <Wrench className="w-3 h-3" />
                        {hub.approvalCounts.engineering} Engineering
                      </Badge>
                    )}
                    {hub.approvalCounts.quality > 0 && (
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <Shield className="w-3 h-3" />
                        {hub.approvalCounts.quality} Quality
                      </Badge>
                    )}
                    {hub.approvalCounts.deliverable > 0 && (
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <FileCheck className="w-3 h-3" />
                        {hub.approvalCounts.deliverable} Deliverable
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-2">
                    {hub.pendingApprovals.map(approval => (
                      <ApprovalItem key={approval.id} approval={approval} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {(hub.actionRequired.length > 0 || hub.recentNotifications.length > 0) && (
              <Card className="shadow-sm" data-testid="card-notifications">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Bell className="h-4 w-4 text-blue-500" />
                      Notifications
                      {hub.unreadCount > 0 && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-blue-600">{hub.unreadCount}</Badge>
                      )}
                    </CardTitle>
                    <Link href="/notifications">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-view-notifications">
                        View all <ArrowRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {hub.actionRequired.length > 0 && (
                      <>
                        {hub.actionRequired.slice(0, 4).map(notif => (
                          <NotificationItem
                            key={notif.id}
                            notif={notif}
                            onMarkRead={(id) => markReadMutation.mutate([id])}
                          />
                        ))}
                        {hub.actionRequired.length > 4 && (
                          <Link href="/notifications">
                            <p className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer pl-1">
                              +{hub.actionRequired.length - 4} more actions required...
                            </p>
                          </Link>
                        )}
                      </>
                    )}
                    {hub.actionRequired.length === 0 && hub.recentNotifications.map(notif => (
                      <NotificationItem
                        key={notif.id}
                        notif={notif}
                        onMarkRead={(id) => markReadMutation.mutate([id])}
                      />
                    ))}
                    {hub.actionRequired.length > 0 && hub.recentNotifications.length > 0 && (
                      <>
                        <div className="border-t border-border/50 pt-2 mt-2">
                          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2">Recent</p>
                        </div>
                        {hub.recentNotifications
                          .filter(n => !hub.actionRequired.some((a: any) => a.id === n.id))
                          .slice(0, 3)
                          .map(notif => (
                            <NotificationItem
                              key={notif.id}
                              notif={notif}
                              onMarkRead={(id) => markReadMutation.mutate([id])}
                            />
                          ))}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {hub.myTasks.length === 0 && hub.approvalCounts.total === 0 && hub.recentNotifications.length === 0 && (
              <Card className="shadow-sm lg:col-span-2" data-testid="card-all-clear">
                <CardContent className="flex flex-col items-center justify-center py-10">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
                  <h3 className="font-semibold text-lg">You're all caught up</h3>
                  <p className="text-sm text-muted-foreground mt-1">No pending tasks, approvals, or notifications right now.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      ) : null}

      <CompanyPrioritiesCards isAdmin={!!canEdit} priorities={priorities} isLoading={prioritiesLoading} />

      {hub && (
        <Card className="shadow-sm" data-testid="card-quick-links">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Quick Navigation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {[
                { label: "Execution Board", href: "/dashboard", icon: Target, show: true },
                { label: "Notifications", href: "/notifications", icon: Bell, show: true, badge: hub.unreadCount > 0 ? hub.unreadCount : undefined },
                { label: "Approvals", href: "/approvals", icon: ClipboardCheck, show: hub.approvalCounts.total > 0 || hub.isAdmin },
                { label: "Engineering Inbox", href: "/engineering", icon: Wrench, show: true },
                { label: "Quality Dashboard", href: "/qm-dashboard", icon: Shield, show: ["QUALITY_MANAGER", "quality_manager", "COO_ADMIN", "CEO_ADMIN", "CONSTRUCTION_MANAGER"].includes(userRole) },
                { label: "PM Dashboard", href: "/pm-dashboard", icon: Users, show: ["PROJECT_MANAGER_SITE", "PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN"].includes(userRole) },
                { label: "Leaderboard", href: "/leaderboard", icon: Zap, show: true },
                { label: "EE Info", href: "/ee-info", icon: ExternalLink, show: true },
              ].filter(item => item.show).map(item => (
                <Link key={item.href} href={item.href}>
                  <div
                    className="flex items-center gap-2 p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/30 cursor-pointer transition-colors"
                    data-testid={`quick-link-${item.href.replace(/\//g, '-').slice(1)}`}
                  >
                    <item.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{item.label}</span>
                    {item.badge && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-blue-600 ml-auto shrink-0">{item.badge}</Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

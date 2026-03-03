import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { InteractiveTutorial, useInteractiveTutorial } from "@/components/InteractiveTutorial";
import DataSourceDebug from "@/components/DataSourceDebug";
import { DEFAULT_WIDGET_ORDER, WIDGET_DEFINITIONS, getWidgetsForRole, ROLE_QUICK_ACTIONS } from "@shared/schema";
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
  AlertCircle,
  CircleDot,
  Eye,
  MailCheck,
  Wrench,
  Search,
  FolderOpen,
  FileText,
  MessageSquare,
  Building2,
  Compass,
  Settings2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  X,
  RotateCcw,
  EyeOff,
  BarChart3,
  Wallet,
  TrendingUp,
  TrendingDown as TrendingDownIcon,
  Gauge,
  Layers,
  ShieldCheck,
  HardHat,
  Briefcase,
  FileEdit,
  Activity,
  Inbox,
  FolderKanban,
  FileSpreadsheet,
  ClipboardList,
  DollarSign,
  Percent,
  DatabaseZap,
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
  approvalCounts: { engineering: number; quality: number; deliverable: number; taskDeliverable: number; total: number };
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

function daysOverdueCalc(dueDate: string): number {
  const due = new Date(dueDate + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
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
  "deliverable.sent_for_acknowledgment": FileCheck,
  "deliverable.acknowledged": CheckCircle2,
  "milestone.approaching": Clock,
  "milestone.commissioning_soon": AlertTriangle,
  "project.behind_schedule": TrendingDownIcon,
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
  const overdue = task.dueDate && isOverdue(task.dueDate);
  const daysOverdue = overdue ? Math.max(1, daysOverdueCalc(task.dueDate)) : 0;
  const projectDisplay = cleanProjectName(task.projectName);

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted/30 ${
        overdue ? "border-l-4 border-l-red-500 border-red-200 bg-red-50/30 dark:bg-red-950/10 dark:border-red-900" : "border-border/50 bg-card"
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
        {overdue && (
          <Badge variant="destructive" className="text-[9px] px-1 py-0 mt-0.5" data-testid={`task-overdue-badge-${task.id}`}>{daysOverdue}d overdue</Badge>
        )}
        {!overdue && <Badge variant="outline" className="text-[10px] mt-0.5">{task.status}</Badge>}
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
    task_deliverable: FileCheck,
  };
  const Icon = typeIcons[approval.type] || ClipboardCheck;
  const typeColors: Record<string, string> = {
    engineering: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400",
    quality: "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400",
    deliverable: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400",
    task_deliverable: "bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400",
  };

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card cursor-pointer transition-colors hover:bg-muted/30"
      onClick={() => {
        if (approval.type === "task_deliverable" && approval.taskId) {
          navigate(`/engineering/tasks?taskId=${approval.taskId}`);
        } else {
          navigate("/approvals");
        }
      }}
      data-testid={`approval-item-${approval.id}`}
    >
      <div className={`p-1.5 rounded-md ${typeColors[approval.type] || "bg-muted text-muted-foreground"}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug truncate">{approval.title}</p>
        <span className="text-[11px] text-muted-foreground">{approval.type === "task_deliverable" && approval.taskTitle ? approval.taskTitle : projectDisplay}</span>
      </div>
      <Badge variant="outline" className={`text-[10px] capitalize shrink-0 ${approval.type === "task_deliverable" ? "border-orange-300 text-orange-700" : ""}`}>{approval.type === "task_deliverable" ? "Acknowledge" : approval.type}</Badge>
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

interface ProjectSummary {
  project_name: string;
  phase?: string | null;
  pm?: string | null;
  pd?: string | null;
  project_pct_complete?: number | null;
  expected_pct_complete?: number | null;
  delta_vs_expected?: number | null;
  actual_revenue?: number | null;
  actual_expenses?: number | null;
  gp_percent?: number | null;
  revenue_outstanding?: number | null;
  expenses_due?: number | null;
  project_info_id?: number | null;
  is_active?: boolean;
  has_tracker_import?: boolean;
  last_import_at?: string | null;
}

function ProjectQuickSearch({ projects, isLoading }: { projects: ProjectSummary[]; isLoading: boolean }) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeProjects = useMemo(() => projects.filter(p => p.is_active !== false), [projects]);

  const filtered = useMemo(() => {
    if (!search.trim()) return activeProjects.slice(0, 8);
    const q = search.toLowerCase();
    return activeProjects.filter(p =>
      cleanProjectName(p.project_name).toLowerCase().includes(q) ||
      (p.pm || "").toLowerCase().includes(q) ||
      (p.pd || "").toLowerCase().includes(q)
    ).slice(0, 10);
  }, [search, activeProjects]);

  return (
    <div ref={wrapperRef} className="relative" data-testid="project-quick-search">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Jump to a project..."
          className="pl-10 h-10 bg-card border-border/60"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          data-testid="input-project-search"
        />
      </div>
      {isOpen && !isLoading && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-[320px] overflow-y-auto" data-testid="project-search-results">
          {filtered.map(p => (
            <button
              key={p.project_name}
              className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-center gap-3 border-b border-border/30 last:border-0"
              onClick={() => {
                navigate(`/project/${encodeURIComponent(p.project_name)}`);
                setIsOpen(false);
                setSearch("");
              }}
              data-testid={`search-result-${p.project_name}`}
            >
              <div className="p-1.5 rounded bg-blue-50 text-blue-600">
                <Building2 className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{cleanProjectName(p.project_name)}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {p.phase && <span>{p.phase}</span>}
                  {p.pm && <span>PM: {p.pm}</span>}
                </div>
              </div>
              {p.project_pct_complete != null && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {Math.round(p.project_pct_complete * 100)}%
                </Badge>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface PriorityItem {
  id: string;
  type: "overdue_task" | "action_required" | "approval";
  title: string;
  projectName: string | null;
  urgency: number;
  urgencyLabel: string;
  icon: any;
  iconColor: string;
  href: string;
}

function PriorityQueue({ hub }: { hub: ActionHubData }) {
  const [, navigate] = useLocation();

  const items = useMemo(() => {
    const result: PriorityItem[] = [];
    const now = Date.now();

    for (const task of hub.myTasks) {
      if (task.dueDate && isOverdue(task.dueDate)) {
        const daysLate = Math.max(1, daysOverdueCalc(task.dueDate));
        result.push({
          id: `task-${task.id}`,
          type: "overdue_task",
          title: task.title,
          projectName: task.projectName,
          urgency: 1000 + daysLate,
          urgencyLabel: `${daysLate}d overdue`,
          icon: AlertTriangle,
          iconColor: "bg-red-100 text-red-600",
          href: `/engineering?project=${encodeURIComponent(task.projectName)}`,
        });
      }
    }

    for (const notif of hub.actionRequired) {
      result.push({
        id: `notif-${notif.id}`,
        type: "action_required",
        title: notif.title,
        projectName: notif.projectName,
        urgency: 500,
        urgencyLabel: "Action required",
        icon: ClipboardCheck,
        iconColor: "bg-amber-100 text-amber-600",
        href: "/notifications",
      });
    }

    for (const approval of hub.pendingApprovals) {
      result.push({
        id: `appr-${approval.id}`,
        type: "approval",
        title: approval.title,
        projectName: approval.projectName,
        urgency: 100,
        urgencyLabel: "Awaiting approval",
        icon: FileCheck,
        iconColor: "bg-purple-100 text-purple-600",
        href: "/approvals",
      });
    }

    result.sort((a, b) => b.urgency - a.urgency);
    return result.slice(0, 5);
  }, [hub]);

  if (items.length === 0) return null;

  return (
    <Card className="shadow-sm border-l-4 border-l-amber-500" data-testid="priority-queue">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Target className="h-4 w-4 text-amber-500" />
            Your Priority Queue
            <Badge className="text-[10px] px-1.5 py-0 bg-amber-600">{items.length}</Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map(item => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-border/50 bg-card cursor-pointer transition-colors hover:bg-muted/30"
                onClick={() => navigate(item.href)}
                data-testid={`priority-item-${item.id}`}
              >
                <div className={`p-1.5 rounded-md ${item.iconColor}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug truncate">{item.title}</p>
                  {item.projectName && (
                    <span className="text-[11px] text-muted-foreground">{cleanProjectName(item.projectName)}</span>
                  )}
                </div>
                <Badge
                  variant={item.type === "overdue_task" ? "destructive" : "outline"}
                  className={`text-[9px] px-1.5 py-0 shrink-0 ${
                    item.type === "action_required" ? "border-amber-300 text-amber-700 bg-amber-50" :
                    item.type === "approval" ? "border-purple-300 text-purple-700" : ""
                  }`}
                  data-testid={`priority-urgency-${item.id}`}
                >
                  {item.urgencyLabel}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MyProjectsHub({ projects, userName }: { projects: ProjectSummary[]; userName: string }) {
  const [, navigate] = useLocation();

  const myProjects = useMemo(() => {
    const name = userName.toLowerCase().trim();
    return projects.filter(p => {
      if (p.is_active === false) return false;
      const pmLower = (p.pm || "").toLowerCase().trim();
      const pdLower = (p.pd || "").toLowerCase().trim();
      return pmLower === name || pdLower === name ||
        (name.length > 2 && (pmLower.startsWith(name + " ") || pdLower.startsWith(name + " ")));
    });
  }, [projects, userName]);

  if (myProjects.length === 0) return null;

  return (
    <Card className="shadow-sm" data-testid="card-my-projects">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-blue-500" />
            My Projects
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{myProjects.length}</Badge>
          </CardTitle>
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-view-all-projects">
              All Projects <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {myProjects.slice(0, 6).map(p => {
            const name = cleanProjectName(p.project_name);
            const progress = p.project_pct_complete != null ? Math.round(p.project_pct_complete * 100) : null;
            const expected = p.expected_pct_complete != null ? Math.round(p.expected_pct_complete * 100) : null;
            const behind = progress !== null && expected !== null && (expected - progress) > 5;
            const importDaysAgo = p.last_import_at ? Math.floor((Date.now() - new Date(p.last_import_at).getTime()) / (1000 * 60 * 60 * 24)) : null;
            const isStale = importDaysAgo !== null && importDaysAgo > 14;

            return (
              <div
                key={p.project_name}
                className={`border rounded-lg p-3 cursor-pointer transition-colors hover:bg-muted/30 ${behind ? "border-red-200 bg-red-50/20" : "border-border/50"}`}
                onClick={() => navigate(`/project/${encodeURIComponent(p.project_name)}`)}
                data-testid={`my-project-${p.project_name}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="text-sm font-semibold leading-snug line-clamp-2">{name}</h4>
                  {p.phase && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{p.phase}</Badge>
                  )}
                </div>
                {isStale && (
                  <div className="flex items-center gap-1 mb-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" data-testid={`stale-warning-${p.project_name}`}>
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>Data may be stale — last import {importDaysAgo}d ago</span>
                  </div>
                )}
                {progress !== null && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Progress</span>
                      <span className={`font-medium ${behind ? "text-red-600" : "text-foreground"}`}>{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${behind ? "bg-red-500" : "bg-blue-500"}`}
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    onClick={(e) => { e.stopPropagation(); navigate(`/project/${encodeURIComponent(p.project_name)}#documents`); }}
                    data-testid={`project-docs-${p.project_name}`}
                  >
                    <FileText className="h-3 w-3" /> Docs
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                    onClick={(e) => { e.stopPropagation(); navigate(`/project/${encodeURIComponent(p.project_name)}#teams`); }}
                    data-testid={`project-teams-${p.project_name}`}
                  >
                    <MessageSquare className="h-3 w-3" /> Teams
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {myProjects.length > 6 && (
          <Link href="/projects">
            <p className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer mt-2 pl-1" data-testid="link-more-projects">
              +{myProjects.length - 6} more project{myProjects.length - 6 > 1 ? "s" : ""}...
            </p>
          </Link>
        )}
      </CardContent>
    </Card>
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2" data-testid="quick-actions">
      {actions.map((action) => {
        const Icon = ICON_MAP[action.icon] || ArrowRight;
        return (
          <button
            key={action.path}
            className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-colors cursor-pointer group"
            onClick={() => navigate(action.path)}
            data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div className="p-2 rounded-md bg-primary/5 group-hover:bg-primary/10 transition-colors">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-[11px] font-medium text-center leading-tight">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const EXCLUDED_PHASES = ["Compliance Handover", "Commercial Close Out", "Closed"];

function PortfolioHealthWidget({ projects }: { projects: ProjectSummary[] }) {
  const [, navigate] = useLocation();
  const [expandedStat, setExpandedStat] = useState<"all" | "ontrack" | "behind" | "avg" | null>(null);

  const activeProjects = projects.filter(p => p.is_active !== false && !EXCLUDED_PHASES.includes(p.phase || ""));
  const totalProjects = activeProjects.length;
  const onTrackProjects = activeProjects.filter(p => {
    const delta = (p.delta_vs_expected ?? 0);
    return delta > -0.05;
  });
  const behindProjects = activeProjects.filter(p => (p.delta_vs_expected ?? 0) <= -0.05);
  const avgCompletion = totalProjects > 0
    ? activeProjects.reduce((s, p) => s + (p.project_pct_complete ?? 0), 0) / totalProjects
    : 0;

  const phases: Record<string, number> = {};
  for (const p of activeProjects) {
    const phase = p.phase || "Unknown";
    phases[phase] = (phases[phase] || 0) + 1;
  }
  const topPhases = Object.entries(phases).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const toggleStat = (stat: "all" | "ontrack" | "behind" | "avg") => {
    setExpandedStat(prev => prev === stat ? null : stat);
  };

  const detailProjects = useMemo(() => {
    if (!expandedStat) return [];
    let list: ProjectSummary[];
    switch (expandedStat) {
      case "all": list = activeProjects; break;
      case "ontrack": list = onTrackProjects; break;
      case "behind": list = behindProjects; break;
      case "avg": list = [...activeProjects].sort((a, b) => (b.project_pct_complete ?? 0) - (a.project_pct_complete ?? 0)); break;
      default: list = [];
    }
    return list.slice(0, 15);
  }, [expandedStat, activeProjects, onTrackProjects, behindProjects]);

  const detailTitle = expandedStat === "all" ? "Active Projects" : expandedStat === "ontrack" ? "On Track Projects" : expandedStat === "behind" ? "Projects Behind Plan" : expandedStat === "avg" ? "Projects by Completion" : "";

  return (
    <Card className="shadow-sm" data-testid="portfolio-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-blue-500" />
          Portfolio Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <button
            className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${expandedStat === "all" ? "ring-2 ring-blue-400 bg-blue-100 dark:bg-blue-900/50" : "bg-blue-50 dark:bg-blue-950/30"}`}
            onClick={() => toggleStat("all")}
            aria-label={`View ${totalProjects} active projects`}
            aria-expanded={expandedStat === "all"}
            data-testid="portfolio-total-btn"
          >
            <div className="text-xl font-bold text-blue-700 dark:text-blue-400" data-testid="portfolio-total">{totalProjects}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Active Projects</div>
          </button>
          <button
            className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none ${expandedStat === "ontrack" ? "ring-2 ring-emerald-400 bg-emerald-100 dark:bg-emerald-900/50" : "bg-emerald-50 dark:bg-emerald-950/30"}`}
            onClick={() => toggleStat("ontrack")}
            aria-label={`View ${onTrackProjects.length} on-track projects`}
            aria-expanded={expandedStat === "ontrack"}
            data-testid="portfolio-on-track-btn"
          >
            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400" data-testid="portfolio-on-track">{onTrackProjects.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase">On Track</div>
          </button>
          <button
            className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-red-300 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none ${expandedStat === "behind" ? "ring-2 ring-red-400 bg-red-100 dark:bg-red-900/50" : "bg-red-50 dark:bg-red-950/30"}`}
            onClick={() => toggleStat("behind")}
            aria-label={`View ${behindProjects.length} projects behind plan`}
            aria-expanded={expandedStat === "behind"}
            data-testid="portfolio-behind-btn"
          >
            <div className="text-xl font-bold text-red-700 dark:text-red-400" data-testid="portfolio-behind">{behindProjects.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Behind Plan</div>
          </button>
          <button
            className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-purple-300 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:outline-none ${expandedStat === "avg" ? "ring-2 ring-purple-400 bg-purple-100 dark:bg-purple-900/50" : "bg-purple-50 dark:bg-purple-950/30"}`}
            onClick={() => toggleStat("avg")}
            aria-label={`View projects by completion, average ${Math.round(avgCompletion * 100)}%`}
            aria-expanded={expandedStat === "avg"}
            data-testid="portfolio-avg-btn"
          >
            <div className="text-xl font-bold text-purple-700 dark:text-purple-400" data-testid="portfolio-avg">{Math.round(avgCompletion * 100)}%</div>
            <div className="text-[10px] text-muted-foreground uppercase">Avg Completion</div>
          </button>
        </div>

        {expandedStat && detailProjects.length > 0 && (
          <div className="mb-4 border rounded-lg overflow-hidden animate-in slide-in-from-top-2 duration-200" data-testid="portfolio-detail-panel">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-semibold text-muted-foreground">{detailTitle}</span>
              <button
                onClick={() => setExpandedStat(null)}
                className="text-muted-foreground hover:text-foreground p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none transition-colors duration-200"
                aria-label="Close detail panel"
                data-testid="btn-close-portfolio-detail"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y max-h-[280px] overflow-y-auto" aria-label={detailTitle}>
              {detailProjects.map(p => {
                const pct = Math.round((p.project_pct_complete ?? 0) * 100);
                const delta = Math.round((p.delta_vs_expected ?? 0) * 100);
                if (!p.project_name) return null;
                return (
                  <div
                    key={p.project_name}
                    role="button"
                    tabIndex={0}
                    aria-label={`${cleanProjectName(p.project_name)}, ${pct}% complete. Click to view project.`}
                    className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] hover:bg-muted/30 cursor-pointer transition-colors duration-200 ease-out focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    onClick={() => navigate(`/project/${encodeURIComponent(p.project_name)}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/project/${encodeURIComponent(p.project_name)}`); } }}
                    data-testid={`portfolio-detail-${p.project_name}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cleanProjectName(p.project_name)}</p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {p.phase && <span>{p.phase}</span>}
                        {p.pm && <span>PM: {p.pm}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 90 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums w-8 text-right">{pct}%</span>
                      {delta !== 0 && (
                        <Badge className={`text-[9px] px-1 py-0 ${delta >= 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                          {delta > 0 ? "+" : ""}{delta}%
                        </Badge>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
            {(expandedStat === "all" ? activeProjects : expandedStat === "ontrack" ? onTrackProjects : expandedStat === "behind" ? behindProjects : activeProjects).length > 15 && (
              <div className="px-3 py-2 bg-muted/30 border-t text-center">
                <span className="text-[10px] text-muted-foreground">
                  Showing 15 of {(expandedStat === "all" ? activeProjects : expandedStat === "ontrack" ? onTrackProjects : expandedStat === "behind" ? behindProjects : activeProjects).length}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {topPhases.map(([phase, count]) => (
            <Badge key={phase} variant="outline" className="text-[10px] gap-1">
              {phase} <span className="font-bold">{count}</span>
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FinancialHeadlineWidget({ projects }: { projects: ProjectSummary[] }) {
  const [, navigate] = useLocation();
  const [expandedStat, setExpandedStat] = useState<"revenue" | "expenses" | "gp" | "gpmargin" | "outstanding" | "due" | null>(null);
  const { data: fyData, isLoading } = useQuery<{
    fyLabel: string;
    totalRevenue: number;
    totalExpenses: number;
    grossProfit: number;
    gpMargin: number;
    revenueOutstanding: number;
    expensesDue: number;
    revenueOverdue: number;
    expensesOverdue: number;
  }>({
    queryKey: ["/api/financial-headline"],
  });

  const fmt = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `R${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `R${(v / 1_000).toFixed(0)}K`;
    return `R${v.toFixed(0)}`;
  };

  const totalRevenue = fyData?.totalRevenue ?? 0;
  const totalExpenses = fyData?.totalExpenses ?? 0;
  const grossProfit = fyData?.grossProfit ?? 0;
  const gpPercent = fyData?.gpMargin ?? 0;
  const revenueOutstanding = fyData?.revenueOutstanding ?? 0;
  const expensesDue = fyData?.expensesDue ?? 0;
  const revenueOverdue = fyData?.revenueOverdue ?? 0;
  const expensesOverdue = fyData?.expensesOverdue ?? 0;
  const fyLabel = fyData?.fyLabel ?? "FY";

  const activeProjects = useMemo(() => projects.filter(p => p.is_active !== false), [projects]);

  const toggleStat = (stat: typeof expandedStat) => {
    setExpandedStat(prev => prev === stat ? null : stat);
  };

  const detailProjects = useMemo(() => {
    if (!expandedStat) return [];
    let list: ProjectSummary[];
    switch (expandedStat) {
      case "revenue":
        list = [...activeProjects].filter(p => (p.actual_revenue ?? 0) > 0).sort((a, b) => (b.actual_revenue ?? 0) - (a.actual_revenue ?? 0));
        break;
      case "expenses":
        list = [...activeProjects].filter(p => (p.actual_expenses ?? 0) > 0).sort((a, b) => (b.actual_expenses ?? 0) - (a.actual_expenses ?? 0));
        break;
      case "gp":
      case "gpmargin":
        list = [...activeProjects].filter(p => p.gp_percent !== null && p.gp_percent !== undefined).sort((a, b) => (a.gp_percent ?? 0) - (b.gp_percent ?? 0));
        break;
      case "outstanding":
        list = [...activeProjects].filter(p => (p.revenue_outstanding ?? 0) > 0).sort((a, b) => (b.revenue_outstanding ?? 0) - (a.revenue_outstanding ?? 0));
        break;
      case "due":
        list = [...activeProjects].filter(p => (p.expenses_due ?? 0) > 0).sort((a, b) => (b.expenses_due ?? 0) - (a.expenses_due ?? 0));
        break;
      default: list = [];
    }
    return list.slice(0, 15);
  }, [expandedStat, activeProjects]);

  const detailConfig = {
    revenue: { title: "Projects with Revenue", valueKey: "actual_revenue" as const, label: "Revenue" },
    expenses: { title: "Projects with Expenses", valueKey: "actual_expenses" as const, label: "Expenses" },
    gp: { title: "Projects by Gross Profit", valueKey: "gp_percent" as const, label: "GP%" },
    gpmargin: { title: "Projects by GP Margin", valueKey: "gp_percent" as const, label: "GP%" },
    outstanding: { title: "Revenue Outstanding", valueKey: "revenue_outstanding" as const, label: "Outstanding" },
    due: { title: "Expenses Due", valueKey: "expenses_due" as const, label: "Due" },
  };

  return (
    <Card className="shadow-sm" data-testid="financial-headline">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-500" />
          Financial Headline
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 normal-case tracking-normal">{fyLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-5 w-5 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <button
              className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none ${expandedStat === "revenue" ? "ring-2 ring-emerald-400 bg-emerald-100 dark:bg-emerald-900/50" : "bg-emerald-50 dark:bg-emerald-950/30"}`}
              onClick={() => toggleStat("revenue")}
              aria-label={`View total revenue ${fmt(totalRevenue)}`}
              aria-expanded={expandedStat === "revenue"}
              data-testid="fin-revenue-btn"
            >
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400" data-testid="fin-revenue">{fmt(totalRevenue)}</div>
              <div className="text-[10px] text-muted-foreground uppercase">Total Revenue</div>
            </button>
            <button
              className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${expandedStat === "expenses" ? "ring-2 ring-blue-400 bg-blue-100 dark:bg-blue-900/50" : "bg-blue-50 dark:bg-blue-950/30"}`}
              onClick={() => toggleStat("expenses")}
              aria-label={`View total expenses ${fmt(totalExpenses)}`}
              aria-expanded={expandedStat === "expenses"}
              data-testid="fin-expenses-btn"
            >
              <div className="text-lg font-bold text-blue-700 dark:text-blue-400" data-testid="fin-expenses">{fmt(totalExpenses)}</div>
              <div className="text-[10px] text-muted-foreground uppercase">Total Expenses</div>
            </button>
            <button
              className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-purple-300 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:outline-none ${expandedStat === "gp" ? "ring-2 ring-purple-400 bg-purple-100 dark:bg-purple-900/50" : "bg-purple-50 dark:bg-purple-950/30"}`}
              onClick={() => toggleStat("gp")}
              aria-label={`View gross profit ${fmt(grossProfit)}`}
              aria-expanded={expandedStat === "gp"}
              data-testid="fin-gp-btn"
            >
              <div className={`text-lg font-bold ${grossProfit >= 0 ? "text-purple-700 dark:text-purple-400" : "text-red-600"}`} data-testid="fin-gp">{fmt(grossProfit)}</div>
              <div className="text-[10px] text-muted-foreground uppercase">Gross Profit</div>
            </button>
            <button
              className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-amber-300 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none ${expandedStat === "gpmargin" ? "ring-2 ring-amber-400 bg-amber-100 dark:bg-amber-900/50" : "bg-amber-50 dark:bg-amber-950/30"}`}
              onClick={() => toggleStat("gpmargin")}
              aria-label={`View GP margin ${gpPercent.toFixed(1)}%`}
              aria-expanded={expandedStat === "gpmargin"}
              data-testid="fin-gp-pct-btn"
            >
              <div className={`text-lg font-bold ${gpPercent >= 15 ? "text-amber-700 dark:text-amber-400" : "text-red-600"}`} data-testid="fin-gp-pct">{gpPercent.toFixed(1)}%</div>
              <div className="text-[10px] text-muted-foreground uppercase">GP Margin</div>
            </button>
            <button
              className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-orange-300 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:outline-none ${expandedStat === "outstanding" ? "ring-2 ring-orange-400 bg-orange-100 dark:bg-orange-900/50" : "bg-orange-50 dark:bg-orange-950/30"}`}
              onClick={() => toggleStat("outstanding")}
              aria-label={`View revenue outstanding ${fmt(revenueOutstanding)}`}
              aria-expanded={expandedStat === "outstanding"}
              data-testid="fin-outstanding-btn"
            >
              <div className="text-lg font-bold text-orange-700 dark:text-orange-400" data-testid="fin-outstanding">{fmt(revenueOutstanding)}</div>
              <div className="text-[10px] text-muted-foreground uppercase">Rev Outstanding</div>
              {revenueOverdue > 0 && (
                <div className="text-[9px] font-semibold text-red-600 mt-0.5" data-testid="fin-rev-overdue">{fmt(revenueOverdue)} overdue</div>
              )}
            </button>
            <button
              className={`text-center p-3 min-h-[44px] rounded-lg transition-all duration-200 ease-out cursor-pointer hover:ring-2 hover:ring-red-300 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none ${expandedStat === "due" ? "ring-2 ring-red-400 bg-red-100 dark:bg-red-900/50" : "bg-red-50 dark:bg-red-950/30"}`}
              onClick={() => toggleStat("due")}
              aria-label={`View expenses due ${fmt(expensesDue)}`}
              aria-expanded={expandedStat === "due"}
              data-testid="fin-due-btn"
            >
              <div className="text-lg font-bold text-red-700 dark:text-red-400" data-testid="fin-due">{fmt(expensesDue)}</div>
              <div className="text-[10px] text-muted-foreground uppercase">Expenses Due</div>
              {expensesOverdue > 0 && (
                <div className="text-[9px] font-semibold text-red-600 mt-0.5" data-testid="fin-exp-overdue">{fmt(expensesOverdue)} overdue</div>
              )}
            </button>
          </div>
        )}

        {expandedStat && detailProjects.length > 0 && (
          <div className="mt-4 border rounded-lg overflow-hidden animate-in slide-in-from-top-2 duration-200" data-testid="financial-detail-panel">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-semibold text-muted-foreground">{detailConfig[expandedStat].title}</span>
              <button
                onClick={() => setExpandedStat(null)}
                className="text-muted-foreground hover:text-foreground p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none transition-colors duration-200"
                aria-label="Close financial detail panel"
                data-testid="btn-close-financial-detail"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y max-h-[280px] overflow-y-auto" aria-label={detailConfig[expandedStat].title}>
              {detailProjects.map(p => {
                const valueKey = detailConfig[expandedStat].valueKey;
                const value = (p as any)[valueKey] ?? 0;
                const isPercent = valueKey === "gp_percent";
                if (!p.project_name) return null;
                return (
                  <div
                    key={p.project_name}
                    role="button"
                    tabIndex={0}
                    aria-label={`${cleanProjectName(p.project_name)}, ${isPercent ? value.toFixed(1) + "%" : fmt(value)}. Click to view project.`}
                    className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] hover:bg-muted/30 cursor-pointer transition-colors duration-200 ease-out focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    onClick={() => navigate(`/project/${encodeURIComponent(p.project_name)}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/project/${encodeURIComponent(p.project_name)}`); } }}
                    data-testid={`fin-detail-${p.project_name}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cleanProjectName(p.project_name)}</p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {p.phase && <span>{p.phase}</span>}
                        {p.pm && <span>PM: {p.pm}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`text-sm font-bold tabular-nums ${isPercent ? (value >= 15 ? "text-emerald-600" : value >= 0 ? "text-amber-600" : "text-red-600") : "text-foreground"}`}>
                        {isPercent ? `${value.toFixed(1)}%` : fmt(value)}
                      </span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleRiskWidget({ projects }: { projects: ProjectSummary[] }) {
  const [, navigate] = useLocation();
  const atRisk = useMemo(() => {
    return projects
      .filter(p => p.is_active !== false && (p.delta_vs_expected ?? 0) < -0.05)
      .sort((a, b) => (a.delta_vs_expected ?? 0) - (b.delta_vs_expected ?? 0))
      .slice(0, 8);
  }, [projects]);

  if (atRisk.length === 0) return null;

  return (
    <Card className="shadow-sm border-l-4 border-l-red-400" data-testid="schedule-risk">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <TrendingDownIcon className="h-4 w-4 text-red-500" />
            Schedule Risk
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{atRisk.length}</Badge>
          </CardTitle>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-view-execution">
              Execution Board <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {atRisk.map(p => {
            const slippage = Math.abs(Math.round((p.delta_vs_expected ?? 0) * 100));
            const progress = Math.round((p.project_pct_complete ?? 0) * 100);
            return (
              <div
                key={p.project_name}
                className="flex items-center gap-3 p-2 rounded-lg border border-red-100 dark:border-red-900/30 bg-red-50/30 dark:bg-red-950/10 cursor-pointer hover:bg-red-50 transition-colors"
                onClick={() => navigate(`/project/${encodeURIComponent(p.project_name)}`)}
                data-testid={`risk-project-${p.project_name}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{cleanProjectName(p.project_name)}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{p.phase}</span>
                    <span>{progress}% complete</span>
                  </div>
                </div>
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
                  -{slippage}% behind
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function AlertsWidget({ projects }: { projects: ProjectSummary[] }) {
  const activeProjects = projects.filter(p => p.is_active !== false);

  const [, navigate] = useLocation();

  const alerts = useMemo(() => {
    const result: Array<{ id: string; type: "stale" | "behind" | "overrun" | "missing"; title: string; detail: string; severity: "red" | "amber"; projectName: string }> = [];

    for (const p of activeProjects) {
      const importDaysAgo = p.last_import_at
        ? Math.floor((Date.now() - new Date(p.last_import_at).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      if (importDaysAgo !== null && importDaysAgo > 14) {
        result.push({
          id: `stale-${p.project_name}`,
          type: "stale",
          title: `${cleanProjectName(p.project_name)} — Stale Data`,
          detail: `Last import ${importDaysAgo} days ago`,
          severity: importDaysAgo > 30 ? "red" : "amber",
          projectName: p.project_name,
        });
      }

      if ((p.delta_vs_expected ?? 0) < -0.15) {
        result.push({
          id: `behind-${p.project_name}`,
          type: "behind",
          title: `${cleanProjectName(p.project_name)} — Significantly Behind`,
          detail: `${Math.abs(Math.round((p.delta_vs_expected ?? 0) * 100))}% behind expected`,
          severity: "red",
          projectName: p.project_name,
        });
      }

      if ((p.gp_percent ?? 1) < 0) {
        result.push({
          id: `overrun-${p.project_name}`,
          type: "overrun",
          title: `${cleanProjectName(p.project_name)} — Budget Overrun`,
          detail: `GP margin: ${((p.gp_percent ?? 0) * 100).toFixed(1)}%`,
          severity: "red",
          projectName: p.project_name,
        });
      }
    }

    result.sort((a, b) => (a.severity === "red" ? 0 : 1) - (b.severity === "red" ? 0 : 1));
    return result.slice(0, 10);
  }, [activeProjects]);

  if (alerts.length === 0) return null;

  const iconMap = { stale: DatabaseZap, behind: TrendingDownIcon, overrun: DollarSign, missing: AlertTriangle };

  return (
    <Card className="shadow-sm" data-testid="alerts-widget">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Alerts
          <Badge className="text-[10px] px-1.5 py-0 bg-amber-600">{alerts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {alerts.map(alert => {
            const Icon = iconMap[alert.type];
            return (
              <div
                key={alert.id}
                role="button"
                tabIndex={0}
                className={`flex items-center gap-2.5 p-3 min-h-[44px] rounded-lg border text-sm cursor-pointer transition-colors duration-200 ease-out hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  alert.severity === "red"
                    ? "border-red-200 bg-red-50/30 dark:border-red-900/30 dark:bg-red-950/10 hover:bg-red-50 dark:hover:bg-red-950/20"
                    : "border-amber-200 bg-amber-50/30 dark:border-amber-900/30 dark:bg-amber-950/10 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                }`}
                onClick={() => navigate(`/project/${encodeURIComponent(alert.projectName)}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/project/${encodeURIComponent(alert.projectName)}`); } }}
                aria-label={`${alert.title}: ${alert.detail}. Click to view project.`}
                data-testid={`alert-${alert.id}`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${alert.severity === "red" ? "text-red-500" : "text-amber-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs truncate">{alert.title}</p>
                  <p className="text-[11px] text-muted-foreground">{alert.detail}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DataHealthWidget({ projects }: { projects: ProjectSummary[] }) {
  const activeProjects = projects.filter(p => p.is_active !== false);

  const stats = useMemo(() => {
    let staleCount = 0;
    let neverImported = 0;
    let freshCount = 0;
    let oldestStale: { name: string; days: number } | null = null;

    for (const p of activeProjects) {
      if (!p.last_import_at) {
        neverImported++;
        continue;
      }
      const daysAgo = Math.floor((Date.now() - new Date(p.last_import_at).getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo > 14) {
        staleCount++;
        if (!oldestStale || daysAgo > oldestStale.days) {
          oldestStale = { name: cleanProjectName(p.project_name), days: daysAgo };
        }
      } else {
        freshCount++;
      }
    }

    return { staleCount, neverImported, freshCount, total: activeProjects.length, oldestStale };
  }, [activeProjects]);

  return (
    <Card className="shadow-sm" data-testid="data-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <DatabaseZap className="h-4 w-4 text-blue-500" />
          Data Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400" data-testid="data-fresh">{stats.freshCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Fresh</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <div className="text-lg font-bold text-amber-700 dark:text-amber-400" data-testid="data-stale">{stats.staleCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Stale (&gt;14d)</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
            <div className="text-lg font-bold text-red-700 dark:text-red-400" data-testid="data-never">{stats.neverImported}</div>
            <div className="text-[10px] text-muted-foreground uppercase">No Import</div>
          </div>
        </div>
        {stats.oldestStale && (
          <p className="text-[11px] text-muted-foreground">
            Oldest stale: <span className="font-medium">{stats.oldestStale.name}</span> ({stats.oldestStale.days}d ago)
          </p>
        )}
        <Link href="/smart-import">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 mt-2 w-full" data-testid="button-smart-import">
            <FileSpreadsheet className="h-3 w-3" /> Go to Smart Import
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function QualityOverviewWidget() {
  const { data: checklists = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/quality/checklists"],
    queryFn: async () => {
      const res = await fetch("/api/quality/checklists", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 120000,
  });

  const { data: warnings = [] } = useQuery<any[]>({
    queryKey: ["/api/quality/warnings", "open"],
    queryFn: async () => {
      const res = await fetch("/api/quality/warnings?status=open", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 120000,
  });

  if (isLoading) return null;

  const totalProjects = checklists.length;
  const completedCount = checklists.filter((c: any) => c.overallProgress >= 100).length;
  const warningCount = warnings.length;

  return (
    <Card className="shadow-sm" data-testid="quality-overview">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Quality Overview
          </CardTitle>
          <Link href="/quality">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-view-quality">
              Dashboard <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30">
            <div className="text-lg font-bold text-blue-700 dark:text-blue-400" data-testid="quality-total">{totalProjects}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Checklists</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400" data-testid="quality-complete">{completedCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Complete</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <div className="text-lg font-bold text-amber-700 dark:text-amber-400" data-testid="quality-warnings">{warningCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Warnings</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EngineeringQueueWidget() {
  const { data: standup, isLoading } = useQuery<any>({
    queryKey: ["/api/eng/dashboard/standup"],
    queryFn: async () => {
      const res = await fetch("/api/eng/dashboard/standup", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 120000,
  });

  if (isLoading || !standup) return null;

  return (
    <Card className="shadow-sm" data-testid="engineering-queue">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <HardHat className="h-4 w-4 text-orange-500" />
            Engineering Queue
          </CardTitle>
          <Link href="/engineering/tasks">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-view-eng-tasks">
              Task Board <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30">
            <div className="text-lg font-bold text-blue-700 dark:text-blue-400" data-testid="eng-active">{standup?.kpis?.activeTasks ?? 0}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Active</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
            <div className="text-lg font-bold text-red-700 dark:text-red-400" data-testid="eng-overdue">{standup?.kpis?.overdueTasks ?? 0}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Overdue</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30">
            <div className="text-lg font-bold text-purple-700 dark:text-purple-400" data-testid="eng-approvals">{standup?.kpis?.needsApproval ?? 0}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Approvals</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400" data-testid="eng-done">{standup?.kpis?.doneRecently ?? 0}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Done (24h)</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface WidgetConfig {
  widgetOrder: string[];
  hiddenWidgets: string[];
}

function WidgetConfigPanel({
  config,
  onSave,
  onClose,
  allowedWidgets,
}: {
  config: WidgetConfig;
  onSave: (config: WidgetConfig) => void;
  onClose: () => void;
  allowedWidgets?: Set<string>;
}) {
  const [order, setOrder] = useState<string[]>(() => {
    if (!allowedWidgets) return [...config.widgetOrder];
    return config.widgetOrder.filter(w => allowedWidgets.has(w));
  });
  const [hidden, setHidden] = useState<string[]>([...config.hiddenWidgets]);

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...order];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setOrder(newOrder);
  };

  const moveDown = (index: number) => {
    if (index >= order.length - 1) return;
    const newOrder = [...order];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setOrder(newOrder);
  };

  const toggleVisibility = (widgetId: string) => {
    setHidden(prev =>
      prev.includes(widgetId) ? prev.filter(h => h !== widgetId) : [...prev, widgetId]
    );
  };

  const resetDefaults = () => {
    const defaults = [...DEFAULT_WIDGET_ORDER] as string[];
    setOrder(allowedWidgets ? defaults.filter(w => allowedWidgets.has(w)) : defaults);
    setHidden([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="widget-config-overlay">
      <Card className="w-full max-w-md mx-4 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Customise Dashboard</CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} data-testid="widget-config-close">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 pb-4">
          <p className="text-xs text-muted-foreground mb-4">Drag widgets to reorder, or toggle them on and off.</p>
          <div className="space-y-1">
            {order.map((widgetId, index) => {
              const def = WIDGET_DEFINITIONS[widgetId];
              if (!def) return null;
              const isHidden = hidden.includes(widgetId);
              return (
                <div
                  key={widgetId}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${isHidden ? "bg-muted/50 opacity-60" : "bg-background"}`}
                  data-testid={`widget-item-${widgetId}`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{def.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{def.description}</div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      data-testid={`widget-up-${widgetId}`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => moveDown(index)}
                      disabled={index === order.length - 1}
                      data-testid={`widget-down-${widgetId}`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Switch
                      checked={!isHidden}
                      onCheckedChange={() => toggleVisibility(widgetId)}
                      data-testid={`widget-toggle-${widgetId}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
        <div className="border-t px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={resetDefaults} className="text-xs gap-1" data-testid="widget-reset">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} data-testid="widget-cancel">Cancel</Button>
            <Button size="sm" onClick={() => onSave({ widgetOrder: order, hiddenWidgets: hidden })} data-testid="widget-save">
              Save Layout
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function Home() {
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const canEdit = isAdmin || (companyRole && ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO"].includes(companyRole));
  const { toast } = useToast();
  const tutorial = useInteractiveTutorial();
  const [showWidgetConfig, setShowWidgetConfig] = useState(false);

  const { data: widgetConfig } = useQuery<WidgetConfig>({
    queryKey: ["dashboard-widget-config"],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const token = localStorage.getItem('auth_token');
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/dashboard/widget-config", { credentials: "include", headers });
      if (!res.ok) return { widgetOrder: [...DEFAULT_WIDGET_ORDER], hiddenWidgets: [] };
      return res.json();
    },
    staleTime: 300_000,
  });

  const saveWidgetConfigMutation = useMutation({
    mutationFn: async (config: WidgetConfig) => {
      await apiRequest("PUT", "/api/dashboard/widget-config", config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-widget-config"] });
      setShowWidgetConfig(false);
      toast({ title: "Layout saved", description: "Your dashboard layout has been updated." });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save your layout. Please try again.", variant: "destructive" });
    },
  });

  const roleWidgets = useMemo(() => {
    const role = companyRole || user?.role || "";
    return new Set(getWidgetsForRole(role));
  }, [companyRole, user?.role]);

  const activeWidgetOrder = useMemo(() => {
    const order = widgetConfig?.widgetOrder || [...DEFAULT_WIDGET_ORDER];
    const hidden = new Set(widgetConfig?.hiddenWidgets || []);
    return order.filter(w => !hidden.has(w) && roleWidgets.has(w));
  }, [widgetConfig, roleWidgets]);

  useEffect(() => {
    if (user && !tutorial.completed) {
      const timer = setTimeout(() => tutorial.start(), 1200);
      return () => clearTimeout(timer);
    }
  }, [user, tutorial.completed]);

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

  const { data: allProjects = [], isLoading: projectsLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["/api/projects-summary"],
    staleTime: 120000,
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

  const renderWidget = useCallback((widgetId: string) => {
    switch (widgetId) {
      case "quick_actions":
        return <QuickActionsWidget key="quick_actions" role={userRole} />;

      case "my_projects":
        return user?.name ? <MyProjectsHub key="my_projects" projects={allProjects} userName={user.name} /> : null;

      case "company_priorities":
        return <CompanyPrioritiesCards key="company_priorities" isAdmin={!!canEdit} priorities={priorities} isLoading={prioritiesLoading} />;

      case "portfolio_health":
        return allProjects.length > 0 ? <PortfolioHealthWidget key="portfolio_health" projects={allProjects} /> : null;

      case "financial_headline":
        return allProjects.length > 0 ? <FinancialHeadlineWidget key="financial_headline" projects={allProjects} /> : null;

      case "alerts":
        return allProjects.length > 0 ? <AlertsWidget key="alerts" projects={allProjects} /> : null;

      case "schedule_risk":
        return allProjects.length > 0 ? <ScheduleRiskWidget key="schedule_risk" projects={allProjects} /> : null;

      case "quality_overview":
        return <QualityOverviewWidget key="quality_overview" />;

      case "engineering_queue":
        return <EngineeringQueueWidget key="engineering_queue" />;

      case "data_health":
        return allProjects.length > 0 ? <DataHealthWidget key="data_health" projects={allProjects} /> : null;

      case "action_banner":
        if (!hub || !hasActions) return null;
        return (
          <div key="action_banner" className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-center gap-3" data-testid="action-banner">
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
        );

      case "priority_queue":
        return hub ? <PriorityQueue key="priority_queue" hub={hub} /> : null;

      case "stat_cards":
        if (!hub) return null;
        return (
          <div key="stat_cards" className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="stat-cards">
            <StatCard icon={Bell} label="Unread Notifications" value={hub.unreadCount} color="bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400" href="/notifications" testId="stat-unread" />
            <StatCard icon={ListTodo} label="My Open Tasks" value={hub.myTasks.length} color="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400" href="/engineering" testId="stat-tasks" />
            <StatCard icon={ClipboardCheck} label="Pending Approvals" value={hub.approvalCounts.total} color="bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400" href="/approvals" testId="stat-approvals" />
            <StatCard icon={AlertTriangle} label="Overdue Tasks" value={hub.overdueTaskCount} color={hub.overdueTaskCount > 0 ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400"} href="/engineering" testId="stat-overdue" />
          </div>
        );

      case "my_tasks":
        if (!hub || hub.myTasks.length === 0) return null;
        return (
          <Card key="my_tasks" className="shadow-sm" data-testid="card-my-tasks">
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
                {hub.myTasks.map(task => <TaskItem key={task.id} task={task} />)}
              </div>
            </CardContent>
          </Card>
        );

      case "pending_approvals":
        if (!hub || hub.approvalCounts.total === 0) return null;
        return (
          <Card key="pending_approvals" className="shadow-sm" data-testid="card-approvals">
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
                  <Badge variant="outline" className="text-[11px] gap-1"><Wrench className="w-3 h-3" />{hub.approvalCounts.engineering} Engineering</Badge>
                )}
                {hub.approvalCounts.quality > 0 && (
                  <Badge variant="outline" className="text-[11px] gap-1"><Shield className="w-3 h-3" />{hub.approvalCounts.quality} Quality</Badge>
                )}
                {hub.approvalCounts.deliverable > 0 && (
                  <Badge variant="outline" className="text-[11px] gap-1"><FileCheck className="w-3 h-3" />{hub.approvalCounts.deliverable} Deliverable</Badge>
                )}
                {hub.approvalCounts.taskDeliverable > 0 && (
                  <Badge variant="outline" className="text-[11px] gap-1 border-orange-300 text-orange-700"><FileCheck className="w-3 h-3" />{hub.approvalCounts.taskDeliverable} Pending Acknowledgment</Badge>
                )}
              </div>
              <div className="space-y-2">
                {hub.pendingApprovals.map(approval => <ApprovalItem key={approval.id} approval={approval} />)}
              </div>
            </CardContent>
          </Card>
        );

      case "notifications":
        if (!hub || (hub.actionRequired.length === 0 && hub.recentNotifications.length === 0)) return null;
        return (
          <Card key="notifications" className="shadow-sm" data-testid="card-notifications">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Bell className="h-4 w-4 text-blue-500" />
                  Notifications
                  {hub.unreadCount > 0 && <Badge className="text-[10px] px-1.5 py-0 bg-blue-600">{hub.unreadCount}</Badge>}
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
                      <NotificationItem key={notif.id} notif={notif} onMarkRead={(id) => markReadMutation.mutate([id])} />
                    ))}
                    {hub.actionRequired.length > 4 && (
                      <Link href="/notifications">
                        <p className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer pl-1">+{hub.actionRequired.length - 4} more actions required...</p>
                      </Link>
                    )}
                  </>
                )}
                {hub.actionRequired.length === 0 && hub.recentNotifications.map(notif => (
                  <NotificationItem key={notif.id} notif={notif} onMarkRead={(id) => markReadMutation.mutate([id])} />
                ))}
                {hub.actionRequired.length > 0 && hub.recentNotifications.length > 0 && (
                  <>
                    <div className="border-t border-border/50 pt-2 mt-2">
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2">Recent</p>
                    </div>
                    {hub.recentNotifications
                      .filter(n => !hub.actionRequired.some((a: any) => a.id === n.id))
                      .slice(0, 3)
                      .map(notif => <NotificationItem key={notif.id} notif={notif} onMarkRead={(id) => markReadMutation.mutate([id])} />)}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  }, [hub, hasActions, user, allProjects, canEdit, priorities, prioritiesLoading, markReadMutation, userRole]);

  const gridWidgets = ["my_tasks", "pending_approvals", "notifications", "quality_overview", "engineering_queue", "data_health"];
  const gridItems = activeWidgetOrder.filter(w => gridWidgets.includes(w));
  const topWidgets = activeWidgetOrder.filter(w => !gridWidgets.includes(w));
  const hasAnyGridContent = gridItems.length > 0 && (hub || gridItems.some(w => ["quality_overview", "engineering_queue", "data_health"].includes(w)));
  const allClear = hub && hub.myTasks.length === 0 && hub.approvalCounts.total === 0 && hub.recentNotifications.length === 0;

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setShowWidgetConfig(true)}
            data-testid="button-customise-dashboard"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Customise
          </Button>
          {tutorial.completed && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => { tutorial.reset(); tutorial.start(); }}
              data-testid="button-replay-tour"
            >
              <Compass className="h-3.5 w-3.5" />
              Take a Tour
            </Button>
          )}
        </div>
      </div>

      {(() => {
        try {
          const stored = localStorage.getItem("last_visited_project");
          if (stored) {
            const { name } = JSON.parse(stored);
            if (name && allProjects.some(p => p.project_name === name)) {
              return (
                <button
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                  onClick={() => navigate(`/project/${encodeURIComponent(name)}`)}
                  data-testid="link-last-visited-project"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  <span>Continue with <span className="font-medium">{cleanProjectName(name)}</span></span>
                  <ChevronRight className="h-3 w-3" />
                </button>
              );
            }
          }
        } catch {}
        return null;
      })()}

      <ProjectQuickSearch projects={allProjects} isLoading={projectsLoading} />

      {hubLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {topWidgets.map(w => renderWidget(w))}

          {gridItems.length > 0 && hasAnyGridContent && (
            <div className="grid gap-5 lg:grid-cols-2">
              {gridItems.map(w => renderWidget(w))}
              {allClear && (
                <Card className="shadow-sm lg:col-span-2" data-testid="card-all-clear">
                  <CardContent className="flex flex-col items-center justify-center py-10">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
                    <h3 className="font-semibold text-lg">You're all caught up</h3>
                    <p className="text-sm text-muted-foreground mt-1">No pending tasks, approvals, or notifications right now.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {showWidgetConfig && widgetConfig && (
        <WidgetConfigPanel
          config={widgetConfig}
          onSave={(cfg) => saveWidgetConfigMutation.mutate(cfg)}
          onClose={() => setShowWidgetConfig(false)}
          allowedWidgets={roleWidgets}
        />
      )}

      <InteractiveTutorial active={tutorial.active} onComplete={tutorial.stop} role={userRole} />

      <DataSourceDebug
        pageName="Home"
        dataSources={[
          { endpoint: "/api/action-hub", tables: ["notifications", "engineering_tasks", "project_plan_tasks", "approvals"], description: "Notifications, tasks, approvals hub" },
          { endpoint: "/api/company-priorities", tables: ["company_priorities", "company_priority_links"], description: "Company-wide priorities" },
          { endpoint: "/api/projects-summary", tables: ["project_info", "normalized_cost_lines", "normalized_revenue_lines", "normalized_plan_tasks"], description: "All projects summary KPIs" },
          { endpoint: "/api/user/widget-config", tables: ["user_widget_configs"], description: "User widget layout preferences" },
        ]}
      />
    </div>
  );
}

import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import {
  Flag,
  Loader2,
  ArrowRight,
  AlertTriangle,
  TrendingDown,
  Clock,
  ChevronRight,
  ExternalLink,
  Users,
  Calendar,
  Target,
} from "lucide-react";

const COMPLIMENTS = [
  "You're making a real difference on these projects!",
  "Your attention to detail keeps everything running smoothly.",
  "The team is lucky to have you driving things forward.",
  "Every project you touch gets better because of your effort.",
  "Your dedication to quality really shows in the results.",
  "You bring great energy to the work — keep it up!",
  "The progress you're making is impressive, well done!",
  "Your problem-solving skills are next level.",
  "You make the complex look easy — that's a rare talent.",
  "Your commitment to excellence inspires the whole team.",
  "Today is going to be a great day — you've got this!",
  "You're not just meeting expectations, you're exceeding them.",
  "Your leadership on these projects is outstanding.",
  "The way you handle challenges is truly impressive.",
  "You're building something great — one step at a time.",
];

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
];

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
  return "border-l-slate-300 dark:border-l-slate-600";
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
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Flag className="h-4 w-4 text-red-500" />
            Company Priorities
          </h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (activePriorities.length === 0 && !isAdmin) return null;

  return (
    <div className="space-y-3" data-testid="company-priorities-section">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Flag className="h-4 w-4 text-red-500" />
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
        <p className="text-sm text-muted-foreground py-4">No active company priorities.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(p => {
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
    </div>
  );
}

export default function Home() {
  const { user, isAdmin } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const canEdit = isAdmin || (companyRole && ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO"].includes(companyRole));

  const isFriday = new Date().getDay() === 5;
  const greetingPool = isFriday ? DAD_JOKES : COMPLIMENTS;
  const compliment = useMemo(() => greetingPool[Math.floor(Math.random() * greetingPool.length)], []);

  const firstName = user?.name ? user.name.split(" ")[0] : "there";

  const { data: priorities = [], isLoading: prioritiesLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  return (
    <div className="space-y-6" data-testid="home-page">
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

      <CompanyPrioritiesCards isAdmin={!!canEdit} priorities={priorities} isLoading={prioritiesLoading} />
    </div>
  );
}

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ClipboardList, Flag, ListChecks } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildMyWorkPreviewItems,
  getPriorityDestination,
  selectHomeCompanyPriorities,
  selectHomeExceptionPreview,
  type CompanyPriority,
  type ExceptionResponse,
} from "@/lib/home-launchpad";
import { formatSouthAfricanDate, getDeterministicRoleQuote, getWelcomeHeading } from "@/lib/home-welcome";

const PREVIEW_REASON_LABELS = {
  overdue: "Overdue",
  blocked: "Blocked",
  dueSoon: "Due soon",
  approval: "Approval",
  next: "Next up",
} as const;

const SEVERITY_TONES = {
  critical: "border-red-200 bg-red-50 text-red-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-slate-200 bg-slate-50 text-slate-700",
} as const;

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function formatDueLabel(value?: string | null) {
  if (!value) return null;
  try {
    return `Due ${format(parseISO(value), "dd MMM")}`;
  } catch {
    return `Due ${value}`;
  }
}

export default function Home() {
  const { user } = useAuth();

  const { data: companyPriorities = [], error: companyPrioritiesError, refetch: refetchCompanyPriorities, isFetching: prioritiesFetching } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities?horizon=week", "home"],
    queryFn: async () => {
      const res = await fetch("/api/mytool/company-priorities?horizon=week", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load company priorities.");
      return res.json();
    },
  });

  const { data: exceptionResponse, error: exceptionError, refetch: refetchExceptions, isFetching: exceptionsFetching } = useQuery<ExceptionResponse>({
    queryKey: ["/api/exceptions", "home"],
    queryFn: async () => {
      const res = await fetch("/api/exceptions", {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Could not load exception focus.");
      return res.json();
    },
  });

  const { data: allTaskData, error: myWorkError, refetch: refetchMyWork, isFetching: myWorkFetching } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks", "home"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Could not load My Work preview.");
      return res.json();
    },
  });

  const filteredPriorities = useMemo(() => {
    const scopedUser = user as Record<string, unknown> | null | undefined;
    const userDepartment =
      (scopedUser?.department as string | undefined) ||
      (scopedUser?.businessUnit as string | undefined) ||
      (scopedUser?.team as string | undefined) ||
      null;

    return selectHomeCompanyPriorities(companyPriorities, {
      userRole: user?.role,
      userDepartment,
      limit: 5,
    });
  }, [companyPriorities, user]);

  const exceptionFocus = useMemo(() => selectHomeExceptionPreview(exceptionResponse, 3), [exceptionResponse]);
  const myWorkPreview = useMemo(() => buildMyWorkPreviewItems(allTaskData, 5), [allTaskData]);

  const welcomeUser = useMemo(() => ({
    id: user?.id,
    email: user?.email,
    name: user?.name,
    role: user?.role,
  }), [user]);

  const welcomeHeading = useMemo(() => getWelcomeHeading(welcomeUser), [welcomeUser]);
  const welcomeDate = useMemo(() => formatSouthAfricanDate(), []);
  const welcomeQuote = useMemo(() => getDeterministicRoleQuote(welcomeUser, user?.role), [user?.role, welcomeUser]);

  const hasErrors = companyPrioritiesError || exceptionError || myWorkError;
  const isRetrying = prioritiesFetching || exceptionsFetching || myWorkFetching;

  return (
    <div className="ee-page space-y-4 p-0">
      <Card className="border-primary/15 bg-[linear-gradient(135deg,rgba(255,255,255,1)_0%,rgba(240,253,250,1)_100%)] shadow-sm">
        <CardContent className="space-y-2 p-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary/80">Home</p>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">{welcomeHeading}</h1>
            <p className="text-sm text-muted-foreground">{welcomeDate}</p>
          </div>
          <p className="max-w-2xl text-sm text-primary/90">{welcomeQuote}</p>
        </CardContent>
      </Card>

      {hasErrors ? (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>Some Home data could not load. Refresh or retry to restore the launchpad.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchCompanyPriorities();
              refetchExceptions();
              refetchMyWork();
            }}
            disabled={isRetrying}
          >
            {isRetrying ? "Retrying..." : "Retry Home data"}
          </Button>
        </div>
      ) : null}

      {filteredPriorities.length > 0 ? (
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Flag className="h-4 w-4 text-primary" />
                Company Priorities
              </CardTitle>
              <p className="text-sm text-muted-foreground">Exco-set priorities relevant to your role and today&apos;s execution.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/company-priorities">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {filteredPriorities.map((priority) => (
              <Link
                key={priority.id}
                href={getPriorityDestination(priority)}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground">{priority.title}</p>
                  {priority.description ? <p className="text-xs text-muted-foreground">{priority.description}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {priority.department ? <Badge variant="outline">{priority.department}</Badge> : null}
                  <ArrowRight className="h-4 w-4 text-primary" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Exception Focus
            </CardTitle>
            <p className="text-sm text-muted-foreground">Work the exceptions that need intervention first, then move into planned execution.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/my-work/tasks">Open My Work</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["critical", "high", "medium", "low"] as const).map((severity) => (
              <div key={severity} className={`rounded-lg border p-3 ${SEVERITY_TONES[severity]}`}>
                <p className="text-[11px] font-medium uppercase tracking-wide">{severity}</p>
                <p className="mt-1 text-xl font-semibold">{exceptionFocus.summary.bySeverity?.[severity] || 0}</p>
              </div>
            ))}
          </div>

          {exceptionFocus.items.length > 0 ? (
            <div className="space-y-2">
              {exceptionFocus.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-red-200 hover:bg-red-50/40"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.modelLabel}</Badge>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.severity}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-red-600" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active exceptions in your scope right now.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListChecks className="h-4 w-4 text-primary" />
              My Work Preview
            </CardTitle>
            <p className="text-sm text-muted-foreground">The next five items that need your attention first across overdue work, blockers, due-soon items, and approvals.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/my-work/tasks">Open My Work</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {myWorkPreview.length > 0 ? (
            myWorkPreview.map((item) => (
              <Link
                key={item.itemKey}
                href={item.href}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/25 hover:bg-primary/5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{PREVIEW_REASON_LABELS[item.reason]}</Badge>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.sourceLabel}</span>
                  </div>
                  <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.projectName || "General"}
                    {formatDueLabel(item.dueAt) ? ` • ${formatDueLabel(item.dueAt)}` : ""}
                    {item.status ? ` • ${item.status.replace(/[_-]+/g, " ")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.priority && item.priority !== "normal" ? <Badge variant="secondary">{item.priority}</Badge> : null}
                  <ArrowRight className="h-4 w-4 text-primary" />
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No urgent work is currently queued for you in My Work.
            </div>
          )}

          <div className="pt-1">
            <Link href="/my-work/tasks" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80">
              <ClipboardList className="h-4 w-4" />
              Open the full My Work workspace
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

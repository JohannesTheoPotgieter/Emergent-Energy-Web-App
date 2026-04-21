import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Calendar, Clock, CheckCircle, AlertCircle, ArrowRight,
} from "lucide-react";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { format, startOfWeek, addDays, differenceInDays } from "date-fns";
import { ReportTrustNotice } from "@/components/reports/ReportTrustNotice";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout, TableLayout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ReviewRecord {
  id: number;
  projectName: string;
  weekStarting: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
  stepSummary?: { overallStatus?: string; keyMessage?: string } | null;
}

export default function WeeklyReviewsPage() {
  const [, setLocation] = useLocation();
  const { projectsSummary } = useProjectsSummary();

  const { data: allReviews = [], isLoading, isError, error, refetch } = useQuery<ReviewRecord[]>({
    queryKey: ["/api/weekly-reviews-all"],
  });

  const currentWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const projectReviewMap = useMemo(() => {
    const map = new Map<string, { latest: ReviewRecord | null; reviews: ReviewRecord[] }>();

    for (const review of allReviews) {
      if (!map.has(review.projectName)) {
        map.set(review.projectName, { latest: null, reviews: [] });
      }
      const entry = map.get(review.projectName)!;
      entry.reviews.push(review);
      if (!entry.latest || review.weekStarting > entry.latest.weekStarting) {
        entry.latest = review;
      }
    }

    return map;
  }, [allReviews]);

  const projects = useMemo(() => {
    const activeProjects = (projectsSummary || []).filter(
      (p: any) => p.is_active !== false && p.archived_status !== "ARCHIVED"
    );

    return activeProjects.map((project: any) => {
      const name = project.project_name;
      const reviewData = projectReviewMap.get(name);
      const latestReview = reviewData?.latest || null;
      const reviewCount = reviewData?.reviews.length || 0;

      const hasCurrentWeekReview = reviewData?.reviews.some(
        (r) => r.weekStarting === currentWeekStart
      ) || false;

      const nextReviewDue = hasCurrentWeekReview
        ? format(addDays(new Date(currentWeekStart), 7), "yyyy-MM-dd")
        : currentWeekStart;

      const daysTilDue = differenceInDays(new Date(nextReviewDue), new Date());

      return {
        name,
        phase: project.phase || null,
        pm: project.pm || null,
        latestReview,
        reviewCount,
        hasCurrentWeekReview,
        nextReviewDue,
        daysTilDue,
      };
    });
  }, [projectsSummary, projectReviewMap, currentWeekStart]);

  const reviewedThisWeek = projects.filter((p) => p.hasCurrentWeekReview).length;
  const pendingThisWeek = projects.filter((p) => !p.hasCurrentWeekReview).length;
  const totalReviews = allReviews.length;
  const completedReviews = allReviews.filter((r) => r.status === "completed").length;
  const latestRefreshAt = allReviews.reduce<string | null>((latest, review) => {
    const candidate = review.completedAt || review.createdAt;
    if (!candidate) return latest;
    if (!latest) return candidate;
    return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
  }, null);

  const handleRowClick = (projectName: string) => {
    setLocation(`/project/${encodeURIComponent(projectName)}?tab=history`);
  };

  if (isLoading) {
    return <PageSkeleton lines={5} />;
  }

  if (isError) {
    return (
      <div className="p-4 md:p-6">
        <PageError title="Unable to load Weekly Reviews" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} />
      </div>
    );
  }

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
        No active projects found.
      </TableCell>
    </TableRow>
  );

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>PM</TableHead>
          <TableHead>Last Review</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Next Due</TableHead>
          <TableHead>Reviews</TableHead>
          <TableHead className="text-right"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.length === 0 ? emptyRow : projects.map((project) => (
          <TableRow
            key={project.name}
            className="cursor-pointer"
            onClick={() => handleRowClick(project.name)}
            data-testid={`row-project-review-${project.name}`}
          >
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium truncate max-w-[200px]" data-testid={`text-project-name-${project.name}`}>
                  {project.name}
                </span>
                {project.phase && (
                  <span className="text-[10px] text-muted-foreground">{project.phase}</span>
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">{project.pm || "—"}</TableCell>
            <TableCell>
              {project.latestReview ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span>{format(new Date(project.latestReview.weekStarting), "dd MMM yyyy")}</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Never</span>
              )}
            </TableCell>
            <TableCell>
              {project.hasCurrentWeekReview ? (
                <Badge variant="default" className="text-[10px] gap-1" data-testid={`badge-status-${project.name}`}>
                  <CheckCircle className="h-3 w-3" /> Reviewed
                </Badge>
              ) : project.latestReview?.status === "draft" ? (
                <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700" data-testid={`badge-status-${project.name}`}>
                  <AlertCircle className="h-3 w-3" /> Draft
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] gap-1" data-testid={`badge-status-${project.name}`}>
                  <Calendar className="h-3 w-3" /> Pending
                </Badge>
              )}
            </TableCell>
            <TableCell>
              <span className={`text-xs tabular-nums ${project.daysTilDue < 0 ? "text-red-600 font-semibold" : project.daysTilDue === 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                {project.daysTilDue < 0
                  ? `${Math.abs(project.daysTilDue)}d overdue`
                  : project.daysTilDue === 0
                    ? "Due today"
                    : `In ${project.daysTilDue}d`}
              </span>
            </TableCell>
            <TableCell>
              <span className="text-xs text-muted-foreground tabular-nums">{project.reviewCount}</span>
            </TableCell>
            <TableCell className="text-right">
              <ArrowRight className="h-4 w-4 text-muted-foreground inline-block" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="page-weekly-reviews"
      header={
        <PageHeader
          title="Weekly Reviews"
          subtitle="Track weekly project review status across all active projects"
        />
      }
    >
      <ReportTrustNotice
        lastUpdatedAt={latestRefreshAt}
        sourceLabel="Weekly review records + active projects"
        note="This page is a read-only trust tracker. Complete reviews from project workflows; status here reflects captured records."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4" data-testid="card-stat-reviewed">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Reviewed This Week</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600 tabular-nums">{reviewedThisWeek}</p>
        </Card>
        <Card className="p-4" data-testid="card-stat-pending">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending This Week</p>
          <p className="text-2xl font-bold mt-1 text-amber-600 tabular-nums">{pendingThisWeek}</p>
        </Card>
        <Card className="p-4" data-testid="card-stat-total">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Reviews</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{totalReviews}</p>
        </Card>
        <Card className="p-4" data-testid="card-stat-completed">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</p>
          <p className="text-2xl font-bold mt-1 text-blue-600 tabular-nums">{completedReviews}</p>
        </Card>
      </div>

      <TableLayout table={table} />
    </PageLayout>
  );
}

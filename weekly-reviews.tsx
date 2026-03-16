import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Calendar, Clock, CheckCircle, AlertCircle, FileText,
  ArrowRight, Loader2,
} from "lucide-react";
import { useProgramData } from "@/hooks/use-program-data";
import { format, startOfWeek, addDays, differenceInDays } from "date-fns";

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
  const { projectsSummary } = useProgramData();

  const { data: allReviews = [], isLoading } = useQuery<ReviewRecord[]>({
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

  const handleRowClick = (projectName: string) => {
    setLocation(`/project/${encodeURIComponent(projectName)}?tab=history`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="loading-weekly-reviews">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-weekly-reviews">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">
          Weekly Reviews
        </h2>
        <p className="text-muted-foreground">
          Track weekly project review status across all active projects.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4" data-testid="card-stat-reviewed">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Reviewed This Week</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600">{reviewedThisWeek}</p>
        </Card>
        <Card className="p-4" data-testid="card-stat-pending">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending This Week</p>
          <p className="text-2xl font-bold mt-1 text-amber-600">{pendingThisWeek}</p>
        </Card>
        <Card className="p-4" data-testid="card-stat-total">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Reviews</p>
          <p className="text-2xl font-bold mt-1">{totalReviews}</p>
        </Card>
        <Card className="p-4" data-testid="card-stat-completed">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</p>
          <p className="text-2xl font-bold mt-1 text-blue-600">{completedReviews}</p>
        </Card>
      </div>

      <Card data-testid="card-project-reviews-table">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Project Review Status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Project</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">PM</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Last Review</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Next Due</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Reviews</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      No active projects found.
                    </td>
                  </tr>
                ) : (
                  projects.map((project) => (
                    <tr
                      key={project.name}
                      className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => handleRowClick(project.name)}
                      data-testid={`row-project-review-${project.name}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium truncate max-w-[200px]" data-testid={`text-project-name-${project.name}`}>
                            {project.name}
                          </span>
                          {project.phase && (
                            <span className="text-[10px] text-muted-foreground">{project.phase}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {project.pm || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {project.latestReview ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span>
                              {format(new Date(project.latestReview.weekStarting), "dd MMM yyyy")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {project.hasCurrentWeekReview ? (
                          <Badge variant="default" className="text-[10px] gap-1" data-testid={`badge-status-${project.name}`}>
                            <CheckCircle className="h-3 w-3" />
                            Reviewed
                          </Badge>
                        ) : project.latestReview?.status === "draft" ? (
                          <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700" data-testid={`badge-status-${project.name}`}>
                            <AlertCircle className="h-3 w-3" />
                            Draft
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-1" data-testid={`badge-status-${project.name}`}>
                            <Calendar className="h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${project.daysTilDue < 0 ? "text-red-600 font-semibold" : project.daysTilDue === 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                          {project.daysTilDue < 0
                            ? `${Math.abs(project.daysTilDue)}d overdue`
                            : project.daysTilDue === 0
                              ? "Due today"
                              : `In ${project.daysTilDue}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">{project.reviewCount}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ArrowRight className="h-4 w-4 text-muted-foreground inline-block" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

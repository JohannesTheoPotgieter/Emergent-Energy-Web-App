import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import {
  ClipboardList,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  Plus,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Stage =
  | "preparation"
  | "submitted"
  | "query_received"
  | "response_sent"
  | "under_review"
  | "approved"
  | "rejected"
  | "expired"
  | string;

interface SsegSubmissionRow {
  id: number;
  projectId: number;
  projectName: string | null;
  municipality: string | null;
  authority: string | null;
  nrsType: string | null;
  applicationStage: Stage;
  referenceNumber: string | null;
  submissionDate: string | null;
  approvalDate: string | null;
  expiryDate: string | null;
  responseDueDate: string | null;
}

interface SsegSubmissionsResponse {
  rows: SsegSubmissionRow[];
  kpis: {
    underReview: number;
    approved30d: number;
    cocPending: number;
    rejectionsYtd: number;
  };
  capabilities: {
    canCreate: boolean;
    canEdit: boolean;
  };
}

const STAGE_LABELS: Record<string, string> = {
  preparation: "Preparation",
  submitted: "Submitted",
  query_received: "Query received",
  response_sent: "Response sent",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

function stageChip(stage: Stage) {
  const s = (stage || "").toLowerCase();
  if (s === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "rejected" || s === "expired") return "bg-red-50 text-red-700 border-red-200";
  if (s === "query_received") return "bg-amber-50 text-amber-700 border-amber-200";
  if (s === "submitted" || s === "under_review" || s === "response_sent")
    return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-muted text-muted-foreground border-transparent";
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function decisionLabel(row: SsegSubmissionRow): string {
  const s = (row.applicationStage || "").toLowerCase();
  if (s === "approved") return fmtDate(row.approvalDate);
  if (s === "rejected" || s === "expired") return STAGE_LABELS[s] ?? s;
  if (row.responseDueDate) return `Due ${fmtDate(row.responseDueDate)}`;
  return "Awaiting decision";
}

export default function SsegSubmissionsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery<SsegSubmissionsResponse>({
    queryKey: ["/api/sseg-submissions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/sseg-submissions");
      if (!res.ok) throw new Error(`Failed to load SSEG submissions (${res.status})`);
      const body = await res.json();
      return body as SsegSubmissionsResponse;
    },
  });

  const rows = useMemo(() => (Array.isArray(data?.rows) ? data!.rows : []), [data]);
  const TERMINAL_STAGES = new Set(["rejected", "expired", "approved"]);
  const activeRows = useMemo(
    () =>
      rows.filter((r) => {
        const s = (r.applicationStage || "").toLowerCase();
        return !TERMINAL_STAGES.has(s);
      }),
    [rows],
  );

  if (isLoading) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="page-sseg-submissions">
        <PageSkeleton lines={6} />
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="page-sseg-submissions">
        <PageError
          title="Unable to load SSEG submissions"
          message={error instanceof Error ? error.message : "Unknown error"}
          onRetry={() => refetch()}
        />
      </PageShell>
    );
  }

  const kpis = data?.kpis ?? { underReview: 0, approved30d: 0, cocPending: 0, rejectionsYtd: 0 };
  const canCreate = !!data?.capabilities?.canCreate;
  const canEdit = !!data?.capabilities?.canEdit;
  const canStart = canCreate || canEdit;

  return (
    <PageShell className="p-4 md:p-6 space-y-6" data-testid="page-sseg-submissions">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SectionHeader
          icon={<ClipboardList className="h-5 w-5" />}
          eyebrow="Project Delivery"
          title="SSEG submissions"
          description="Track grid-connection applications across municipalities and authorities."
        />
        {canStart && (
          <Button
            asChild
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="button-start-submission"
          >
            <Link href="/handover?tab=sseg">
              <Plus className="h-4 w-4 mr-2" />
              Start submission
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<ClipboardList className="h-4 w-4 text-blue-600" />}
          label="Under review"
          value={kpis.underReview}
          testId="kpi-under-review"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          label="Approved 30D"
          value={kpis.approved30d}
          testId="kpi-approved-30d"
        />
        <KpiCard
          icon={<AlertCircle className="h-4 w-4 text-amber-600" />}
          label="CoC pending"
          value={kpis.cocPending}
          testId="kpi-coc-pending"
        />
        <KpiCard
          icon={<XCircle className="h-4 w-4 text-red-600" />}
          label="Rejections YTD"
          value={kpis.rejectionsYtd}
          testId="kpi-rejections-ytd"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Active submissions</h2>
            <span className="text-xs text-muted-foreground" data-testid="text-active-count">
              {activeRows.length} {activeRows.length === 1 ? "submission" : "submissions"}
            </span>
          </div>

          {activeRows.length === 0 ? (
            <div
              className="px-6 py-12 text-center space-y-2"
              data-testid="empty-sseg-submissions"
            >
              <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium">No active SSEG submissions</p>
              <p className="text-xs text-muted-foreground">
                {canStart
                  ? "Start a submission to begin tracking a new application."
                  : "Submissions appear here once they have been created."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Project</th>
                    <th className="text-left font-medium px-4 py-2">Municipality</th>
                    <th className="text-left font-medium px-4 py-2">NRS / Authority</th>
                    <th className="text-left font-medium px-4 py-2">Status</th>
                    <th className="text-left font-medium px-4 py-2">Submitted</th>
                    <th className="text-left font-medium px-4 py-2">Decision</th>
                    <th className="w-10 px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {activeRows.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-muted/30"
                      data-testid={`row-sseg-${row.id}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium" data-testid={`text-project-${row.id}`}>
                          {row.projectName ?? `Project #${row.projectId}`}
                        </div>
                        {row.referenceNumber && (
                          <div className="text-xs text-muted-foreground">
                            Ref {row.referenceNumber}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.municipality ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.nrsType ?? row.authority ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={stageChip(row.applicationStage)}
                          data-testid={`status-sseg-${row.id}`}
                        >
                          {STAGE_LABELS[row.applicationStage] ?? row.applicationStage}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {fmtDate(row.submissionDate)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {decisionLabel(row)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight className="h-4 w-4 text-muted-foreground inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

function KpiCard(props: {
  icon: React.ReactNode;
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {props.icon}
          <span>{props.label}</span>
        </div>
        <div className="text-2xl font-semibold" data-testid={props.testId}>
          {props.value}
        </div>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateProjectV2Queries } from "@/hooks/use-project-v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  FileText,
  
  Loader2,
  RefreshCw,
  Shield,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";

interface FinancialReviewTabProps {
  projectId: number;
  projectName: string;
}

type SectionKey = "budgetReview" | "procurementReview" | "scopeReview" | "logisticsReview" | "hseReview";

const SECTION_CONFIG: Array<{
  key: SectionKey;
  label: string;
  icon: React.ElementType;
}> = [
  { key: "budgetReview", label: "Budget Review", icon: DollarSign },
  { key: "procurementReview", label: "Procurement Review", icon: ShoppingCart },
  { key: "scopeReview", label: "Scope Review", icon: FileText },
  { key: "logisticsReview", label: "Logistics & Access", icon: Truck },
  { key: "hseReview", label: "HSE Review", icon: Shield },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  IN_REVIEW: "bg-blue-100 text-blue-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  DEFERRED: "bg-amber-100 text-amber-700",
  NOT_STARTED: "bg-gray-100 text-gray-600",
};

const OUTCOME_COLORS: Record<string, string> = {
  GO: "bg-green-600 text-white",
  CONDITIONAL_GO: "bg-amber-500 text-white",
  NO_GO: "bg-red-600 text-white",
  DEFERRED: "bg-gray-500 text-white",
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
    return headers;
}

async function fetchReview(projectId: number) {
  const res = await fetch(`/api/projects/${projectId}/financial-review`, {
    headers: getAuthHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load financial review");
  const body = await res.json();
  return body.review;
}

async function fetchHistory(projectId: number) {
  const res = await fetch(`/api/projects/${projectId}/financial-review-history`, {
    headers: getAuthHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load review history");
  const body = await res.json();
  return body.reviews;
}

export default function FinancialReviewTab({ projectId, projectName: _projectName }: FinancialReviewTabProps) {
  const queryClient = useQueryClient();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["budgetReview", "procurementReview"]));

  const { data: review, isLoading, error } = useQuery({
    queryKey: ["financial-review", projectId],
    queryFn: () => fetchReview(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const { data: history } = useQuery({
    queryKey: ["financial-review-history", projectId],
    queryFn: () => fetchHistory(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["financial-review", projectId] });
    queryClient.invalidateQueries({ queryKey: ["financial-review-history", projectId] });
    invalidateProjectV2Queries(queryClient, projectId);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/financial-review`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to create review");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const refreshMutation = useMutation({
    mutationFn: async (reviewId: number) => {
      const res = await fetch(`/api/projects/${projectId}/financial-review/${reviewId}/refresh-snapshot`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to refresh snapshot");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const submitMutation = useMutation({
    mutationFn: async (reviewId: number) => {
      const res = await fetch(`/api/projects/${projectId}/financial-review/${reviewId}/submit`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to submit review");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const decideMutation = useMutation({
    mutationFn: async ({ reviewId, outcome, outcomeConditions, outcomeNotes }: {
      reviewId: number;
      outcome: string;
      outcomeConditions?: string;
      outcomeNotes?: string;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/financial-review/${reviewId}/approve`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ outcome, outcomeConditions, outcomeNotes }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to submit decision");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading financial review...
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-4 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 inline mr-2" />
          {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  // No review exists yet
  if (!review) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
            <h3 className="text-lg font-semibold">No Financial Review Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              A Financial Review Gate must be completed before this project can move to Construction.
              Create a review to capture budget, procurement, scope, logistics, and HSE readiness.
            </p>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="mt-2"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Financial Review
            </Button>
            {createMutation.isError && (
              <p className="text-xs text-red-600 mt-1">{(createMutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const snapshotData = (review.snapshotData || {}) as any;
  const warnings = (snapshotData.warnings || []) as Array<{ code: string; severity: string; message: string }>;
  const isEditable = review.status === "DRAFT" || review.status === "IN_REVIEW";

  return (
    <div className="space-y-3">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Financial Review Gate</h2>
          <Badge className={STATUS_COLORS[review.status] || "bg-gray-100"}>
            {review.status.replace("_", " ")}
          </Badge>
          {review.outcome && (
            <Badge className={OUTCOME_COLORS[review.outcome] || "bg-gray-500 text-white"}>
              {review.outcome.replace("_", " ")}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">v{review.version}</span>
        </div>
        <div className="flex items-center gap-2">
          {review.reviewDate && (
            <span className="text-xs text-muted-foreground">
              Review: {review.reviewDate}
            </span>
          )}
        </div>
      </div>

      {/* ── Warnings ────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-3 space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <AlertTriangle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${w.severity === "HIGH" ? "text-red-500" : "text-amber-500"}`} />
                <span className={w.severity === "HIGH" ? "text-red-700" : "text-amber-700"}>{w.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Financial Snapshot ──────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Financial Snapshot</CardTitle>
          {isEditable && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => refreshMutation.mutate(review.id)}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard label="Budget" value={formatCurrency(review.snapshotBudgetTotal)} />
            <MetricCard label="Actual" value={formatCurrency(review.snapshotActualTotal)} />
            <MetricCard
              label="Variance"
              value={`${Number(review.snapshotVariancePct || 0).toFixed(1)}%`}
              highlight={Math.abs(Number(review.snapshotVariancePct || 0)) > 10}
            />
            <MetricCard label="Margin" value={`${(Number(review.snapshotMargin || 0) * 100).toFixed(1)}%`} />
            <MetricCard label="Contingency" value={formatCurrency(review.snapshotContingencyRemaining)} />
            <MetricCard label="Procurement" value={`${(Number(review.snapshotProcurementReadiness || 0) * 100).toFixed(0)}% ready`} />
          </div>
          {review.snapshotCapturedAt && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Snapshot: {new Date(review.snapshotCapturedAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Review Sections ──────────────────────���──────────── */}
      {SECTION_CONFIG.map(({ key, label, icon: Icon }) => {
        const section = (review[key] || {}) as any;
        const findings = (section.findings || []) as Array<any>;
        const sectionStatus = section.status || "not_started";
        const isExpanded = expandedSections.has(key);
        const actionCount = findings.filter((f: any) => f.actionRequired).length;

        return (
          <Card key={key} className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors"
              onClick={() => toggleSection(key)}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{label}</span>
                {findings.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {findings.length} finding{findings.length !== 1 ? "s" : ""}
                  </span>
                )}
                {actionCount > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                    {actionCount} action{actionCount !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <SectionStatusBadge status={sectionStatus} />
            </button>
            {isExpanded && (
              <CardContent className="pt-0 px-3 pb-3 border-t">
                {section.notes && (
                  <p className="text-xs text-muted-foreground mb-2">{section.notes}</p>
                )}
                {findings.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No findings recorded.</p>
                ) : (
                  <div className="space-y-1.5">
                    {findings.map((f: any, i: number) => (
                      <div key={f.id || i} className="flex items-start gap-2 text-xs">
                        {f.actionRequired ? (
                          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className={f.actionRequired ? "text-red-700 font-medium" : ""}>
                            {f.description}
                          </span>
                          {f.response && (
                            <span className="text-muted-foreground"> — {f.response}</span>
                          )}
                        </div>
                        <Badge variant="outline" className="ml-auto text-[10px] shrink-0">
                          {f.severity || "LOW"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* ── Participants ────────────────────────────────────── */}
      {Array.isArray(review.participants) && review.participants.length > 0 && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">Participants</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {(review.participants as any[]).map((p: any, i: number) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {p.name || `User ${p.userId}`} ({p.role || "—"})
                  {p.attended ? " ✓" : ""}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Decision Panel ──────────────────────────────────── */}
      {review.status === "IN_REVIEW" && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Decision</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex flex-wrap gap-2">
              {(["GO", "CONDITIONAL_GO", "NO_GO", "DEFERRED"] as const).map((outcome) => (
                <Button
                  key={outcome}
                  size="sm"
                  variant={outcome === "GO" ? "default" : "outline"}
                  className={`text-xs ${
                    outcome === "NO_GO" ? "border-red-300 text-red-700 hover:bg-red-50" :
                    outcome === "CONDITIONAL_GO" ? "border-amber-300 text-amber-700 hover:bg-amber-50" :
                    outcome === "DEFERRED" ? "border-gray-300 text-gray-700 hover:bg-gray-50" : ""
                  }`}
                  disabled={decideMutation.isPending}
                  onClick={() => decideMutation.mutate({ reviewId: review.id, outcome })}
                >
                  {decideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  {outcome.replace("_", " ")}
                </Button>
              ))}
            </div>
            {decideMutation.isError && (
              <p className="text-xs text-red-600">{(decideMutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Actions: Submit for review ──────────────────────── */}
      {review.status === "DRAFT" && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => submitMutation.mutate(review.id)}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
            Submit for Review
          </Button>
          {submitMutation.isError && (
            <p className="text-xs text-red-600 ml-2">{(submitMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {/* ── Outcome conditions ──────────────────────────────── */}
      {review.outcome === "CONDITIONAL_GO" && review.outcomeConditions && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-3">
            <p className="text-xs font-medium text-amber-800">Conditions:</p>
            <p className="text-xs text-amber-700 mt-1">{review.outcomeConditions}</p>
          </CardContent>
        </Card>
      )}

      {/* ── Review History ───────────────────────��──────────── */}
      {history && history.length > 1 && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">Review History</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1">
              {(history as any[]).map((h: any) => (
                <div key={h.id} className="flex items-center gap-2 text-xs">
                  <span className="font-medium">v{h.version}</span>
                  <span className="text-muted-foreground">{h.reviewDate || "��"}</span>
                  <Badge className={`text-[10px] ${STATUS_COLORS[h.status] || ""}`}>
                    {h.outcome || h.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${highlight ? "border-red-300 bg-red-50" : ""}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? "text-red-700" : ""}`}>{value}</p>
    </div>
  );
}

function SectionStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    not_started: { label: "Not Started", color: "bg-gray-100 text-gray-600", icon: Clock },
    in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700", icon: Loader2 },
    complete: { label: "Complete", color: "bg-green-100 text-green-700", icon: CheckCircle },
    not_applicable: { label: "N/A", color: "bg-gray-100 text-gray-500", icon: Clock },
  };
  const c = config[status] || config.not_started;
  const Icon = c.icon;
  return (
    <Badge className={`text-[10px] ${c.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {c.label}
    </Badge>
  );
}

function formatCurrency(val: string | number | null | undefined): string {
  const num = Number(val || 0);
  if (num === 0) return "R 0";
  if (num >= 1_000_000) return `R ${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `R ${(num / 1_000).toFixed(0)}K`;
  return `R ${num.toFixed(0)}`;
}

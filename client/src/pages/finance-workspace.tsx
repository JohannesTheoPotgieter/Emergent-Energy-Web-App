/**
 * Finance Workspace — Wave 5
 *
 * Project-scoped finance summary using promoted schema.
 * Cards: committed, invoiced, paid, revenue, budget variance.
 *
 * Guardrail 2: Analytical pages (cashflow, COS, revenue) stay unchanged.
 */

import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { ProjectWorkspaceHeader } from "@/components/project/ProjectWorkspaceHeader";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { DollarSign, TrendingUp, TrendingDown, CreditCard, Receipt, AlertTriangle } from "lucide-react";

interface FinanceSummary {
  poCount: number;
  totalCommitted: number;
  totalInvoiced: number;
  totalPaid: number;
  totalRevenue: number;
  revenueReceived: number;
  pendingCount: number;
  budget: {
    revenueBaseline: number;
    cosBaseline: number;
    marginBaseline: number;
    contingency: number;
  } | null;
  budgetVariance: number | null;
}

function formatZAR(amount: number): string {
  if (amount === 0) return "R0";
  if (Math.abs(amount) >= 1_000_000) return `R${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1_000) return `R${(amount / 1_000).toFixed(0)}k`;
  return `R${amount.toFixed(2)}`;
}

export default function FinanceWorkspacePage() {
  const [, params] = useRoute("/finance/workspace/:projectId");
  const projectId = params?.projectId ? parseInt(params.projectId) : undefined;

  const { data, isLoading } = useQuery<FinanceSummary>({
    queryKey: ["finance-summary", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/finance-summary`);
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  if (!projectId) {
    return (
      <PageShell className="p-3 md:p-4">
        <div className="text-center py-8 text-muted-foreground">
          Select a project to view finance workspace.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell className="p-3 md:p-4">
      <ProjectWorkspaceHeader projectId={projectId} compact />

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="py-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <CreditCard className="h-4 w-4" />
                  Total Committed (POs)
                </div>
                <div className="text-2xl font-bold">{formatZAR(data.totalCommitted)}</div>
                <div className="text-xs text-muted-foreground mt-1">{data.poCount} purchase orders</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Receipt className="h-4 w-4" />
                  Total Invoiced
                </div>
                <div className="text-2xl font-bold">{formatZAR(data.totalInvoiced)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" />
                  Total Paid
                </div>
                <div className="text-2xl font-bold">{formatZAR(data.totalPaid)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  Revenue (Total)
                </div>
                <div className="text-2xl font-bold">{formatZAR(data.totalRevenue)}</div>
                <div className="text-xs text-muted-foreground mt-1">{formatZAR(data.revenueReceived)} received</div>
              </CardContent>
            </Card>

            {data.budget && (
              <>
                <Card>
                  <CardContent className="py-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <TrendingDown className="h-4 w-4" />
                      Budget Baseline (COS)
                    </div>
                    <div className="text-2xl font-bold">{formatZAR(data.budget.cosBaseline)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Margin target: {(data.budget.marginBaseline * 100).toFixed(1)}%
                    </div>
                  </CardContent>
                </Card>

                <Card className={cn(data.budgetVariance && data.budgetVariance < 0 ? "border-red-200" : "")}>
                  <CardContent className="py-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      {data.budgetVariance && data.budgetVariance < 0 ? (
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                      ) : (
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                      )}
                      Budget Variance
                    </div>
                    <div className={cn(
                      "text-2xl font-bold",
                      data.budgetVariance && data.budgetVariance < 0 ? "text-red-600" : "text-emerald-600"
                    )}>
                      {data.budgetVariance !== null ? formatZAR(data.budgetVariance) : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {data.budgetVariance && data.budgetVariance >= 0 ? "Under budget" : "Over budget"}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {data.pendingCount > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 mb-4">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              {data.pendingCount} finance record{data.pendingCount === 1 ? "" : "s"} pending review
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

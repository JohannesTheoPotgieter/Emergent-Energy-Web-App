import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import { useAuth } from "@/hooks/use-auth";
import { useLensContext } from "@/hooks/use-lens-context";
import { apiRequest } from "@/lib/queryClient";
import { RefreshCw, Clock } from "lucide-react";

import { ExecutiveSummaryRow } from "./components/ExecutiveSummaryRow";
import { DepartmentHealthGrid } from "./components/DepartmentHealthGrid";
import { PortfolioFinanceRow } from "./components/PortfolioFinanceRow";
import { ExceptionsAndPriorities } from "./components/ExceptionsAndPriorities";
import { DepartmentKpiTable } from "./components/DepartmentKpiTable";
import { RecentSignals } from "./components/RecentSignals";

type PeriodFilter = "today" | "week" | "month" | "fytd";

const PERIOD_OPTIONS: { key: PeriodFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "fytd", label: "FYTD" },
];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CompanyOverviewPage() {
  const { user } = useAuth();
  const lens = useLensContext();
  const [period, setPeriod] = useState<PeriodFilter>("fytd");

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<any>({
    queryKey: ["/api/company-overview", period],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/company-overview");
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const roleLabel = lens.activeLensLabel;

  return (
    <PageShell data-testid="company-overview-page">
      {isError && (
        <div className="mb-4">
          <QueryErrorBanner error={error} />
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            Company Overview
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Executive health, department performance, KPIs, risks, and priorities
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Period selector */}
          <div className="flex items-center border rounded-md bg-background overflow-hidden">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPeriod(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === opt.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Last refresh + role */}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {data?.meta?.refreshedAt && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTimestamp(data.meta.refreshedAt)}
              </span>
            )}
            <Badge variant="outline" className="text-[10px]">{roleLabel}</Badge>
          </div>

          {/* Refresh button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 px-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ── Row 1: Executive Summary ──────────────────────────────── */}
      <section className="mb-5">
        <ExecutiveSummaryRow data={data?.executiveSummary} isLoading={isLoading} />
      </section>

      {/* ── Row 2: Department Health Grid ─────────────────────────── */}
      <section className="mb-5">
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
          Department Health
        </h2>
        <DepartmentHealthGrid scores={data?.departmentScores} isLoading={isLoading} />
      </section>

      {/* ── Row 3: Portfolio + Financial ──────────────────────────── */}
      <section className="mb-5">
        <PortfolioFinanceRow
          portfolio={data?.portfolioSnapshot}
          finance={data?.financeSnapshot}
          isLoading={isLoading}
        />
      </section>

      {/* ── Row 4: Exceptions + Priorities ────────────────────────── */}
      <section className="mb-5">
        <ExceptionsAndPriorities
          exceptions={data?.exceptions}
          priorities={data?.priorities}
          isLoading={isLoading}
        />
      </section>

      {/* ── Row 5: KPI Table + Signals ────────────────────────────── */}
      <section className="mb-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <DepartmentKpiTable scores={data?.departmentScores} isLoading={isLoading} />
          <RecentSignals signals={data?.signals} isLoading={isLoading} />
        </div>
      </section>
    </PageShell>
  );
}

import React from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/hooks/use-permissions";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { Activity, AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";
import {
  ExecutionDashboardContext,
  useExecutionDataProvider,
} from "./use-execution-data";
import OverviewPage from "./OverviewPage";

export default function ExecutionDashboard() {
  const { allowed: canView } = usePermission("execution_board", "view");
  const [, setLocation] = useLocation();
  const ctx = useExecutionDataProvider(setLocation);

  if (ctx.loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <EnergyLoader size="lg" label="Loading execution dashboard..." />
      </div>
    );
  }

  if (ctx.error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p>{ctx.error}</p>
        <Button onClick={ctx.loadData}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Retry
        </Button>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card>
          <CardContent className="py-8 text-center">
            <AlertTriangle className="mx-auto mb-2" />
            <p>Access Denied</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ExecutionDashboardContext.Provider value={ctx}>
      <div className="space-y-5 sm:space-y-6 max-w-[1400px] mx-auto pb-8" data-testid="execution-board-page">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold tracking-tight">Execution Board</h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                {ctx.fyLabel}
                {ctx.dashboard && ` · ${ctx.allProjects.length} active projects`}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={ctx.loadData} className="gap-1.5 shrink-0">
            <RefreshCw className="w-3.5 h-3.5" /><span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        <OverviewPage />
      </div>
    </ExecutionDashboardContext.Provider>
  );
}

import React from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { usePermission } from '@/hooks/use-permissions';
import { EnergyLoader } from '@/components/ui/energy-loader';
import { Activity, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { ExecutionDashboardContext, useExecutionDataProvider } from './use-execution-data';
import OverviewPage from './OverviewPage';
import ProgramPage from './ProgramPage';
import ConstructionPage from './ConstructionPage';
import FinancePage from './FinancePage';
import {
  EXECUTION_DASHBOARD_TABS,
  getExecutionDashboardPathForTab,
  getExecutionDashboardTabFromPath,
  type ExecutionDashboardTab,
} from './route-tabs';

export default function ExecutionDashboard() {
  const { allowed: canView } = usePermission('execution_board', 'view');
  const [location, setLocation] = useLocation();
  const ctx = useExecutionDataProvider(setLocation);
  const activeTab = getExecutionDashboardTabFromPath(location);
  const handleTabChange = (tab: string) => {
    setLocation(getExecutionDashboardPathForTab(tab as ExecutionDashboardTab));
  };

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
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          Retry
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
      <div
        className="space-y-5 sm:space-y-6 max-w-[1400px] mx-auto pb-8"
        data-testid="execution-board-page"
      >
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
                {ctx.dashboard &&
                  (ctx.dashboard.financialYear.allData
                    ? ' · all data in system'
                    : ` · ${ctx.dashboard.financialYear.start} to ${ctx.dashboard.financialYear.end}`)}
                {ctx.dashboard && ` · ${ctx.allProjects.length} active projects`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ctx.dashboard?.dataFreshness?.generatedAt && (
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                Data as of{' '}
                {new Date(ctx.dashboard.dataFreshness.generatedAt).toLocaleTimeString('en-ZA', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                  timeZone: 'Africa/Johannesburg',
                })}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={ctx.loadData} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Tab navigation */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="flex-wrap h-auto gap-1">
            {EXECUTION_DASHBOARD_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-5">
            <OverviewPage />
          </TabsContent>

          <TabsContent value="programme" className="mt-5">
            <ProgramPage />
          </TabsContent>

          <TabsContent value="construction" className="mt-5">
            <ConstructionPage />
          </TabsContent>

          <TabsContent value="finance" className="mt-5">
            <FinancePage />
          </TabsContent>
        </Tabs>
      </div>
    </ExecutionDashboardContext.Provider>
  );
}

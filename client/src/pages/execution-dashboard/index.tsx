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
import RealisationKPIsPage from './RealisationKPIsPage';
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
    // Keep the raw error detail in the console for debugging; show a calm,
    // human-readable message to the user (UI/UX audit finding 1b).
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.error('Execution dashboard load failed:', ctx.error);
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="py-8 px-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
            <h2 className="text-base font-semibold">We couldn’t load the Execution Board</h2>
            <p className="text-sm text-muted-foreground">
              Something went wrong while fetching dashboard data. This is usually temporary —
              please retry. If it keeps happening, contact your administrator.
            </p>
            <Button onClick={ctx.loadData}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="py-8 px-6 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
            <h2 className="text-base font-semibold">Access denied</h2>
            <p className="text-sm text-muted-foreground">
              You don’t have permission to view the Execution Board. If you believe this is a
              mistake, ask your administrator to grant the “Execution Board” permission.
            </p>
            <Button variant="outline" onClick={() => setLocation('/')}>
              Back to home
            </Button>
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
              <span className="text-[11px] text-muted-foreground">
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

          <TabsContent value="realisation" className="mt-5">
            <RealisationKPIsPage />
          </TabsContent>
        </Tabs>
      </div>
    </ExecutionDashboardContext.Provider>
  );
}

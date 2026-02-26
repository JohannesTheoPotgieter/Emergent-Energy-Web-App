import { Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { ProgramProvider } from "@/hooks/use-program-data";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/login";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import ProjectsSummary from "@/pages/projects";
import CashflowPage from "@/pages/cashflow";
import RevenueTracker from "@/pages/revenue";
import CostTracker from "@/pages/cos";
import UploadPage from "@/pages/upload";
import NotFound from "@/pages/not-found";
import ProjectDetailPage from "@/pages/project-detail";
import AdminPage from "@/pages/admin";
import CosControlPage from "@/pages/cos-control";
import CashflowForecastPage from "@/pages/cashflow-forecast";
import MyToolTodayPage from "@/pages/my-tool-today";
import MyToolWeekPage from "@/pages/my-tool-week";
import MyToolBacklogPage from "@/pages/my-tool-backlog";
import MyToolSettingsPage from "@/pages/my-tool-settings";
import MyToolAdminSettingsPage from "@/pages/my-tool-admin-settings";
import MyToolHelpPage from "@/pages/my-tool-help";
import MyToolPrioritiesPage from "@/pages/my-tool-priorities";
import MyToolMeetingsPage from "@/pages/my-tool-meetings";
import QmDashboardPage from "@/pages/qm-dashboard";
import EngineeringDashboardPage from "@/pages/engineering-dashboard";
import EngineeringTasksPage from "@/pages/engineering-tasks";
import PhaseTemplatesPage from "@/pages/phase-templates";
import ProjectCreatePage from "@/pages/project-create";
import TriageInboxPage from "@/pages/triage-inbox";
import UnclassifiedTasksPage from "@/pages/unclassified-tasks";
import RoleSettingsPage from "@/pages/role-settings";
import LifecycleBoardPage from "@/pages/lifecycle-board";
import ExecutionBoardPage from "@/pages/execution-board";
import SmartImportPage from "@/pages/smart-import";
import ProjectNormalizedViewPage from "@/pages/project-normalized-view";
import EngineeringSyncPage from "@/pages/engineering-sync";
import EngineeringInboxPage from "@/pages/engineering-inbox";
import InvoicePatternsPage from "@/pages/invoice-patterns";
import SubcontractorDashboardPage from "@/pages/subcontractor-dashboard";
import SystemActivityLogPage from "@/pages/system-activity-log";
import WeeklyReviewsPage from "@/pages/weekly-reviews";
import AdminRolesPage from "@/pages/admin-roles";
import AdminApprovalsPage from "@/pages/admin-approvals";
import TrRegisterPage from "@/pages/tr-register";
import FeedbackPage from "@/pages/feedback";
import EeInfoPage from "@/pages/ee-info";
import PMDashboard from "@/pages/pm-dashboard";
import { useAuth } from "@/hooks/use-auth";
import { useProgramData } from "@/hooks/use-program-data";
import { TrackerTable } from "@/components/dashboard/TrackerTable";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const EPM_ALLOWED_PATHS = ["/", "/engineering", "/engineering/tasks", "/engineering/inbox", "/quality", "/projects", "/feedback"];
const PM_ALLOWED_PATHS = ["/", "/pm-dashboard", "/projects", "/engineering", "/engineering/tasks", "/engineering/inbox", "/quality", "/cashflow", "/cos", "/feedback"];

function RoleGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;

  if (companyRole === "PROJECT_MANAGER_SITE") {
    const allowed = PM_ALLOWED_PATHS.some(p =>
      p === location || (p === "/projects" && location.startsWith("/project/"))
    );
    if (!allowed) {
      return <Redirect to="/pm-dashboard" />;
    }
  }

  if (user?.role === "eng_program_manager") {
    const allowed = EPM_ALLOWED_PATHS.some(p => 
      p === location || (p === "/projects" && location.startsWith("/project/"))
    );
    if (!allowed) {
      return <Redirect to="/" />;
    }
  }

  if (user?.role === "quality_manager") {
    const qmAllowed = ["/", "/quality", "/projects", "/feedback"];
    const allowed = qmAllowed.some(p => 
      p === location || (p === "/projects" && location.startsWith("/project/"))
    );
    if (!allowed) {
      return <Redirect to="/" />;
    }
  }

  const ADMIN_COMPANY_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
  const hasAdminAccess = user?.role === "admin" || (companyRole && ADMIN_COMPANY_ROLES.includes(companyRole));
  if (!hasAdminAccess && location.startsWith("/admin")) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function ProcurementPage() {
  const { data } = useProgramData();
  const procurementData = data?.expenses.filter(e => e.category === "Procurement") || [];
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Procurement</h2>
        <p className="text-muted-foreground">Supply chain tracking and material acquisition status.</p>
      </div>
      <TrackerTable 
        title="Procurement Records" 
        data={procurementData} 
        columns={[
          { header: "ID", accessorKey: "id" },
          { header: "Vendor", accessorKey: "vendor" },
          { header: "Description", accessorKey: "description" },
          { header: "Amount", accessorKey: (i) => `R${parseFloat(i.amount).toLocaleString()}` },
          { header: "Status", accessorKey: "status" },
        ]} 
        onExport={() => window.open("/api/export/expenses", "_blank")}
      />
    </div>
  );
}

function ConstructionPage() {
  const { data } = useProgramData();
  const constructionData = data?.expenses.filter(e => 
    e.category === "Construction" || e.category === "Grid Connection"
  ) || [];
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Construction & Grid</h2>
        <p className="text-muted-foreground">On-site progress and grid connection milestones.</p>
      </div>
      <TrackerTable 
        title="Construction Milestones" 
        data={constructionData} 
        columns={[
          { header: "ID", accessorKey: "id" },
          { header: "Category", accessorKey: "category" },
          { header: "Description", accessorKey: "description" },
          { header: "Amount", accessorKey: (i) => `R${parseFloat(i.amount).toLocaleString()}` },
          { header: "Date", accessorKey: (i) => format(new Date(i.date), "dd MMM yyyy") },
        ]} 
        onExport={() => window.open("/api/export/expenses", "_blank")}
      />
    </div>
  );
}

function TaskRegisterPage() {
  const { data } = useProgramData();
  const projects = data?.projects || [];
  const tasks = data?.tasks || [];
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Task Register</h2>
        <p className="text-muted-foreground">Master schedule and action items.</p>
      </div>
      <TrackerTable 
        title="All Project Tasks" 
        data={tasks} 
        columns={[
          { header: "Task Name", accessorKey: "taskName", className: "font-medium" },
          { header: "Project", accessorKey: (t) => projects.find(p => p.id === t.projectId)?.name || "Unknown" },
          { header: "Assignee", accessorKey: "assignee" },
          { header: "Start", accessorKey: "startDate" },
          { header: "End", accessorKey: "endDate" },
          { 
            header: "Progress", 
            accessorKey: (t) => (
              <div className="w-24 bg-secondary rounded-full h-2 overflow-hidden">
                <div className="bg-primary h-full" style={{ width: `${t.progress}%` }} />
              </div>
            ) 
          },
          { 
            header: "Status", 
            accessorKey: (t) => (
              <Badge variant={t.status === 'Complete' ? 'default' : t.status === 'Delayed' ? 'destructive' : 'outline'}>
                {t.status}
              </Badge>
            )
          },
        ]} 
        onExport={() => window.open("/api/export/tasks", "_blank")}
      />
    </div>
  );
}

function CompliancePage() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-heading font-bold text-foreground">Compliance</h2>
      <Card className="p-12 border-2 border-dashed flex items-center justify-center text-muted-foreground">
        Compliance module pending regulatory data integration.
      </Card>
    </div>
  );
}

function ProtectedPages() {
  return (
    <RoleGuard>
    <AppLayout>
      <Switch>
        <Route path="/">{() => {
          const role = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
          if (role === "PROJECT_MANAGER_SITE") return <Redirect to="/pm-dashboard" />;
          return <Home />;
        }}</Route>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/projects" component={ProjectsSummary} />
        <Route path="/project/:projectName" component={ProjectDetailPage} />
        <Route path="/cashflow" component={CashflowPage} />
        <Route path="/revenue" component={RevenueTracker} />
        <Route path="/cos" component={CostTracker} />
        <Route path="/cos-control" component={CosControlPage} />
        <Route path="/cashflow-forecast" component={CashflowForecastPage} />
        <Route path="/my-tool" component={MyToolTodayPage} />
        <Route path="/my-tool/week" component={MyToolWeekPage} />
        <Route path="/my-tool/backlog" component={MyToolBacklogPage} />
        <Route path="/my-tool/settings" component={MyToolSettingsPage} />
        <Route path="/company-priorities" component={MyToolPrioritiesPage} />
        <Route path="/my-tool/help" component={MyToolHelpPage} />
        <Route path="/upload">{() => <Redirect to="/admin" />}</Route>
        <Route path="/admin" component={AdminPage} />
        <Route path="/admin/my-tool-settings" component={MyToolAdminSettingsPage} />
        <Route path="/quality" component={QmDashboardPage} />
        <Route path="/engineering" component={EngineeringDashboardPage} />
        <Route path="/engineering/tasks" component={EngineeringTasksPage} />
        <Route path="/admin/phase-templates" component={PhaseTemplatesPage} />
        <Route path="/project-create" component={ProjectCreatePage} />
        <Route path="/lifecycle-board" component={LifecycleBoardPage} />
        <Route path="/execution-board" component={ExecutionBoardPage} />
        <Route path="/my-tool/triage-inbox" component={TriageInboxPage} />
        <Route path="/my-tool/unclassified-tasks" component={UnclassifiedTasksPage} />
        <Route path="/my-tool/meetings" component={MyToolMeetingsPage} />
        <Route path="/admin/settings" component={RoleSettingsPage} />
        <Route path="/smart-import" component={SmartImportPage} />
        <Route path="/project-normalized/:projectName" component={ProjectNormalizedViewPage} />
        <Route path="/engineering/sync" component={EngineeringSyncPage} />
        <Route path="/engineering/inbox" component={EngineeringInboxPage} />
        <Route path="/invoice-patterns" component={InvoicePatternsPage} />
        <Route path="/subcontractor-dashboard" component={SubcontractorDashboardPage} />
        <Route path="/admin/activity-log" component={SystemActivityLogPage} />
        <Route path="/weekly-reviews" component={WeeklyReviewsPage} />
        <Route path="/admin/roles" component={AdminRolesPage} />
        <Route path="/admin/approvals" component={AdminApprovalsPage} />
        <Route path="/tr-register" component={TrRegisterPage} />
        <Route path="/feedback" component={FeedbackPage} />
        <Route path="/ee-info" component={EeInfoPage} />
        <Route path="/pm-dashboard" component={PMDashboard} />
        <Route path="/admin/eng-templates">{() => <Redirect to="/admin/phase-templates" />}</Route>

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
    </RoleGuard>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/auth/login" component={LoginPage} />
      <Route>
        <ProtectedRoute>
          <ProtectedPages />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProgramProvider>
            <Router />
            <Toaster />
          </ProgramProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { ProgramProvider } from "@/hooks/use-program-data";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import ProjectsSummary from "@/pages/projects";
import CashflowPage from "@/pages/cashflow";
import RevenueTracker from "@/pages/revenue";
import CostTracker from "@/pages/cos";
import UploadPage from "@/pages/upload";
import NotFound from "@/pages/not-found";
import ProjectDetailPage from "@/pages/project-detail";
import { useProgramData } from "@/hooks/use-program-data";
import { TrackerTable } from "@/components/dashboard/TrackerTable";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

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
          { header: "Amount", accessorKey: (i) => `$${parseFloat(i.amount).toLocaleString()}` },
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
          { header: "Amount", accessorKey: (i) => `$${parseFloat(i.amount).toLocaleString()}` },
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
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={ProjectsSummary} />
        <Route path="/project/:projectName" component={ProjectDetailPage} />
        <Route path="/cashflow" component={CashflowPage} />
        <Route path="/revenue" component={RevenueTracker} />
        <Route path="/cos" component={CostTracker} />
        <Route path="/upload" component={UploadPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
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

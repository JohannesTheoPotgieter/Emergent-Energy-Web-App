import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ProgramProvider } from "@/hooks/use-program-data";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import ProjectsSummary from "@/pages/projects";
import CashflowPage from "@/pages/cashflow";
import RevenueTracker from "@/pages/revenue";
import CostTracker from "@/pages/cos";
import BudgetPage from "@/pages/budget";
import NotFound from "@/pages/not-found";

// Filtered wrappers for reused components
import { useProgramData } from "@/hooks/use-program-data";
import { TrackerTable } from "@/components/dashboard/TrackerTable";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

function ProcurementPage() {
  const { data } = useProgramData();
  const procurementData = data.expenses.filter(e => e.category === "Procurement");
  
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
          { header: "PO Number", accessorKey: "id" },
          { header: "Vendor", accessorKey: "vendor" },
          { header: "Description", accessorKey: "description" },
          { header: "Amount", accessorKey: (i) => `$${i.amount.toLocaleString()}` },
          { header: "Status", accessorKey: "status" },
        ]} 
      />
    </div>
  );
}

function ConstructionPage() {
  const { data } = useProgramData();
  const constructionData = data.expenses.filter(e => e.category === "Construction" || e.category === "Grid Connection");
  
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
          { header: "Amount", accessorKey: (i) => `$${i.amount.toLocaleString()}` },
          { header: "Date", accessorKey: (i) => format(new Date(i.date), "dd MMM yyyy") },
        ]} 
      />
    </div>
  );
}

function TaskRegisterPage() {
  const { data } = useProgramData();
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Task Register</h2>
        <p className="text-muted-foreground">Master schedule and action items.</p>
      </div>
      <TrackerTable 
        title="All Project Tasks" 
        data={data.tasks} 
        columns={[
          { header: "Task Name", accessorKey: "taskName", className: "font-medium" },
          { header: "Project", accessorKey: (t) => data.projects.find(p => p.id === t.projectId)?.name },
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
      />
    </div>
  );
}

function CompliancePage() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-heading font-bold text-foreground">Compliance</h2>
      <div className="p-12 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground">
        Compliance module pending regulatory data integration.
      </div>
    </div>
  );
}


function Router() {
  return (
    <Switch>
      <Route path="/auth/login" component={LoginPage} />
      
      {/* Protected Routes Wrapper */}
      <Route path="/:rest*">
        <AppLayout>
           <Switch>
             <Route path="/" component={Dashboard} />
             <Route path="/projects" component={ProjectsSummary} />
             <Route path="/cashflow" component={CashflowPage} />
             <Route path="/revenue" component={RevenueTracker} />
             <Route path="/cos" component={CostTracker} />
             <Route path="/procurement" component={ProcurementPage} />
             <Route path="/construction" component={ConstructionPage} />
             <Route path="/compliance" component={CompliancePage} />
             <Route path="/tasks" component={TaskRegisterPage} />
             <Route path="/budget" component={BudgetPage} />
             <Route component={NotFound} />
           </Switch>
        </AppLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProgramProvider>
        <Router />
        <Toaster />
      </ProgramProvider>
    </QueryClientProvider>
  );
}

export default App;

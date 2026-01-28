import { useProgramData } from "@/hooks/use-program-data";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Activity, AlertCircle, Banknote } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { overview, projectsSummary, isLoading } = useProgramData();
  
  if (isLoading && !overview) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Program Overview</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-muted/20 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const totalBudget = overview?.total_program_budget || 0;
  const actualSpendPaid = overview?.actual_spend_paid || 0;
  const revenueRealised = overview?.revenue_realised || 0;
  const activeProjects = overview?.active_projects || 0;
  const dataAsOf = overview?.data_as_of ? new Date(overview.data_as_of) : new Date();

  const budgetUtilization = totalBudget > 0 ? (actualSpendPaid / totalBudget) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Program Overview</h2>
        <p className="text-muted-foreground">
          High-level insights across FY26 renewable energy portfolio
          {overview?.data_as_of && (
            <span className="ml-2 text-xs text-muted-foreground">
              • Data as of {format(dataAsOf, "dd MMM yyyy, HH:mm")}
            </span>
          )}
        </p>
      </div>

      {/* Top Metrics Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard 
          title="Total Program Budget" 
          value={`R${(totalBudget / 1000000).toFixed(2)}M`} 
          subValue={`${activeProjects} Active Projects`}
          icon={DollarSign}
          data-testid="card-total-budget"
        />
        <SummaryCard 
          title="Actual Spend (Paid)" 
          value={`R${(actualSpendPaid / 1000000).toFixed(2)}M`} 
          subValue={budgetUtilization > 0 ? `${budgetUtilization.toFixed(1)}% of Budget` : "No spend recorded"}
          trend={budgetUtilization > 50 ? "up" : budgetUtilization > 0 ? "neutral" : undefined}
          icon={Activity}
          data-testid="card-actual-spend"
        />
        <SummaryCard 
          title="Revenue Realised" 
          value={`R${(revenueRealised / 1000000).toFixed(2)}M`} 
          subValue={revenueRealised > 0 ? "Payments received" : "No revenue realised"}
          trend={revenueRealised > 0 ? "up" : undefined}
          icon={Banknote}
          data-testid="card-revenue-realised"
        />
        <SummaryCard 
          title="Active Projects" 
          value={activeProjects} 
          subValue={activeProjects > 0 ? "Projects in portfolio" : "Upload trackers to begin"}
          icon={AlertCircle}
          className={activeProjects === 0 ? "border-l-amber-500" : "border-l-emerald-500"}
          data-testid="card-active-projects"
        />
      </div>

      {/* Projects Summary Section */}
      {projectsSummary && projectsSummary.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Recent Project Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {projectsSummary.slice(0, 5).map((project, i) => {
                const gpPercentDisplay = project.gp_percent !== null 
                  ? `${(project.gp_percent * 100).toFixed(1)}% GP` 
                  : "No GP data";
                const completionDisplay = project.project_pct_complete !== null
                  ? `${(project.project_pct_complete * 100).toFixed(0)}% complete`
                  : "No progress data";
                
                return (
                  <div key={project.project_name} className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{project.project_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {project.phase || "Phase unknown"} • {completionDisplay} • {gpPercentDisplay}
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-sm font-medium">R{(project.actual_revenue / 1000000).toFixed(2)}M</p>
                      <p className="text-xs text-muted-foreground">Revenue</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {activeProjects === 0 && (
        <Card className="border-2 border-dashed border-muted">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Project Data Available</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Upload your Excel tracker files (e.g., "1 Bolt Ave_Tracker.xlsx", "Coega Steels Ph2_Tracker.xlsx") 
              using the "Upload Tracker" button in the top navigation to populate the dashboard.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

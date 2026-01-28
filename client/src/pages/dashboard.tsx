import { useProgramData } from "@/hooks/use-program-data";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Activity, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Dashboard() {
  const { data } = useProgramData();
  
  // Calculate aggregate metrics
  const totalBudget = data.projects.reduce((sum, p) => sum + p.budget, 0);
  const totalSpent = data.expenses.filter(e => e.status === 'Paid').reduce((sum, e) => sum + e.amount, 0);
  const totalRevenue = data.revenues.filter(r => r.status === 'Realised').reduce((sum, r) => sum + r.amount, 0);
  const activeProjects = data.projects.filter(p => p.status === 'Active').length;

  const budgetUtilization = (totalSpent / totalBudget) * 100;

  // Chart Data Preparation
  const expensesByCategory = data.expenses.reduce((acc, curr) => {
    acc[curr.category] = (acc[curr.category] || 0) + curr.amount;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(expensesByCategory).map(([name, value]) => ({ name, value }));
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Program Overview</h2>
        <p className="text-muted-foreground">High-level insights across all {data.projects.length} portfolio projects.</p>
      </div>

      {/* Top Metrics Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard 
          title="Total Program Budget" 
          value={`$${(totalBudget / 1000000).toFixed(1)}M`} 
          subValue={`${data.projects.length} Projects Loaded`}
          icon={DollarSign}
        />
        <SummaryCard 
          title="Actual Spend (Paid)" 
          value={`$${(totalSpent / 1000000).toFixed(1)}M`} 
          subValue={`${budgetUtilization.toFixed(1)}% of Budget`}
          trend={budgetUtilization > 50 ? "up" : "neutral"}
          trendValue="+12%" // Mock trend
          icon={Activity}
        />
        <SummaryCard 
          title="Revenue Realised" 
          value={`$${(totalRevenue / 1000000).toFixed(1)}M`} 
          trend="up"
          trendValue="+5.2%"
          icon={Activity}
        />
        <SummaryCard 
          title="Active Projects" 
          value={activeProjects} 
          subValue={`${data.tasks.filter(t => t.status === 'Delayed').length} Tasks Delayed`}
          icon={AlertCircle}
          className="border-l-rose-500"
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 border-none shadow-sm">
          <CardHeader>
            <CardTitle>Expenditure by Category</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
             <ResponsiveContainer width="100%" height={350}>
                <BarChart data={pieData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(value) => `$${value/1000}k`} 
                  />
                  <Tooltip 
                    cursor={{fill: 'transparent'}}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
             </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-3 border-none shadow-sm">
           <CardHeader>
             <CardTitle>Recent Activity</CardTitle>
           </CardHeader>
           <CardContent>
              <div className="space-y-4">
                 {data.projects.slice(0, 5).map((project, i) => (
                    <div key={project.id} className="flex items-center">
                       <div className="w-2 h-2 rounded-full bg-primary mr-2" />
                       <div className="flex-1 space-y-1">
                          <p className="text-sm font-medium leading-none">{project.name}</p>
                          <p className="text-xs text-muted-foreground">{project.status} • {project.stage}</p>
                       </div>
                       <div className="ml-auto font-medium text-xs text-muted-foreground">
                          Updated {i * 2 + 1}h ago
                       </div>
                    </div>
                 ))}
              </div>
           </CardContent>
        </Card>
      </div>
    </div>
  );
}

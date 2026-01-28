import { useProgramData } from "@/hooks/use-program-data";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  ReferenceLine 
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { startOfWeek, format, addWeeks, isSameWeek } from "date-fns";
import { TrackerTable } from "@/components/dashboard/TrackerTable";

export default function CashflowPage() {
  const { data } = useProgramData();

  const expenses = data?.expenses || [];
  const revenues = data?.revenues || [];

  // Aggregate data by week
  // This is a simplified aggregation for the chart
  const weeks: Record<string, { week: string, inflow: number, outflow: number, net: number }> = {};
  
  // Initialize last 12 weeks and next 12 weeks
  const today = new Date();
  const start = addWeeks(startOfWeek(today), -12);
  
  for (let i = 0; i < 24; i++) {
    const weekDate = addWeeks(start, i);
    const weekKey = format(weekDate, "yyyy-MM-dd");
    weeks[weekKey] = { week: format(weekDate, "dd MMM"), inflow: 0, outflow: 0, net: 0 };
  }

  // Bucket expenses
  expenses.forEach(e => {
    const date = new Date(e.date);
    const weekStart = format(startOfWeek(date), "yyyy-MM-dd");
    if (weeks[weekStart]) {
      weeks[weekStart].outflow += parseFloat(e.amount || '0');
    }
  });

  // Bucket revenue
  revenues.forEach(r => {
    const date = new Date(r.date);
    const weekStart = format(startOfWeek(date), "yyyy-MM-dd");
    if (weeks[weekStart]) {
      weeks[weekStart].inflow += parseFloat(r.amount || '0');
    }
  });

  // Calculate Net
  Object.values(weeks).forEach(w => {
    w.net = w.inflow - w.outflow;
  });

  const chartData = Object.values(weeks);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Cashflow Timeline</h2>
        <p className="text-muted-foreground">
           Weekly cashflow analysis (Inflows vs Outflows).
        </p>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Net Cashflow (Next 12 Weeks)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val/1000}k`} />
                <Tooltip 
                   formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
                   contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Legend />
                <ReferenceLine y={0} stroke="#000" />
                <Bar dataKey="inflow" name="Inflow (Revenue)" fill="#10b981" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="outflow" name="Outflow (Expenses)" fill="#ef4444" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Top Outflows (Next 30 Days)</CardTitle></CardHeader>
          <CardContent>
             <div className="space-y-4">
               {expenses
                 .filter(e => e.status === 'Forecast')
                 .sort((a,b) => parseFloat(b.amount || '0') - parseFloat(a.amount || '0'))
                 .slice(0, 5)
                 .map(e => (
                   <div key={e.id} className="flex justify-between items-center border-b pb-2 last:border-0">
                      <div>
                        <div className="font-medium text-sm">{e.description}</div>
                        <div className="text-xs text-muted-foreground">{e.vendor} • {format(new Date(e.date), "dd MMM")}</div>
                      </div>
                      <div className="font-mono font-bold text-rose-600">-${parseFloat(e.amount || '0').toLocaleString()}</div>
                   </div>
                 ))
               }
             </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Expected Inflows (Next 30 Days)</CardTitle></CardHeader>
          <CardContent>
             <div className="space-y-4">
               {revenues
                 .filter(r => r.status === 'Forecast' || r.status === 'Realised')
                 .sort((a,b) => parseFloat(b.amount || '0') - parseFloat(a.amount || '0'))
                 .slice(0, 5)
                 .map(r => (
                   <div key={r.id} className="flex justify-between items-center border-b pb-2 last:border-0">
                      <div>
                        <div className="font-medium text-sm">{r.type} Revenue</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(r.date), "dd MMM")}</div>
                      </div>
                      <div className="font-mono font-bold text-emerald-600">+${parseFloat(r.amount || '0').toLocaleString()}</div>
                   </div>
                 ))
               }
               {revenues.length === 0 && <div className="text-muted-foreground text-sm italic">No expected inflows found.</div>}
             </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

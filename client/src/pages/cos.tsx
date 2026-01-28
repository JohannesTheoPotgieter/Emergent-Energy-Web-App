import { useProgramData } from "@/hooks/use-program-data";
import { TrackerTable } from "@/components/dashboard/TrackerTable";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function CostTracker() {
  const { data, exportUrl } = useProgramData();

  const projects = data?.projects || [];
  const expenses = data?.expenses || [];

  const handleExport = () => {
    window.location.href = exportUrl("expenses");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Cost of Sales (COS)</h2>
        <p className="text-muted-foreground">
           Project expenditure breakdown by category and vendor.
        </p>
      </div>

      <TrackerTable 
        title="Expenditure Entries"
        data={expenses}
        columns={[
          { header: "ID", accessorKey: "id", className: "font-mono text-xs text-muted-foreground" },
          { header: "Project", accessorKey: (item) => projects.find(p => p.id === item.projectId)?.name || item.projectId },
          { header: "Vendor", accessorKey: "vendor" },
          { header: "Description", accessorKey: "description", className: "max-w-[300px] truncate" },
          { header: "Category", accessorKey: "category" },
          { 
            header: "Date", 
            accessorKey: (item) => format(new Date(item.date), "dd MMM yyyy") 
          },
          { 
             header: "Amount", 
             accessorKey: (item) => <span className="font-mono">${parseFloat(item.amount || '0').toLocaleString()}</span>,
             className: "text-right" 
          },
          { 
            header: "Status", 
            accessorKey: (item) => (
              <Badge variant={item.status === 'Paid' ? 'secondary' : 'outline'}>
                {item.status}
              </Badge>
            )
          },
        ]}
        onExport={handleExport}
      />
    </div>
  );
}

import { useProgramData } from "@/hooks/use-program-data";
import { TrackerTable } from "@/components/dashboard/TrackerTable";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function RevenueTracker() {
  const { data, exportUrl } = useProgramData();

  const projects = data?.projects || [];
  const revenues = data?.revenues || [];

  const handleExport = () => {
    window.location.href = exportUrl("revenues");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Revenue Tracker (REV)</h2>
        <p className="text-muted-foreground">
           Consolidated revenue tracking from all project PPA and merchant sources.
        </p>
      </div>

      <TrackerTable 
        title="Revenue Entries"
        data={revenues}
        columns={[
          { header: "ID", accessorKey: "id", className: "font-mono text-xs text-muted-foreground" },
          { header: "Project", accessorKey: (item) => projects.find(p => p.id === item.projectId)?.name || item.projectId },
          { header: "Type", accessorKey: "type" },
          { 
            header: "Date", 
            accessorKey: (item) => format(new Date(item.date), "dd MMM yyyy") 
          },
          { 
             header: "Amount", 
             accessorKey: (item) => <span className="text-emerald-600 font-bold font-mono">+${parseFloat(item.amount || '0').toLocaleString()}</span>,
             className: "text-right" 
          },
          { 
            header: "Status", 
            accessorKey: (item) => (
              <Badge variant={item.status === 'Realised' ? 'default' : 'outline'} className={item.status === 'Realised' ? 'bg-emerald-600' : ''}>
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

import { useProgramData } from "@/hooks/use-program-data";
import { TrackerTable } from "@/components/dashboard/TrackerTable";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

export default function ProjectsSummary() {
  const { data } = useProgramData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Projects Summary</h2>
        <p className="text-muted-foreground">
           Portfolio status, budget progress, and key milestones.
        </p>
      </div>

      <TrackerTable 
        title="Active Portfolio Projects"
        data={data.projects}
        columns={[
          { header: "Project Code", accessorKey: "code", className: "font-mono font-bold text-primary" },
          { header: "Project Name", accessorKey: "name", className: "font-medium" },
          { header: "Manager", accessorKey: "manager" },
          { header: "Site", accessorKey: "site" },
          { 
            header: "Status", 
            accessorKey: (project) => (
              <Badge variant={
                project.status === 'Active' ? 'default' : 
                project.status === 'Completed' ? 'secondary' : 
                'outline'
              }>
                {project.status}
              </Badge>
            )
          },
          { header: "Stage", accessorKey: "stage" },
          { 
            header: "Budget Progress", 
            accessorKey: (project) => (
              <div className="flex items-center gap-2 w-32">
                 <Progress value={Math.random() * 80 + 10} className="h-2" />
                 <span className="text-xs text-muted-foreground">{(Math.random() * 80 + 10).toFixed(0)}%</span>
              </div>
            )
          },
          { 
             header: "Budget", 
             accessorKey: (p) => `$${(p.budget / 1000000).toFixed(1)}M`,
             className: "text-right font-mono" 
          },
          { 
            header: "Start Date", 
            accessorKey: (p) => format(new Date(p.startDate), "MMM yyyy") 
          },
        ]}
        onExport={() => alert("Export functionality would go here.")}
      />
    </div>
  );
}

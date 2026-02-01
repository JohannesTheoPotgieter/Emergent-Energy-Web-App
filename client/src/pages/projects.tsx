import { useProgramData } from "@/hooks/use-program-data";
import { TrackerTable } from "@/components/dashboard/TrackerTable";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function ProjectsSummary() {
  const { projectsSummary, exportUrl, isLoading } = useProgramData();
  const [, setLocation] = useLocation();

  // Map ProjectSummary to include id field for TrackerTable
  const projects = (projectsSummary || []).map((p, idx) => ({
    ...p,
    id: p.project_name,
  }));

  const handleExport = () => {
    window.location.href = exportUrl("projects-summary");
  };

  const handleRowClick = (project: any) => {
    setLocation(`/project/${encodeURIComponent(project.project_name)}`);
  };

  if (isLoading && !projectsSummary) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Projects Summary</h2>
        <div className="h-96 bg-muted/20 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-heading font-bold text-foreground">Projects Summary</h2>
          <p className="text-muted-foreground">
            Portfolio status, financial progress, and key performance indicators.
          </p>
        </div>

        <Card className="border-2 border-dashed border-muted">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Projects Available</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Upload tracker files to populate the Projects Summary dashboard with financial metrics, 
              progress tracking, and outstanding items.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Projects Summary</h2>
        <p className="text-muted-foreground">
          Excel-aligned portfolio overview with financial metrics and progress tracking
        </p>
      </div>

      <TrackerTable 
        title={`Active Portfolio Projects (${projects.length})`}
        data={projects}
        onRowClick={handleRowClick}
        columns={[
          { 
            header: "Project Name", 
            accessorKey: "project_name", 
            className: "font-medium text-primary max-w-[200px]" 
          },
          { 
            header: "Size (kWp)", 
            accessorKey: (p) => p.size_kwp ? p.size_kwp.toFixed(0) : "-",
            className: "text-right font-mono text-xs"
          },
          { 
            header: "PD", 
            accessorKey: "pd",
            className: "text-xs"
          },
          { 
            header: "PM", 
            accessorKey: "pm",
            className: "text-xs"
          },
          { 
            header: "Phase", 
            accessorKey: (p) => (
              <Badge variant={
                p.phase === 'Construction' ? 'default' : 
                p.phase === 'Development' ? 'secondary' : 
                'outline'
              }>
                {p.phase || "Unknown"}
              </Badge>
            )
          },
          { 
            header: "Project %", 
            accessorKey: (p) => p.project_pct_complete !== null 
              ? `${(p.project_pct_complete * 100).toFixed(0)}%` 
              : "-",
            className: "text-right font-mono text-xs"
          },
          { 
            header: "Expected %", 
            accessorKey: (p) => p.expected_pct_complete !== null 
              ? `${(p.expected_pct_complete * 100).toFixed(0)}%` 
              : "-",
            className: "text-right font-mono text-xs"
          },
          { 
            header: "Δ vs Expected", 
            accessorKey: (p) => {
              if (p.delta_vs_expected === null) return "-";
              const delta = p.delta_vs_expected * 100;
              const sign = delta >= 0 ? "+" : "";
              const color = delta >= 0 ? "text-emerald-600" : "text-rose-600";
              return <span className={`${color} font-mono text-xs`}>{sign}{delta.toFixed(1)}%</span>;
            },
            className: "text-right"
          },
          { 
            header: "Actual Revenue", 
            accessorKey: (p) => `R${(p.actual_revenue / 1000000).toFixed(2)}M`,
            className: "text-right font-mono text-xs"
          },
          { 
            header: "Actual Expenses", 
            accessorKey: (p) => `R${(p.actual_expenses / 1000000).toFixed(2)}M`,
            className: "text-right font-mono text-xs"
          },
          { 
            header: "GP %", 
            accessorKey: (p) => p.gp_percent !== null 
              ? `${(p.gp_percent * 100).toFixed(1)}%` 
              : "-",
            className: "text-right font-mono text-xs"
          },
          { 
            header: "Rev Outstanding", 
            accessorKey: (p) => `R${(p.revenue_outstanding / 1000000).toFixed(2)}M`,
            className: "text-right font-mono text-xs text-amber-600"
          },
          { 
            header: "Exp Outstanding", 
            accessorKey: (p) => `R${(p.expenses_outstanding / 1000000).toFixed(2)}M`,
            className: "text-right font-mono text-xs text-amber-600"
          },
        ]}
        onExport={handleExport}
      />
    </div>
  );
}

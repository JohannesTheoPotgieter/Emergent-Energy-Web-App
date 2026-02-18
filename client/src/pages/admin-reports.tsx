import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileBarChart, ChevronRight } from "lucide-react";

export default function AdminReportsPage() {
  return (
    <div data-testid="admin-reports" className="space-y-6">
      <div className="flex items-center gap-3">
        <FileBarChart className="h-7 w-7 text-emerald-600" />
        <div>
          <h2 className="text-2xl font-heading font-bold" data-testid="text-reports-title">Reports</h2>
          <p className="text-sm text-muted-foreground">Generate and export operational reports</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/reports/operational-overview">
          <Card className="cursor-pointer hover:border-emerald-400 transition-colors group" data-testid="link-operational-overview">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                Operational Overview
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-600 transition-colors" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Monthly KPI dashboard — active projects, construction starts, handovers, commissionings, and RAG status.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

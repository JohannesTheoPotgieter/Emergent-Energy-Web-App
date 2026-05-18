import { useOperationalReports } from "@/hooks/use-performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  S07_COMMISSIONING: "Commissioning",
  S08_OM_HANDOVER: "O&M Handover",
  S09_CLIENT_HANDOVER: "Client Handover",
};

interface CommissioningQueueRow {
  project_name: string;
  pm?: string | null;
  stage_status: string;
  readiness_pct: number;
  days_in_stage: number;
}

interface WeeklyComplianceRow {
  project_name: string;
  pm?: string | null;
  current_stage_code: string;
  compliance_status: string;
  last_review_date?: string | null;
}

export function OperationalReports() {
  // useOperationalReports() types its arrays as unknown[]; assert API row shapes.
  const { data, isLoading } = useOperationalReports();

  if (isLoading) return <div className="animate-pulse h-32 bg-muted rounded" />;

  return (
    <div className="space-y-4">
      {/* Commissioning Queue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Commissioning Queue
            <Badge variant="secondary">{data?.commissioningQueue?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.commissioningQueue?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No projects in commissioning.</p>
          ) : (
            <div className="border rounded overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">Project</th>
                    <th className="p-2 text-left font-medium">PM</th>
                    <th className="p-2 text-left font-medium">Status</th>
                    <th className="p-2 text-right font-medium">Readiness</th>
                    <th className="p-2 text-right font-medium">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {(data!.commissioningQueue as CommissioningQueueRow[]).map((p, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 font-medium">{p.project_name}</td>
                      <td className="p-2 text-muted-foreground">{p.pm || "-"}</td>
                      <td className="p-2"><Badge variant="outline" className="text-[10px]">{p.stage_status}</Badge></td>
                      <td className="p-2 text-right">{p.readiness_pct}%</td>
                      <td className="p-2 text-right"><Clock className="h-3 w-3 inline mr-0.5" />{p.days_in_stage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly Updates Compliance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Weekly Client Updates Compliance
            <Badge variant="secondary">{data?.weeklyCompliance?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.weeklyCompliance?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No compliance data.</p>
          ) : (
            <div className="border rounded overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">Project</th>
                    <th className="p-2 text-left font-medium">PM</th>
                    <th className="p-2 text-left font-medium">Stage</th>
                    <th className="p-2 text-left font-medium">Status</th>
                    <th className="p-2 text-left font-medium">Last Update</th>
                  </tr>
                </thead>
                <tbody>
                  {(data!.weeklyCompliance as WeeklyComplianceRow[]).map((p, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 font-medium">{p.project_name}</td>
                      <td className="p-2 text-muted-foreground">{p.pm || "-"}</td>
                      <td className="p-2 text-xs">{STAGE_LABELS[p.current_stage_code] || p.current_stage_code}</td>
                      <td className="p-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            p.compliance_status === "overdue" ? "bg-red-100 text-red-800" :
                            p.compliance_status === "never" ? "bg-gray-100 text-gray-800" :
                            "bg-green-100 text-green-800"
                          }`}
                        >
                          {p.compliance_status}
                        </Badge>
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {p.last_review_date ? new Date(p.last_review_date).toLocaleDateString() : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

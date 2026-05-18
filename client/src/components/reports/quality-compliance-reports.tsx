import { useQualityComplianceReports } from "@/hooks/use-performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STAGE_LABELS: Record<string, string> = {
  S06_CONSTRUCTION: "Construction",
  S07_COMMISSIONING: "Commissioning",
  S08_OM_HANDOVER: "O&M Handover",
  S09_CLIENT_HANDOVER: "Client Handover",
};

interface BlockerRow {
  project_name: string;
  stage_code: string;
  blocker_count: number;
}

export function QualityComplianceReports() {
  // useQualityComplianceReports() types its arrays as unknown[]; assert shapes.
  const { data, isLoading } = useQualityComplianceReports();

  if (isLoading) return <div className="animate-pulse h-32 bg-muted rounded" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quality Blockers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Quality Blockers
              <Badge variant="secondary">{data?.qualityBlockers?.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.qualityBlockers?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No quality blockers.</p>
            ) : (
              <div className="space-y-1">
                {(data!.qualityBlockers as BlockerRow[]).map((q, i) => (
                  <div key={i} className="flex items-center justify-between text-xs border rounded p-2">
                    <div>
                      <span className="font-medium">{q.project_name}</span>
                      <span className="text-muted-foreground ml-2">{STAGE_LABELS[q.stage_code] || q.stage_code}</span>
                    </div>
                    <Badge variant="outline" className="bg-red-100 text-red-800 text-[10px]">
                      {q.blocker_count} blocker{Number(q.blocker_count) !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Compliance Blockers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Compliance Blockers
              <Badge variant="secondary">{data?.complianceBlockers?.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.complianceBlockers?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No compliance blockers.</p>
            ) : (
              <div className="space-y-1">
                {(data!.complianceBlockers as BlockerRow[]).map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs border rounded p-2">
                    <div>
                      <span className="font-medium">{c.project_name}</span>
                      <span className="text-muted-foreground ml-2">{STAGE_LABELS[c.stage_code] || c.stage_code}</span>
                    </div>
                    <Badge variant="outline" className="bg-orange-100 text-orange-800 text-[10px]">
                      {c.blocker_count} blocker{Number(c.blocker_count) !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

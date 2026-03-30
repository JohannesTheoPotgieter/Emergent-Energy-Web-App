import { useGateReports } from "@/hooks/use-performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle } from "lucide-react";

const RISK_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-green-100 text-green-800",
};

export function GateReports() {
  const { data, isLoading } = useGateReports();

  if (isLoading) return <div className="animate-pulse h-32 bg-muted rounded" />;

  return (
    <div className="space-y-4">
      {/* Blocked Gates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Blocked Gates
            <Badge variant="secondary">{data?.blockedGates?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.blockedGates?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No blocked gates.</p>
          ) : (
            <div className="border rounded overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">Project</th>
                    <th className="p-2 text-left font-medium">Stage</th>
                    <th className="p-2 text-left font-medium">Owner</th>
                    <th className="p-2 text-left font-medium">Waiting On</th>
                    <th className="p-2 text-right font-medium">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.blockedGates.map((g: any, i: number) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 font-medium">{g.project_name}</td>
                      <td className="p-2">{g.stage_code}</td>
                      <td className="p-2 text-muted-foreground">{g.owner_name || "-"}</td>
                      <td className="p-2 text-muted-foreground">{g.waiting_on_department || "-"}</td>
                      <td className="p-2 text-right">
                        <span className="flex items-center justify-end gap-0.5">
                          <Clock className="h-3 w-3" /> {g.days_blocked}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exception Ageing */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Exception Ageing by Risk Level</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.exceptionAgeing?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No open exceptions.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {data!.exceptionAgeing.map((e: any) => (
                <div key={e.risk_level} className="border rounded-lg p-3 text-center">
                  <Badge variant="outline" className={`text-[10px] ${RISK_COLORS[e.risk_level] || ""}`}>
                    {e.risk_level}
                  </Badge>
                  <p className="text-xl font-semibold font-mono mt-2">{e.count}</p>
                  <p className="text-xs text-muted-foreground">Avg: {e.avg_age}d | Max: {e.max_age}d</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

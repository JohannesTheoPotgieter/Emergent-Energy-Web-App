import { useComplianceGovernance, useComplianceAction } from "@/hooks/use-governance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { CheckCircle, Clock, FileText, AlertTriangle } from "lucide-react";
import { PageSkeleton } from "@/components/ui/page-states";

interface SsegRow {
  id: number;
  project_name: string;
  item_type: string;
  authority?: string | null;
  status: string;
  is_overdue?: boolean;
  days_since_submission: number;
}

interface AuthoritySubmissionRow {
  authority: string | null;
  total: number;
  approved: number;
  pending: number;
  overdue: number;
}

interface MeteringRow {
  project_id: number;
  project_name: string;
  current_stage_code: string;
  pending_metering_count: number;
}

function statusColor(status: string) {
  if (status === "approved") return "bg-green-100 text-green-800";
  if (status === "submitted") return "bg-blue-100 text-blue-800";
  if (status === "rejected") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-600";
}

export function ComplianceGovernanceDrawer({ trigger }: { trigger: React.ReactNode }) {
  // useComplianceGovernance() types its arrays as unknown[]; assert the row
  // shapes the API actually returns at each render boundary.
  const { data, isLoading } = useComplianceGovernance();
  const actionMutation = useComplianceAction();
  const [, navigate] = useLocation();

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full sm:w-[600px] sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Compliance Governance
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-6 mt-4">
            {/* SSEG by Project */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  SSEG Items
                  <Badge variant="secondary">{data?.ssegByProject?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.ssegByProject?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No SSEG items.</p>
                ) : (
                  <div className="space-y-1">
                    {(data!.ssegByProject as SsegRow[]).slice(0, 30).map((s) => (
                      <div key={s.id} className="flex items-center justify-between border rounded p-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <span
                            className="font-medium cursor-pointer hover:underline"
                            onClick={() => navigate(`/project/${encodeURIComponent(s.project_name)}`)}
                          >
                            {s.project_name}
                          </span>
                          <span className="text-muted-foreground ml-2">{s.item_type}</span>
                          {s.authority && <span className="text-muted-foreground ml-1">({s.authority})</span>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className={`text-[10px] ${statusColor(s.status)}`}>
                            {s.status}
                          </Badge>
                          {s.is_overdue && (
                            <span className="text-red-600 flex items-center gap-0.5">
                              <AlertTriangle className="h-3 w-3" />
                            </span>
                          )}
                          {s.days_since_submission > 0 && (
                            <span className="text-muted-foreground flex items-center gap-0.5">
                              <Clock className="h-3 w-3" /> {s.days_since_submission}d
                            </span>
                          )}
                          {s.status !== "approved" && (
                            <Button
                              variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-green-700"
                              onClick={() => actionMutation.mutate({ id: s.id, action: "mark_complete" })}
                            >
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Authority Submissions Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Authority Submissions Tracker</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.authoritySubmissions?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No authority data.</p>
                ) : (
                  <div className="border rounded overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="p-2 text-left font-medium">Authority</th>
                          <th className="p-2 text-right font-medium">Total</th>
                          <th className="p-2 text-right font-medium">Approved</th>
                          <th className="p-2 text-right font-medium">Pending</th>
                          <th className="p-2 text-right font-medium">Overdue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data!.authoritySubmissions as AuthoritySubmissionRow[]).map((a) => (
                          <tr key={a.authority} className="border-b">
                            <td className="p-2 font-medium">{a.authority || "Unknown"}</td>
                            <td className="p-2 text-right">{a.total}</td>
                            <td className="p-2 text-right text-green-600">{a.approved}</td>
                            <td className="p-2 text-right text-blue-600">{a.pending}</td>
                            <td className="p-2 text-right text-red-600">{Number(a.overdue) > 0 ? a.overdue : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Metering/Techsitter Pending */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Techsitter / Metering Pending
                  <Badge variant="secondary">{data?.meteringPending?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.meteringPending?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No metering items pending.</p>
                ) : (
                  <div className="space-y-1">
                    {(data!.meteringPending as MeteringRow[]).map((m) => (
                      <div key={m.project_id} className="flex items-center justify-between border rounded p-2 text-xs">
                        <div>
                          <span className="font-medium">{m.project_name}</span>
                          <span className="text-muted-foreground ml-2">Stage: {m.current_stage_code}</span>
                        </div>
                        <Badge variant="outline" className="bg-amber-100 text-amber-800 text-[10px]">
                          {m.pending_metering_count} pending
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

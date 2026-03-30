import { useState } from "react";
import { useQualityGovernance, useQualityAction } from "@/hooks/use-governance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { CheckCircle, XCircle, AlertTriangle, Clock, Shield } from "lucide-react";
import { PageSkeleton } from "@/components/ui/page-states";

export function QualityGovernanceDrawer({ trigger }: { trigger: React.ReactNode }) {
  const { data, isLoading } = useQualityGovernance();
  const actionMutation = useQualityAction();
  const [, navigate] = useLocation();

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Quality Governance
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-6 mt-4">
            {/* Commissioning Reviews Due */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Commissioning Reviews Due
                  <Badge variant="secondary">{data?.commissioningReviews?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.commissioningReviews?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No commissioning reviews pending.</p>
                ) : (
                  <div className="space-y-2">
                    {data!.commissioningReviews.map((r: any) => (
                      <div key={r.project_id} className="flex items-center justify-between border rounded p-2">
                        <div>
                          <p
                            className="text-sm font-medium cursor-pointer hover:underline"
                            onClick={() => navigate(`/project/${encodeURIComponent(r.project_name)}`)}
                          >
                            {r.project_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Readiness: {r.readiness_pct}% | {r.days_in_stage}d in stage
                          </p>
                        </div>
                        <Button
                          variant="outline" size="sm" className="text-xs"
                          onClick={() => navigate(`/project/${encodeURIComponent(r.project_name)}`)}
                        >
                          Open Gate
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Open Snags / NCRs */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Open Quality Items
                  <Badge variant="secondary">{data?.openSnags?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.openSnags?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No open quality items.</p>
                ) : (
                  <div className="space-y-1">
                    {data!.openSnags.slice(0, 20).map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between border rounded p-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{s.project_name}</span>
                          <span className="text-muted-foreground ml-2">{s.status}</span>
                          {s.owner_name && <span className="text-muted-foreground ml-2">({s.owner_name})</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="flex items-center gap-0.5 text-muted-foreground">
                            <Clock className="h-3 w-3" /> {s.age_days}d
                          </span>
                          <Button
                            variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-green-700"
                            onClick={() => actionMutation.mutate({ id: s.id, action: "close" })}
                          >
                            <CheckCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quality Checklist Completion */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Quality Checklist Completion by Project</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.qualityChecklist?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No quality checklist data.</p>
                ) : (
                  <div className="space-y-1">
                    {data!.qualityChecklist.map((q: any) => (
                      <div key={q.project_id} className="flex items-center justify-between text-xs">
                        <span className="font-medium">{q.project_name}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${q.completion_pct}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground w-10 text-right">{q.completion_pct}%</span>
                        </div>
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

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getQueryFn } from "@/lib/queryClient";
import {  Clock, FileCheck, AlertTriangle } from "lucide-react";

interface ExceptionThreshold {
  autoEscalationDays?: number;
  escalationTarget?: string;
  riskLevels?: string[];
}

interface DeliverableTrack {
  code: string;
  label: string;
  isRequired?: boolean;
}

interface GateConfig {
  slaTimers?: {
    omReviewDays?: number;
    clientHandoverDays?: number;
    exceptionEscalationDays?: number;
    weeklyUpdateOverdueDays?: number;
    postHandoverReviewOverdueDays?: number;
  };
  deliverableTracks?: DeliverableTrack[];
}

export function GateConfigCard() {
  const { data: thresholds } = useQuery<{ thresholds: ExceptionThreshold }>({
    queryKey: ["/api/admin/exception-thresholds"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: gateConfig } = useQuery<{ config: GateConfig }>({
    queryKey: ["/api/admin/gate-config"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const sla = gateConfig?.config?.slaTimers;
  const tracks = gateConfig?.config?.deliverableTracks ?? [];
  const threshold = thresholds?.thresholds;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Exception Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Exception Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span>Auto-escalation after</span>
            <Badge variant="outline">{threshold?.autoEscalationDays ?? 3} days</Badge>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>Escalation target</span>
            <Badge variant="outline">{threshold?.escalationTarget ?? "COO_ADMIN"}</Badge>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Risk levels: </span>
            {(threshold?.riskLevels ?? []).map((r: string) => (
              <Badge key={r} variant="outline" className="text-[10px] mr-1">{r}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SLA Timers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            SLA Timers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {sla ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <span>O&M Review</span><Badge variant="outline">{sla.omReviewDays} days</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>Client Handover</span><Badge variant="outline">{sla.clientHandoverDays} days</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>Exception Escalation</span><Badge variant="outline">{sla.exceptionEscalationDays} days</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>Weekly Update Overdue</span><Badge variant="outline">{sla.weeklyUpdateOverdueDays} days</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>3 Months Post HO Review Overdue</span><Badge variant="outline">{sla.postHandoverReviewOverdueDays} days</Badge>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Loading SLA config...</p>
          )}
        </CardContent>
      </Card>

      {/* Deliverable Tracks */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileCheck className="h-4 w-4" />
            Financial Close Deliverable Tracks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tracks.map((t) => (
              <div key={t.code} className="border rounded p-2 text-xs">
                <p className="font-medium">{t.label}</p>
                <Badge variant="outline" className={`text-[10px] mt-1 ${t.isRequired ? "bg-blue-100 text-blue-800" : ""}`}>
                  {t.isRequired ? "Required" : "Optional"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useAcceptances,
  useCreateAcceptance,
  useAcceptanceReservations,
  useUpdateReservation,
} from "@/hooks/use-collaboration-workflow";
import { CheckCircle2, XCircle, AlertTriangle, Plus, X } from "lucide-react";
import type { StageAcceptance, AcceptanceReservation } from "@shared/schema";

const OUTCOME_BADGES: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  accepted: { label: "Accepted", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  accepted_with_reservations: { label: "Accepted with Reservations", color: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700", icon: XCircle },
};

interface AcceptanceWorkflowProps {
  projectId: number;
  stageCode: string;
  isAdmin?: boolean;
}

export function AcceptanceWorkflow({ projectId, stageCode, isAdmin }: AcceptanceWorkflowProps) {
  const { data: acceptanceData } = useAcceptances(projectId, stageCode);
  const { data: reservationData } = useAcceptanceReservations(projectId, stageCode);
  const createMutation = useCreateAcceptance(projectId);
  const updateReservationMutation = useUpdateReservation(projectId);

  const [showForm, setShowForm] = useState(false);
  const [outcome, setOutcome] = useState<string>("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [reservations, setReservations] = useState<{ description: string; deadline: string }[]>([]);

  const acceptances = acceptanceData?.acceptances || [];
  const openReservations = (reservationData?.reservations || []).filter(
    (r: AcceptanceReservation) => r.status === "open"
  );
  const latestAcceptance = acceptances[0];

  const handleSubmit = async () => {
    if (!outcome) return;
    await createMutation.mutateAsync({
      stageCode,
      outcome,
      rejectionReason: outcome === "rejected" ? rejectionReason : undefined,
      reservations: outcome === "accepted_with_reservations" ? reservations : undefined,
    });
    setShowForm(false);
    setOutcome("");
    setRejectionReason("");
    setReservations([]);
  };

  const addReservation = () => {
    setReservations([...reservations, { description: "", deadline: "" }]);
  };

  const removeReservation = (idx: number) => {
    setReservations(reservations.filter((_, i) => i !== idx));
  };

  const updateReservationField = (idx: number, field: string, value: string) => {
    const updated = [...reservations];
    (updated[idx] as any)[field] = value;
    setReservations(updated);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Acceptance Workflow</CardTitle>
          {!showForm && (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              Record Acceptance
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Current status */}
        {latestAcceptance && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Latest:</span>
            {(() => {
              const badge = OUTCOME_BADGES[latestAcceptance.outcome];
              const Icon = badge?.icon || CheckCircle2;
              return (
                <Badge className={badge?.color || "bg-gray-100"}>
                  <Icon className="mr-1 h-3 w-3" />
                  {badge?.label || latestAcceptance.outcome}
                </Badge>
              );
            })()}
            <span className="text-xs text-muted-foreground">
              {latestAcceptance.decidedDate
                ? new Date(latestAcceptance.decidedDate).toLocaleDateString()
                : ""}
            </span>
          </div>
        )}

        {/* Open reservations */}
        {openReservations.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-amber-700">Open Reservations ({openReservations.length})</p>
            {openReservations.map((r: AcceptanceReservation) => (
              <div key={r.id} className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs">
                <span>{r.description}</span>
                <div className="flex items-center gap-2">
                  {r.deadline && <span className="text-muted-foreground">{r.deadline}</span>}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-xs"
                    onClick={() => updateReservationMutation.mutate({ id: r.id, status: "closed" })}
                  >
                    Close
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Acceptance form */}
        {showForm && (
          <div className="space-y-2 rounded border p-2">
            <div className="flex gap-2">
              {(["accepted", "accepted_with_reservations", "rejected"] as const).map((opt) => {
                const badge = OUTCOME_BADGES[opt];
                return (
                  <Button
                    key={opt}
                    size="sm"
                    variant={outcome === opt ? "default" : "outline"}
                    className="text-xs"
                    onClick={() => setOutcome(opt)}
                  >
                    {badge.label}
                  </Button>
                );
              })}
            </div>

            {outcome === "rejected" && (
              <Textarea
                placeholder="Rejection reason..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="text-sm min-h-[40px]"
                rows={2}
              />
            )}

            {outcome === "accepted_with_reservations" && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Reservations:</p>
                {reservations.map((r, idx) => (
                  <div key={idx} className="flex gap-1">
                    <Input
                      placeholder="Item description..."
                      value={r.description}
                      onChange={(e) => updateReservationField(idx, "description", e.target.value)}
                      className="h-7 text-xs flex-1"
                    />
                    <Input
                      type="date"
                      value={r.deadline}
                      onChange={(e) => updateReservationField(idx, "deadline", e.target.value)}
                      className="h-7 text-xs w-32"
                    />
                    <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => removeReservation(idx)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="text-xs" onClick={addReservation}>
                  <Plus className="mr-1 h-3 w-3" /> Add Reservation
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={handleSubmit} disabled={!outcome || createMutation.isPending}>
                Submit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* History */}
        {acceptances.length > 1 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">History ({acceptances.length})</summary>
            <div className="mt-1 space-y-1">
              {acceptances.slice(1).map((a: StageAcceptance) => {
                const badge = OUTCOME_BADGES[a.outcome];
                return (
                  <div key={a.id} className="flex items-center gap-2">
                    <Badge className={`${badge?.color} text-xs`}>{badge?.label}</Badge>
                    <span>{a.decidedDate ? new Date(a.decidedDate).toLocaleDateString() : ""}</span>
                    {a.rejectionReason && <span className="text-red-600">— {a.rejectionReason}</span>}
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

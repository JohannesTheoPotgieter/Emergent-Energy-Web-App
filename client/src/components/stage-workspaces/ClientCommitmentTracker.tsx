import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useClientCommitments,
  useCreateClientCommitment,
  useUpdateClientCommitment,
} from "@/hooks/use-collaboration-workflow";
import { Plus, CheckCircle2, Clock, AlertTriangle, XCircle } from "lucide-react";
import { STAGE_CODES } from "@shared/schema";
import type { ClientCommitment } from "@shared/schema";

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700" },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500" },
};

interface ClientCommitmentTrackerProps {
  projectId: number;
  stageCode: string;
}

export function ClientCommitmentTracker({ projectId, stageCode }: ClientCommitmentTrackerProps) {
  const { data } = useClientCommitments(projectId);
  const createMutation = useCreateClientCommitment(projectId);
  const updateMutation = useUpdateClientCommitment(projectId);

  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [deliveryStage, setDeliveryStage] = useState("");
  const [notes, setNotes] = useState("");

  const commitments = data?.commitments || [];
  const openCount = commitments.filter((c: ClientCommitment) => c.status === "open").length;

  const handleCreate = async () => {
    if (!text.trim()) return;
    await createMutation.mutateAsync({
      stageCodeCreated: stageCode,
      commitmentText: text,
      deliveryStageCode: deliveryStage || undefined,
      notes: notes || undefined,
    });
    setText("");
    setDeliveryStage("");
    setNotes("");
    setShowForm(false);
  };

  const formatStage = (code: string) =>
    code.replace(/_/g, " ").replace(/^S\d+\s/, "");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Client Commitments
            {openCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{openCount} open</Badge>
            )}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-3 w-3" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showForm && (
          <div className="space-y-2 rounded border p-2">
            <Textarea
              placeholder="What was promised to the client..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="text-sm min-h-[40px]"
              rows={2}
            />
            <div className="flex gap-2">
              <select
                value={deliveryStage}
                onChange={(e) => setDeliveryStage(e.target.value)}
                className="h-8 rounded border px-2 text-xs flex-1"
              >
                <option value="">Delivery stage (optional)</option>
                {STAGE_CODES.map((sc) => (
                  <option key={sc} value={sc}>{formatStage(sc)}</option>
                ))}
              </select>
              <Input
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-8 text-xs flex-1"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={!text.trim() || createMutation.isPending}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {commitments.length === 0 && !showForm && (
          <p className="text-xs text-muted-foreground">No commitments recorded.</p>
        )}

        {commitments.map((c: ClientCommitment) => {
          const badge = STATUS_BADGES[c.status] || STATUS_BADGES.open;
          return (
            <div key={c.id} className="flex items-start justify-between rounded border px-2 py-1.5 text-xs">
              <div className="flex-1 space-y-0.5">
                <p className="font-medium">{c.commitmentText}</p>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {c.stageCodeCreated && <span>From: {formatStage(c.stageCodeCreated)}</span>}
                  {c.deliveryStageCode && <span>Due: {formatStage(c.deliveryStageCode)}</span>}
                  {c.committedDate && <span>{new Date(c.committedDate).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge className={badge.color}>{badge.label}</Badge>
                {c.status === "open" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-xs"
                    onClick={() => updateMutation.mutate({ id: c.id, status: "delivered" })}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

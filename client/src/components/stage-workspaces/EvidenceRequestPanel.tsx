import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useEvidenceRequests,
  useCreateEvidenceRequest,
  useFulfillEvidenceRequest,
} from "@/hooks/use-collaboration-workflow";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema";
import { Plus, Upload, FileSearch } from "lucide-react";
import type { EvidenceRequest } from "@shared/schema";

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  requested: { label: "Requested", color: "bg-blue-100 text-blue-700" },
  uploaded: { label: "Uploaded", color: "bg-green-100 text-green-700" },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-700" },
  waived: { label: "Waived", color: "bg-gray-100 text-gray-500" },
};

interface EvidenceRequestPanelProps {
  projectId: number;
  stageCode: string;
}

export function EvidenceRequestPanel({ projectId, stageCode }: EvidenceRequestPanelProps) {
  const { data } = useEvidenceRequests(projectId, stageCode);
  const createMutation = useCreateEvidenceRequest(projectId);
  const fulfillMutation = useFulfillEvidenceRequest(projectId);

  const [showForm, setShowForm] = useState(false);
  const [department, setDepartment] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [fulfillId, setFulfillId] = useState<number | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const requests = data?.requests || [];
  const pendingCount = requests.filter((r: EvidenceRequest) => r.status === "requested").length;

  const handleCreate = async () => {
    if (!department || !description.trim()) return;
    await createMutation.mutateAsync({
      stageCode,
      requestedFromDepartment: department,
      description,
      dueDate: dueDate || undefined,
    });
    setShowForm(false);
    setDepartment("");
    setDescription("");
    setDueDate("");
  };

  const handleFulfill = async () => {
    if (!fulfillId || !evidenceUrl.trim()) return;
    await fulfillMutation.mutateAsync({ id: fulfillId, evidenceUrl });
    setFulfillId(null);
    setEvidenceUrl("");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            <FileSearch className="inline mr-1 h-3.5 w-3.5" />
            Evidence Requests
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{pendingCount} pending</Badge>
            )}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-3 w-3" /> Request
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showForm && (
          <div className="space-y-2 rounded border p-2">
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="h-8 w-full rounded border px-2 text-xs"
            >
              <option value="">Select department...</option>
              {LIFECYCLE_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <Textarea
              placeholder="What evidence is needed..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm min-h-[40px]"
              rows={2}
            />
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-8 text-xs"
              placeholder="Due date"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={!department || !description.trim() || createMutation.isPending}>
                Submit Request
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {requests.length === 0 && !showForm && (
          <p className="text-xs text-muted-foreground">No evidence requests.</p>
        )}

        {requests.map((r: EvidenceRequest) => {
          const badge = STATUS_BADGES[r.status] || STATUS_BADGES.requested;
          const ageDays = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000);

          return (
            <div key={r.id} className="rounded border px-2 py-1.5 text-xs space-y-1">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium">{r.description}</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>From: {r.requestedFromDepartment}</span>
                    {r.dueDate && <span>Due: {r.dueDate}</span>}
                    <span>{ageDays}d old</span>
                  </div>
                </div>
                <Badge className={badge.color}>{badge.label}</Badge>
              </div>

              {r.status === "requested" && fulfillId === r.id && (
                <div className="flex gap-1">
                  <Input
                    placeholder="Evidence URL..."
                    value={evidenceUrl}
                    onChange={(e) => setEvidenceUrl(e.target.value)}
                    className="h-7 text-xs flex-1"
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={handleFulfill} disabled={!evidenceUrl.trim()}>
                    <Upload className="mr-1 h-3 w-3" /> Upload
                  </Button>
                </div>
              )}

              {r.status === "requested" && fulfillId !== r.id && (
                <Button size="sm" variant="ghost" className="h-5 px-1 text-xs" onClick={() => setFulfillId(r.id)}>
                  Fulfill
                </Button>
              )}

              {r.evidenceUrl && (
                <a href={r.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-xs">
                  View evidence
                </a>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

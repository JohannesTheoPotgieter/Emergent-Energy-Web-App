import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useClientUpdates,
  useCreateClientUpdate,
  useUpdateClientUpdate,
  useGenerateClientUpdateDraft,
} from "@/hooks/use-collaboration-workflow";
import { Mail, Wand2, Send, Loader2, AlertCircle } from "lucide-react";
import type { ClientUpdate } from "@shared/schema";

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700" },
  pending_review: { label: "Pending Review", color: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-700" },
  sent: { label: "Sent", color: "bg-green-100 text-green-700" },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-700" },
};

interface ClientUpdateEditorProps {
  projectId: number;
}

export function ClientUpdateEditor({ projectId }: ClientUpdateEditorProps) {
  const { data } = useClientUpdates(projectId);
  const createMutation = useCreateClientUpdate(projectId);
  const updateMutation = useUpdateClientUpdate(projectId);
  const generateDraftMutation = useGenerateClientUpdateDraft(projectId);

  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    progressSummaryText: "",
    completedThisPeriodText: "",
    next7DaysText: "",
    blockersText: "",
    clientActionsRequiredText: "",
  });

  const updates = data?.updates || [];
  const latestUpdate = updates[0];
  const lastSentDate = updates.find((u: ClientUpdate) => u.clientUpdateStatus === "sent")?.sentDate;
  const daysSinceUpdate = lastSentDate
    ? Math.floor((Date.now() - new Date(lastSentDate).getTime()) / 86400000)
    : null;
  const isOverdue = daysSinceUpdate === null || daysSinceUpdate > 7;

  const handleGenerateDraft = async () => {
    const result = await generateDraftMutation.mutateAsync();
    if (result.draft) {
      setDraft(result.draft);
    }
  };

  const handleCreateUpdate = async () => {
    await createMutation.mutateAsync(draft);
    setDraft({ progressSummaryText: "", completedThisPeriodText: "", next7DaysText: "", blockersText: "", clientActionsRequiredText: "" });
  };

  const handleStatusChange = async (id: number, newStatus: string) => {
    await updateMutation.mutateAsync({ id, clientUpdateStatus: newStatus });
  };

  const startEditing = (update: ClientUpdate) => {
    setEditing(update.id);
    setDraft({
      progressSummaryText: update.progressSummaryText || "",
      completedThisPeriodText: update.completedThisPeriodText || "",
      next7DaysText: update.next7DaysText || "",
      blockersText: update.blockersText || "",
      clientActionsRequiredText: update.clientActionsRequiredText || "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updateMutation.mutateAsync({ id: editing, ...draft });
    setEditing(null);
    setDraft({ progressSummaryText: "", completedThisPeriodText: "", next7DaysText: "", blockersText: "", clientActionsRequiredText: "" });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            <Mail className="inline mr-1 h-3.5 w-3.5" />
            Weekly Client Update
            {isOverdue && (
              <Badge className="ml-2 bg-red-100 text-red-700 text-xs">
                <AlertCircle className="mr-1 h-3 w-3" />
                {daysSinceUpdate !== null ? `${daysSinceUpdate}d since last update` : "No updates sent"}
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={handleGenerateDraft} disabled={generateDraftMutation.isPending}>
              <Wand2 className="mr-1 h-3 w-3" />
              {generateDraftMutation.isPending ? "Generating..." : "Auto-Draft"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Draft editor */}
        {(draft.progressSummaryText || editing) && (
          <div className="space-y-2 rounded border p-2">
            <p className="text-xs font-medium">
              {editing ? `Editing Update #${updates.find((u: ClientUpdate) => u.id === editing)?.updateNumber}` : "New Draft"}
            </p>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Progress Summary</label>
              <Textarea
                value={draft.progressSummaryText}
                onChange={(e) => setDraft({ ...draft, progressSummaryText: e.target.value })}
                className="text-xs min-h-[30px]"
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Completed This Period</label>
              <Textarea
                value={draft.completedThisPeriodText}
                onChange={(e) => setDraft({ ...draft, completedThisPeriodText: e.target.value })}
                className="text-xs min-h-[30px]"
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Next 7 Days</label>
              <Textarea
                value={draft.next7DaysText}
                onChange={(e) => setDraft({ ...draft, next7DaysText: e.target.value })}
                className="text-xs min-h-[30px]"
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Blockers</label>
              <Textarea
                value={draft.blockersText}
                onChange={(e) => setDraft({ ...draft, blockersText: e.target.value })}
                className="text-xs min-h-[30px]"
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Client Actions Required</label>
              <Textarea
                value={draft.clientActionsRequiredText}
                onChange={(e) => setDraft({ ...draft, clientActionsRequiredText: e.target.value })}
                className="text-xs min-h-[30px]"
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setDraft({ progressSummaryText: "", completedThisPeriodText: "", next7DaysText: "", blockersText: "", clientActionsRequiredText: "" }); }}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={handleCreateUpdate} disabled={createMutation.isPending}>
                    Create Draft
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft({ progressSummaryText: "", completedThisPeriodText: "", next7DaysText: "", blockersText: "", clientActionsRequiredText: "" })}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Recent updates list */}
        {updates.slice(0, 5).map((u: ClientUpdate) => {
          const badge = STATUS_BADGES[u.clientUpdateStatus] || STATUS_BADGES.draft;
          return (
            <div key={u.id} className="rounded border px-2 py-1.5 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">Update #{u.updateNumber}</span>
                <div className="flex items-center gap-1">
                  <Badge className={badge.color}>{badge.label}</Badge>
                  {u.sentDate && <span className="text-muted-foreground">{new Date(u.sentDate).toLocaleDateString()}</span>}
                </div>
              </div>
              {u.progressSummaryText && (
                <p className="text-muted-foreground line-clamp-2">{u.progressSummaryText}</p>
              )}
              <div className="flex gap-1">
                {u.clientUpdateStatus === "draft" && (
                  <>
                    <Button size="sm" variant="ghost" className="h-5 px-1 text-xs" onClick={() => startEditing(u)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1 text-xs" onClick={() => handleStatusChange(u.id, "pending_review")}>
                      Submit for Review
                    </Button>
                  </>
                )}
                {u.clientUpdateStatus === "pending_review" && (
                  <Button size="sm" variant="ghost" className="h-5 px-1 text-xs" onClick={() => handleStatusChange(u.id, "approved")}>
                    Approve
                  </Button>
                )}
                {u.clientUpdateStatus === "approved" && (
                  <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-green-700" onClick={() => handleStatusChange(u.id, "sent")}>
                    <Send className="mr-1 h-3 w-3" /> Mark Sent
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {updates.length === 0 && !draft.progressSummaryText && (
          <p className="text-xs text-muted-foreground">No client updates yet. Use Auto-Draft to generate one.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Send-Deliverable dialog — extracted from EngineeringTaskDrawer.
 *
 * Before extraction: 9 state vars + 2 effects (recipient suggestion, project
 * suggestion, file, recipient, note, override reasons, sending flag, …) lived
 * on the parent drawer, so every keystroke anywhere in the drawer paid the
 * cost of these state slots and re-ran the conditional bootstrapping effect.
 *
 * After: state lives here and only exists while the dialog is mounted. The
 * parent renders `<SendDeliverableDialog open={…} onClose={…} … />` from
 * `{open && (…)}` so closing the dialog tears the state down entirely.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Send, Loader2, CheckCircle2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Task, TeamMember } from "@/components/tasks/types";

export interface LocalSyncedConfigSummary {
  mappedPath: string | null;
}

export interface LocalSyncedSaveResult {
  supported: boolean;
  status: "succeeded" | "failed";
  targetPath?: string;
  error?: string;
}

export interface SendDeliverableDialogProps {
  task: Task;
  currentUserId?: number;
  teamMembers: TeamMember[];
  localSyncedSaveEnabled: boolean;
  localSyncedConfig?: LocalSyncedConfigSummary;
  runLocalSyncedSaveAttempt: (file: File | null, suggestedName: string) => Promise<LocalSyncedSaveResult | null>;
  open: boolean;
  onClose: () => void;
}

export function SendDeliverableDialog({
  task,
  currentUserId,
  teamMembers,
  localSyncedSaveEnabled,
  localSyncedConfig,
  runLocalSyncedSaveAttempt,
  open,
  onClose,
}: SendDeliverableDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [recipient, setRecipient] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [recipientSuggestion, setRecipientSuggestion] = useState<string>("");
  const [recipientOverrideReason, setRecipientOverrideReason] = useState<string>("");
  const [linkedProjectSuggestion, setLinkedProjectSuggestion] = useState<string>("");
  const [linkedProjectFinal, setLinkedProjectFinal] = useState<string>("");
  const [linkedProjectOverrideReason, setLinkedProjectOverrideReason] = useState<string>("");

  // Bootstrap suggestions from the task on open. Previously this lived as a
  // gated effect on the parent (`if (!showSendDeliverable) return`); here the
  // effect only runs when the component is actually mounted.
  useEffect(() => {
    const suggested = task.ownerUserId ? String(task.ownerUserId) : "";
    setRecipientSuggestion(suggested);
    if (!recipient && suggested) setRecipient(suggested);
    const projectSuggestion = task.projectName || "";
    setLinkedProjectSuggestion(projectSuggestion);
    if (!linkedProjectFinal) setLinkedProjectFinal(projectSuggestion);
    // task.id deliberately the only dep — re-bootstrap when the parent reopens
    // the dialog for a different task; user edits to recipient/linkedProject
    // must not be clobbered by a re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  function handleClose() {
    setFile(null); setRecipient(""); setNote("");
    onClose();
  }

  const overrideMissingRecipient = !!(recipientSuggestion && recipient && recipientSuggestion !== recipient && !recipientOverrideReason.trim());
  const overrideMissingLinked = !!(linkedProjectSuggestion && linkedProjectFinal && linkedProjectSuggestion !== linkedProjectFinal && !linkedProjectOverrideReason.trim());

  async function send() {
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("recipientUserId", recipient);
      formData.append("note", note);
      if (file) formData.append("file", file);
      formData.append("recipientSuggestion", recipientSuggestion || "");
      formData.append("recipientFinal", recipient || "");
      formData.append("recipientOverrideReason", recipientOverrideReason || "");
      formData.append("linkedProjectSuggestion", linkedProjectSuggestion || "");
      formData.append("linkedProjectFinal", linkedProjectFinal || "");
      formData.append("linkedProjectOverrideReason", linkedProjectOverrideReason || "");

      const localSave = await runLocalSyncedSaveAttempt(file, file?.name || `task_${task.id}_deliverable.bin`);
      if (localSave) formData.append("localSave", JSON.stringify(localSave));

      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/eng/tasks/${task.id}/send-deliverable`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      const payload = await res.json();
      const canonicalSaved = payload?.sendResult?.canonicalSystemRecord?.saved ? "Yes" : "No";
      const localSaved = payload?.sendResult?.localSyncedPath?.saved ? "Yes" : "No";
      toast({ title: "Deliverable sent", description: `Saved to system: ${canonicalSaved} • Saved to local synced path: ${localSaved}` });
      handleClose();
      queryClient.invalidateQueries({ queryKey: ["task-deliverables", task.id] });
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
      queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-blue-600" /> Send Document
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Recipient <span className="text-red-500">*</span></Label>
            <SearchableSelect
              value={recipient}
              onValueChange={setRecipient}
              placeholder="Select recipient..."
              triggerClassName="h-9 text-sm"
              options={teamMembers.filter(m => m.id !== currentUserId).map(m => ({
                value: String(m.id),
                label: m.fullName,
              }))}
              data-testid="select-deliverable-recipient"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">File <span className="text-red-500">*</span></Label>
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 ${file ? "border-blue-400 bg-blue-50/20" : "border-muted"}`}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.onchange = (e) => {
                  const picked = (e.target as HTMLInputElement).files?.[0];
                  if (picked) setFile(picked);
                };
                input.click();
              }}
              data-testid="dropzone-deliverable-file"
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  <span className="truncate max-w-[200px]">{file.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-muted-foreground hover:text-red-500">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Click to attach a deliverable file</div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Recipient suggestion</Label>
            <div className="text-[11px] text-muted-foreground">Suggested: {recipientSuggestion || "None"}</div>
            {recipientSuggestion && recipient && recipientSuggestion !== recipient && (
              <Input value={recipientOverrideReason} onChange={(e) => setRecipientOverrideReason(e.target.value)} placeholder="Reason for overriding suggested recipient (required)" className="h-8 text-xs border-amber-300" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Linked project</Label>
            <Input value={linkedProjectFinal} onChange={(e) => setLinkedProjectFinal(e.target.value)} className="h-8 text-xs" />
            {linkedProjectSuggestion && linkedProjectSuggestion !== linkedProjectFinal && (
              <Input value={linkedProjectOverrideReason} onChange={(e) => setLinkedProjectOverrideReason(e.target.value)} placeholder="Reason for overriding suggested linked project (required)" className="h-8 text-xs border-amber-300" />
            )}
          </div>
          {localSyncedSaveEnabled && (
            <div className="rounded-md border p-2 text-[11px] text-muted-foreground space-y-1">
              <div>Local synced save mapping: <span className="font-medium">{localSyncedConfig?.mappedPath || "Not configured"}</span></div>
              {!localSyncedConfig?.mappedPath && <div className="text-amber-700">Fallback will be used; local synced save cannot be confirmed.</div>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for the recipient..."
              className="min-h-[60px] text-sm"
              data-testid="textarea-deliverable-note"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1 h-9 text-sm bg-blue-600 hover:bg-blue-700 gap-1.5"
              disabled={!recipient || !file || sending || overrideMissingRecipient || overrideMissingLinked}
              onClick={send}
              data-testid="btn-confirm-send-deliverable"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? "Sending..." : "Send Document"}
            </Button>
            <Button variant="outline" className="h-9 text-sm" onClick={handleClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

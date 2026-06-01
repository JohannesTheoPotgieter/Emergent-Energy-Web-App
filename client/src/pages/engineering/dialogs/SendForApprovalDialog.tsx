/**
 * Send-for-Approval dialog — extracted from EngineeringTaskDrawer.
 *
 * Same shape as SendDeliverableDialog: 9 state slots + 1 bootstrap effect
 * lived on the parent; here they only exist while the dialog is mounted.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, CheckCircle2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@/components/tasks/types";
import type { LocalSyncedSaveResult, LocalSyncedConfigSummary } from "./SendDeliverableDialog";

export interface SendForApprovalDialogProps {
  task: Task;
  localSyncedSaveEnabled: boolean;
  localSyncedConfig?: LocalSyncedConfigSummary;
  runLocalSyncedSaveAttempt: (file: File | null, suggestedName: string) => Promise<LocalSyncedSaveResult | null>;
  onUpdate: () => void;
  open: boolean;
  onClose: () => void;
}

export function SendForApprovalDialog({
  task,
  localSyncedSaveEnabled,
  localSyncedConfig,
  runLocalSyncedSaveAttempt,
  onUpdate,
  open,
  onClose,
}: SendForApprovalDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState<boolean>(false);
  const [projectSuggestion, setProjectSuggestion] = useState<string>("");
  const [projectFinal, setProjectFinal] = useState<string>("");
  const [projectOverrideReason, setProjectOverrideReason] = useState<string>("");
  const [routeSuggestion, setRouteSuggestion] = useState<string>("");
  const [routeFinal, setRouteFinal] = useState<string>("");
  const [routeOverrideReason, setRouteOverrideReason] = useState<string>("");

  useEffect(() => {
    const ps = task.projectName || "";
    setProjectSuggestion(ps);
    if (!projectFinal) setProjectFinal(ps);
    const rs = task.ownerUserId ? String(task.ownerUserId) : "owner";
    setRouteSuggestion(rs);
    if (!routeFinal) setRouteFinal(rs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  function handleClose() {
    setNote(""); setFile(null);
    onClose();
  }

  const overrideMissingProject = !!(projectSuggestion && projectFinal && projectSuggestion !== projectFinal && !projectOverrideReason.trim());
  const overrideMissingRoute = !!(routeSuggestion && routeFinal && routeSuggestion !== routeFinal && !routeOverrideReason.trim());

  async function send() {
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("note", note);
      if (file) formData.append("file", file);
      formData.append("projectSuggestion", projectSuggestion || "");
      formData.append("projectFinal", projectFinal || "");
      formData.append("projectOverrideReason", projectOverrideReason || "");
      formData.append("routeSuggestion", routeSuggestion || "");
      formData.append("routeFinal", routeFinal || "");
      formData.append("routeOverrideReason", routeOverrideReason || "");

      const localSave = await runLocalSyncedSaveAttempt(file, file?.name || `task_${task.id}_approval.txt`);
      if (localSave) formData.append("localSave", JSON.stringify(localSave));

      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/eng/tasks/${task.id}/send-for-approval`, {
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
      toast({ title: "Sent for approval", description: `Saved to system: ${canonicalSaved} • Saved to local synced path: ${localSaved}` });
      handleClose();
      onUpdate();
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
            <Send className="h-4 w-4 text-amber-600" /> Submit for QC Review
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Attachment (optional)</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 ${file ? "border-amber-400 bg-amber-50/20" : "border-muted"}`}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.onchange = (e) => {
                  const picked = (e.target as HTMLInputElement).files?.[0];
                  if (picked) setFile(picked);
                };
                input.click();
              }}
              data-testid="dropzone-approval-file"
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-amber-600" />
                  <span className="truncate max-w-[200px]">{file.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-muted-foreground hover:text-red-500">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Click to upload a deliverable file
                </div>
              )}
            </div>
          </div>
          {localSyncedSaveEnabled && (
            <div className="rounded-md border p-2 text-[11px] text-muted-foreground space-y-1">
              <div>Local synced save mapping: <span className="font-medium">{localSyncedConfig?.mappedPath || "Not configured"}</span></div>
              {!localSyncedConfig?.mappedPath && <div className="text-amber-700">Fallback will be used; local synced save cannot be confirmed.</div>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Suggested project</Label>
            <Input value={projectFinal} onChange={(e) => setProjectFinal(e.target.value)} className="h-8 text-xs" />
            {projectSuggestion && projectSuggestion !== projectFinal && (
              <Input value={projectOverrideReason} onChange={(e) => setProjectOverrideReason(e.target.value)} placeholder="Reason for overriding suggested project (required)" className="h-8 text-xs border-amber-300" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Suggested approval route</Label>
            <Input value={routeFinal} onChange={(e) => setRouteFinal(e.target.value)} className="h-8 text-xs" />
            {routeSuggestion && routeSuggestion !== routeFinal && (
              <Input value={routeOverrideReason} onChange={(e) => setRouteOverrideReason(e.target.value)} placeholder="Reason for overriding suggested route (required)" className="h-8 text-xs border-amber-300" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for the reviewer..."
              className="min-h-[60px] text-sm"
              data-testid="textarea-send-approval-note"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1 h-9 text-sm bg-amber-600 hover:bg-amber-700 gap-1.5"
              disabled={sending || overrideMissingProject || overrideMissingRoute}
              onClick={send}
              data-testid="btn-confirm-send-approval"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? "Submitting..." : "Submit for QC Review"}
            </Button>
            <Button variant="outline" className="h-9 text-sm" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

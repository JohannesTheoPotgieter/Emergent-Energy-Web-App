import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCheckin } from "./use-documents";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  documentId: number | null;
}

export function CheckinDialog({ open, onOpenChange, documentId }: Props) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const checkin = useCheckin();

  async function submit() {
    if (!documentId) return;
    setError(null);
    try {
      await checkin.mutateAsync({ documentId, comment: comment.trim() || undefined });
      onOpenChange(false);
      setComment("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-in failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="documents-checkin-dialog">
        <DialogHeader>
          <DialogTitle>Check in file</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="checkin-comment">Comment (optional)</Label>
          <Textarea
            id="checkin-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
            data-testid="documents-checkin-comment"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={checkin.isPending}
            data-testid="documents-checkin-submit"
          >
            {checkin.isPending ? "Checking in…" : "Check in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

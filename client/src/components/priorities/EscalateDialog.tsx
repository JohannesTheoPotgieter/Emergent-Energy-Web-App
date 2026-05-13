import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

const REASONS = [
  { value: "overdue",  label: "Overdue — deadline has passed" },
  { value: "critical", label: "Critical / Urgent — needs immediate attention" },
  { value: "blocked",  label: "Blocked — can't progress without wider help" },
  { value: "manual",   label: "Other — escalate for visibility" },
] as const;

type EscalationReason = (typeof REASONS)[number]["value"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priorityTitle: string;
  currentScope: string;
  onConfirm: (reason: EscalationReason, note?: string) => void;
  isPending?: boolean;
}

export function EscalateDialog({
  open,
  onOpenChange,
  priorityTitle,
  currentScope,
  onConfirm,
  isPending,
}: Props) {
  const [reason, setReason] = useState<EscalationReason>("manual");
  const [note, setNote] = useState("");
  const targetScope = currentScope === "role" ? "Department" : "Company";

  const handleConfirm = () => {
    onConfirm(reason, note.trim() || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowUp className="w-4 h-4 text-orange-600 shrink-0" />
            Escalate to {targetScope}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">"{priorityTitle}"</span> will move from{" "}
          {currentScope === "role" ? "your personal list" : "your department"} to{" "}
          {targetScope.toLowerCase()} scope and become visible to{" "}
          {targetScope === "Department" ? "your department head" : "company leadership"}.
        </p>

        <p className="text-xs font-medium text-foreground mt-1">Why are you escalating?</p>
        <RadioGroup
          value={reason}
          onValueChange={(v) => setReason(v as EscalationReason)}
          className="space-y-2"
        >
          {REASONS.map((r) => (
            <div key={r.value} className="flex items-start gap-2">
              <RadioGroupItem value={r.value} id={`esc-${r.value}`} className="mt-0.5" />
              <Label
                htmlFor={`esc-${r.value}`}
                className="text-sm font-normal leading-snug cursor-pointer"
              >
                {r.label}
              </Label>
            </div>
          ))}
        </RadioGroup>

        <div className="mt-1">
          <Label className="text-xs text-muted-foreground">Additional note (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any context for the reviewer…"
            rows={2}
            maxLength={1000}
            className="mt-1 text-sm resize-none"
          />
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-orange-600 hover:bg-orange-700 text-white"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Escalating…" : `Escalate to ${targetScope}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateException } from "@/hooks/use-stage-lifecycle";
import { RISK_LEVELS, STAGE_CODES } from "@shared/schema/stage-lifecycle";
import { Loader2 } from "lucide-react";

interface ExceptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  stageCode: string;
  requirementCode?: string;
}

export function ExceptionDialog({ open, onOpenChange, projectId, stageCode, requirementCode }: ExceptionDialogProps) {
  const createMutation = useCreateException(projectId);
  const [reasonText, setReasonText] = useState("");
  const [riskLevel, setRiskLevel] = useState("MEDIUM");
  const [mitigationText, setMitigationText] = useState("");
  const [closeoutDueDate, setCloseoutDueDate] = useState("");
  const [downstreamStage, setDownstreamStage] = useState("");

  const handleSubmit = () => {
    createMutation.mutate(
      {
        stageCode,
        requirementCode,
        reasonText,
        riskLevel,
        mitigationText: mitigationText || undefined,
        closeoutDueDate: closeoutDueDate || undefined,
        downstreamBlockingStage: downstreamStage || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReasonText("");
          setMitigationText("");
          setCloseoutDueDate("");
          setDownstreamStage("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request Exception</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {requirementCode && (
            <div>
              <Label className="text-xs text-muted-foreground">Requirement</Label>
              <p className="text-sm font-medium">{requirementCode}</p>
            </div>
          )}

          <div>
            <Label htmlFor="reason">Reason for exception *</Label>
            <Textarea
              id="reason"
              value={reasonText}
              onChange={e => setReasonText(e.target.value)}
              placeholder="Why is this requirement being bypassed?"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="risk">Risk Level *</Label>
            <Select value={riskLevel} onValueChange={setRiskLevel}>
              <SelectTrigger id="risk">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RISK_LEVELS.map(level => (
                  <SelectItem key={level} value={level}>{level}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="mitigation">Mitigation</Label>
            <Textarea
              id="mitigation"
              value={mitigationText}
              onChange={e => setMitigationText(e.target.value)}
              placeholder="How will the risk be mitigated?"
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="closeout">Closeout Due Date</Label>
            <Input
              id="closeout"
              type="date"
              value={closeoutDueDate}
              onChange={e => setCloseoutDueDate(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="downstream">Downstream Blocking Stage</Label>
            <Select value={downstreamStage} onValueChange={setDownstreamStage}>
              <SelectTrigger id="downstream">
                <SelectValue placeholder="Select stage (optional)" />
              </SelectTrigger>
              <SelectContent>
                {STAGE_CODES.map(code => (
                  <SelectItem key={code} value={code}>{code.replace(/^S\d+_/, '').replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!reasonText || createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Submit Exception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

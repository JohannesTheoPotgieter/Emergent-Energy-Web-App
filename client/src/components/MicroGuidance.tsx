import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, Info, ShieldAlert, ChevronDown, ChevronUp, X,
} from "lucide-react";

interface GuidancePromptProps {
  type: "warning" | "info" | "critical";
  title: string;
  message: string;
  learnMoreText?: string;
  requiresReason?: boolean;
  onProceed?: (reason?: string) => void;
  onCancel?: () => void;
  visible?: boolean;
}

export function GuidancePrompt({
  type,
  title,
  message,
  learnMoreText,
  requiresReason = false,
  onProceed,
  onCancel,
  visible = true,
}: GuidancePromptProps) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [dismissed, setDismissed] = useState(false);

  if (!visible || dismissed) return null;

  const colors = {
    warning: { bg: "bg-amber-50 border-amber-200", icon: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
    info: { bg: "bg-blue-50 border-blue-200", icon: "text-blue-600", badge: "bg-blue-100 text-blue-700" },
    critical: { bg: "bg-red-50 border-red-200", icon: "text-red-600", badge: "bg-red-100 text-red-700" },
  };

  const IconComponent = type === "critical" ? ShieldAlert : type === "warning" ? AlertTriangle : Info;
  const c = colors[type];

  return (
    <Card className={`p-3 ${c.bg} border`} data-testid={`guidance-${type}`}>
      <div className="flex items-start gap-2">
        <IconComponent className={`h-4 w-4 mt-0.5 shrink-0 ${c.icon}`} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">{title}</span>
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${c.badge}`}>
                {type === "critical" ? "High Risk" : type === "warning" ? "Caution" : "Tip"}
              </Badge>
            </div>
            {!requiresReason && (
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setDismissed(true)}>
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{message}</p>

          {learnMoreText && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-primary flex items-center gap-0.5 hover:underline"
              data-testid="button-learn-more"
            >
              {expanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
              {expanded ? "Less" : "Learn more"}
            </button>
          )}

          {expanded && learnMoreText && (
            <p className="text-[10px] text-muted-foreground bg-card/50 rounded p-2">{learnMoreText}</p>
          )}

          {requiresReason && (
            <div className="space-y-1.5">
              <Textarea
                className="text-xs min-h-[50px] bg-card"
                placeholder="Please provide a reason for this action..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="textarea-guidance-reason"
              />
              <div className="flex items-center gap-2">
                {onCancel && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel} data-testid="button-guidance-cancel">
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!reason.trim()}
                  onClick={() => onProceed?.(reason)}
                  data-testid="button-guidance-proceed"
                >
                  Proceed with Reason
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

interface InlineTipProps {
  text: string;
  type?: "info" | "warning";
}

export function InlineTip({ text, type = "info" }: InlineTipProps) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] ${
        type === "warning" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
      }`}
      data-testid="inline-tip"
    >
      {type === "warning" ? <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> : <Info className="h-2.5 w-2.5 shrink-0" />}
      <span className="flex-1">{text}</span>
      <button onClick={() => setVisible(false)} className="shrink-0 hover:opacity-70">
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

export function getPhaseGuidance(phase: string | null): { type: "warning" | "info" | "critical"; title: string; message: string; learnMoreText?: string } | null {
  if (!phase) return null;

  const phaseLC = phase.toLowerCase();

  if (phaseLC.includes("construction") || phaseLC.includes("installation")) {
    return {
      type: "info",
      title: "Construction Phase Active",
      message: "Ensure weekly reviews are up to date and all quality gates are documented before advancing.",
      learnMoreText: "During construction, focus on: site safety compliance, material tracking, subcontractor performance, and schedule adherence. Missing documentation here can delay commissioning.",
    };
  }

  if (phaseLC.includes("commissioning") || phaseLC.includes("testing")) {
    return {
      type: "warning",
      title: "Commissioning Phase",
      message: "All snag lists must be resolved and test certificates uploaded before handover.",
      learnMoreText: "Commissioning requires: performance ratio tests, inverter certificates, grid compliance docs, and client sign-off. Incomplete commissioning delays payment milestones.",
    };
  }

  if (phaseLC.includes("handover")) {
    return {
      type: "info",
      title: "Handover Phase",
      message: "Verify all O&M documentation is complete and client acceptance has been signed.",
    };
  }

  if (phaseLC.includes("qa") || phaseLC.includes("quality")) {
    return {
      type: "warning",
      title: "QA Gate Active",
      message: "Quality checklists must be completed before the project can advance past this gate.",
      learnMoreText: "QA gates require: inspection sign-off, non-conformance resolution, and document completeness verification. Skipping these creates compliance risk.",
    };
  }

  return null;
}

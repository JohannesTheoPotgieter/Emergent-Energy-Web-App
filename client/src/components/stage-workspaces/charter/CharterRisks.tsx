import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectCharter } from "@shared/schema";

interface CharterRisksProps {
  charter: Partial<ProjectCharter>;
  onChange: <K extends keyof ProjectCharter>(field: K, value: ProjectCharter[K]) => void;
}

export function CharterRisks({ charter, onChange }: CharterRisksProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Section 6 — Risks / Opportunities / Triage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Overview Risk Summary</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterOverviewRiskSummary || ""} onChange={e => onChange("charterOverviewRiskSummary", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Stakeholder Risks</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterStakeholderRiskSummary || ""} onChange={e => onChange("charterStakeholderRiskSummary", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Scope Risks</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterScopeRiskSummary || ""} onChange={e => onChange("charterScopeRiskSummary", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Schedule Risks</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterScheduleRiskSummary || ""} onChange={e => onChange("charterScheduleRiskSummary", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Budget Risks</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterBudgetRiskSummary || ""} onChange={e => onChange("charterBudgetRiskSummary", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Triage Level</Label>
            <Select value={charter.charterTriageLevel || ""} onValueChange={val => onChange("charterTriageLevel", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="green">Green</SelectItem>
                <SelectItem value="amber">Amber</SelectItem>
                <SelectItem value="purple">Purple</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Opportunities</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterOpportunitiesText || ""} onChange={e => onChange("charterOpportunitiesText", e.target.value)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

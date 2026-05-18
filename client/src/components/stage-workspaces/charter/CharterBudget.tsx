import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectCharter } from "@shared/schema";

interface CharterBudgetProps {
  charter: Partial<ProjectCharter>;
  onChange: <K extends keyof ProjectCharter>(field: K, value: ProjectCharter[K]) => void;
}

export function CharterBudget({ charter, onChange }: CharterBudgetProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Section 5 — Budget</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Funding Model</Label>
            <Select value={charter.charterFundingModel || ""} onValueChange={val => onChange("charterFundingModel", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="self_funded">Self-funded</SelectItem>
                <SelectItem value="third_party">Third-party</SelectItem>
                <SelectItem value="blended">Blended</SelectItem>
                <SelectItem value="fedgroup">FedGroup</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Funding Partner</Label>
            <Input className="mt-1 h-8 text-sm" value={charter.charterFundingPartner || ""} onChange={e => onChange("charterFundingPartner", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Deposit Status</Label>
            <Select value={charter.charterDepositStatus || ""} onValueChange={val => onChange("charterDepositStatus", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="not_required">Not Required</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">BDP Commission</Label>
            <Input className="mt-1 h-8 text-sm" value={charter.charterBdpCommission || ""} onChange={e => onChange("charterBdpCommission", e.target.value)} placeholder='Amount or "none"' />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Payment Terms</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterPaymentTermsText || ""} onChange={e => onChange("charterPaymentTermsText", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Invoice Conditions</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterInvoiceConditionsText || ""} onChange={e => onChange("charterInvoiceConditionsText", e.target.value)} placeholder='e.g. "client must approve before payment"' />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Budget Notes</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterBudgetNotes || ""} onChange={e => onChange("charterBudgetNotes", e.target.value)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

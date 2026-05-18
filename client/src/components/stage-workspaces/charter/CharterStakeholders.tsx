import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectCharter } from "@shared/schema";

interface CharterStakeholdersProps {
  charter: Partial<ProjectCharter>;
  onChange: <K extends keyof ProjectCharter>(field: K, value: ProjectCharter[K]) => void;
}

export function CharterStakeholders({ charter, onChange }: CharterStakeholdersProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Section 2 — Stakeholders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* External */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">External (Client)</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Client Name</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterClientName || ""} onChange={e => onChange("charterClientName", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Client Type</Label>
              <Select value={charter.charterClientType || ""} onValueChange={val => onChange("charterClientType", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="existing">Existing</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Primary Contact Name</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterPrimaryContactName || ""} onChange={e => onChange("charterPrimaryContactName", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Primary Contact Email</Label>
              <Input className="mt-1 h-8 text-sm" type="email" value={charter.charterPrimaryContactEmail || ""} onChange={e => onChange("charterPrimaryContactEmail", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Primary Contact Phone</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterPrimaryContactPhone || ""} onChange={e => onChange("charterPrimaryContactPhone", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Client Relationship Notes</Label>
              <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterClientRelationshipNotes || ""} onChange={e => onChange("charterClientRelationshipNotes", e.target.value)} placeholder="Context about the relationship, opportunity significance..." />
            </div>
          </div>
        </div>

        {/* Internal */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Internal (Emergent Team)</h4>
          <p className="text-xs text-muted-foreground mb-2">Enter user IDs for team members. These will be prefilled from project data when available.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">PD (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterPdUserId ?? ""} onChange={e => onChange("charterPdUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Programme Manager (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterProgrammeManagerUserId ?? ""} onChange={e => onChange("charterProgrammeManagerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Project Manager (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterProjectManagerUserId ?? ""} onChange={e => onChange("charterProjectManagerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Procurement Manager (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterProcurementManagerUserId ?? ""} onChange={e => onChange("charterProcurementManagerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">O&M Manager (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterOmManagerUserId ?? ""} onChange={e => onChange("charterOmManagerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Asset Manager (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterAssetManagerUserId ?? ""} onChange={e => onChange("charterAssetManagerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Compliance Officer (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterComplianceOfficerUserId ?? ""} onChange={e => onChange("charterComplianceOfficerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Safety Officer (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterSafetyOfficerUserId ?? ""} onChange={e => onChange("charterSafetyOfficerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Designer (User ID)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterDesignerUserId ?? ""} onChange={e => onChange("charterDesignerUserId", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Preferred Installer</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterPreferredInstaller || ""} onChange={e => onChange("charterPreferredInstaller", e.target.value)} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectCharter } from "@shared/schema";

interface CharterOverviewProps {
  charter: Partial<ProjectCharter>;
  onChange: (field: string, value: any) => void;
}

export function CharterOverview({ charter, onChange }: CharterOverviewProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Section 1 — Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Project Name</Label>
            <Input className="mt-1 h-8 text-sm" value={charter.charterProjectName || ""} onChange={e => onChange("charterProjectName", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Site Name</Label>
            <Input className="mt-1 h-8 text-sm" value={charter.charterSiteName || ""} onChange={e => onChange("charterSiteName", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Site Address</Label>
            <Input className="mt-1 h-8 text-sm" value={charter.charterSiteAddress || ""} onChange={e => onChange("charterSiteAddress", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">GPS Coordinates</Label>
            <Input className="mt-1 h-8 text-sm" value={charter.charterGpsCoordinates || ""} onChange={e => onChange("charterGpsCoordinates", e.target.value)} placeholder="-33.9249, 18.4241" />
          </div>
          <div>
            <Label className="text-xs">Facility Type</Label>
            <Select value={charter.charterFacilityType || ""} onValueChange={val => onChange("charterFacilityType", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="commercial_rooftop">Commercial Rooftop</SelectItem>
                <SelectItem value="industrial">Industrial</SelectItem>
                <SelectItem value="ground_mount">Ground Mount</SelectItem>
                <SelectItem value="carport">Carport</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Utility Supplier</Label>
            <Select value={charter.charterUtilitySupplier || ""} onValueChange={val => onChange("charterUtilitySupplier", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eskom">Eskom</SelectItem>
                <SelectItem value="municipal">Municipal</SelectItem>
                <SelectItem value="transnet">Transnet</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Existing Infrastructure</Label>
            <Select value={charter.charterExistingInfrastructure || ""} onValueChange={val => onChange("charterExistingInfrastructure", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All New</SelectItem>
                <SelectItem value="existing_solar">Existing Solar</SelectItem>
                <SelectItem value="generator">Generator</SelectItem>
                <SelectItem value="batteries">Batteries</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Roof Type</Label>
            <Select value={charter.charterRoofType || ""} onValueChange={val => onChange("charterRoofType", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat</SelectItem>
                <SelectItem value="pitched">Pitched</SelectItem>
                <SelectItem value="ground_mount">Ground Mount</SelectItem>
                <SelectItem value="ballast">Ballast</SelectItem>
                <SelectItem value="penetrated">Penetrated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Access Method</Label>
            <Select value={charter.charterAccessMethod || ""} onValueChange={val => onChange("charterAccessMethod", val)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stairs">Stairs</SelectItem>
                <SelectItem value="ladder">Ladder</SelectItem>
                <SelectItem value="crane">Crane</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Special Site Notes</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterSpecialSiteNotes || ""} onChange={e => onChange("charterSpecialSiteNotes", e.target.value)} placeholder="Bird proofing, heritage constraints, tenant restrictions..." />
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs">Structural Assessment Done</Label>
            <Switch checked={!!charter.charterStructuralAssessmentDone} onCheckedChange={val => onChange("charterStructuralAssessmentDone", val)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Structural Assessment Notes</Label>
            <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterStructuralAssessmentNotes || ""} onChange={e => onChange("charterStructuralAssessmentNotes", e.target.value)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectCharter } from "@shared/schema";

interface CharterScopeProps {
  charter: Partial<ProjectCharter>;
  onChange: <K extends keyof ProjectCharter>(field: K, value: ProjectCharter[K]) => void;
}

export function CharterScope({ charter, onChange }: CharterScopeProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Section 3 — Scope</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* System Specification */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">System Specification</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">System Type</Label>
              <Select value={charter.charterSystemType || ""} onValueChange={val => onChange("charterSystemType", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="grid_tied">Grid-tied</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="off_grid">Off-grid</SelectItem>
                  <SelectItem value="hybrid_bess">Hybrid + BESS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">System Size (kWp)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterSystemSizeKwp ?? ""} onChange={e => onChange("charterSystemSizeKwp", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Inverter Capacity (kVA)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterInverterCapacityKva ?? ""} onChange={e => onChange("charterInverterCapacityKva", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Battery Capacity (kWh)</Label>
              <Input className="mt-1 h-8 text-sm" type="number" value={charter.charterBatteryCapacityKwh ?? ""} onChange={e => onChange("charterBatteryCapacityKwh", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label className="text-xs">Module Spec</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterModuleSpec || ""} onChange={e => onChange("charterModuleSpec", e.target.value)} placeholder="Panel wattage, make" />
            </div>
            <div>
              <Label className="text-xs">Inverter Spec</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterInverterSpec || ""} onChange={e => onChange("charterInverterSpec", e.target.value)} placeholder="Make, model" />
            </div>
            <div>
              <Label className="text-xs">Mounting Type</Label>
              <Select value={charter.charterMountingType || ""} onValueChange={val => onChange("charterMountingType", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ballast">Ballast</SelectItem>
                  <SelectItem value="penetrated">Penetrated</SelectItem>
                  <SelectItem value="ground_mount">Ground Mount</SelectItem>
                  <SelectItem value="carport">Carport</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Monitoring System</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterMonitoringSystem || ""} onChange={e => onChange("charterMonitoringSystem", e.target.value)} placeholder="To be recommended / specified" />
            </div>
            <div>
              <Label className="text-xs">Metering</Label>
              <Select value={charter.charterMetering || ""} onValueChange={val => onChange("charterMetering", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production_only">Production Only</SelectItem>
                  <SelectItem value="production_consumption">Production + Consumption</SelectItem>
                  <SelectItem value="techsitter">Techsitter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Internet Provision</Label>
              <Select value={charter.charterInternetProvision || ""} onValueChange={val => onChange("charterInternetProvision", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_provided">Client-provided</SelectItem>
                  <SelectItem value="self_provided">Self-provided</SelectItem>
                  <SelectItem value="signal_check">Signal Check Needed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Diesel Gen Integration</Label>
              <Switch checked={!!charter.charterDieselGenIntegration} onCheckedChange={val => onChange("charterDieselGenIntegration", val)} />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Dedicated Feeder</Label>
              <Switch checked={!!charter.charterDedicatedFeeder} onCheckedChange={val => onChange("charterDedicatedFeeder", val)} />
            </div>
            <div>
              <Label className="text-xs">Transformer Details</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterTransformerDetails || ""} onChange={e => onChange("charterTransformerDetails", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Tie-in Points</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterTieInPoints || ""} onChange={e => onChange("charterTieInPoints", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Main Breaker Details</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterMainBreakerDetails || ""} onChange={e => onChange("charterMainBreakerDetails", e.target.value)} />
            </div>
          </div>
        </div>

        {/* HSE */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">HSE</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <Label className="text-xs">HSE Contact Established</Label>
              <Switch checked={!!charter.charterHseContactEstablished} onCheckedChange={val => onChange("charterHseContactEstablished", val)} />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Lifelines Required</Label>
              <Switch checked={!!charter.charterLifelinesRequired} onCheckedChange={val => onChange("charterLifelinesRequired", val)} />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Additional Security Required</Label>
              <Switch checked={!!charter.charterAdditionalSecurityRequired} onCheckedChange={val => onChange("charterAdditionalSecurityRequired", val)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">HSE Notes</Label>
              <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterHseNotes || ""} onChange={e => onChange("charterHseNotes", e.target.value)} />
            </div>
          </div>
        </div>

        {/* SSEG / Compliance */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">SSEG / Compliance</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">SSEG Application Status</Label>
              <Select value={charter.charterSsegApplicationStatus || ""} onValueChange={val => onChange("charterSsegApplicationStatus", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Grid Study Status</Label>
              <Select value={charter.charterGridStudyStatus || ""} onValueChange={val => onChange("charterGridStudyStatus", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notification Number</Label>
              <Input className="mt-1 h-8 text-sm" value={charter.charterNotificationNumber || ""} onChange={e => onChange("charterNotificationNumber", e.target.value)} />
            </div>
          </div>
        </div>

        {/* O&M */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">O&M</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">O&M Contract Type</Label>
              <Select value={charter.charterOmContractType || ""} onValueChange={val => onChange("charterOmContractType", val)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_performance_guarantee">Full Performance Guarantee</SelectItem>
                  <SelectItem value="basic_maintenance">Basic Maintenance</SelectItem>
                  <SelectItem value="monitoring_only">Monitoring Only</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Waterpoints Available</Label>
              <Switch checked={!!charter.charterWaterpointsAvailable} onCheckedChange={val => onChange("charterWaterpointsAvailable", val)} />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Metering/Billing Required</Label>
              <Switch checked={!!charter.charterMeteringBillingRequired} onCheckedChange={val => onChange("charterMeteringBillingRequired", val)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">O&M Special Notes</Label>
              <Textarea className="mt-1 text-sm min-h-[40px]" rows={2} value={charter.charterOmSpecialNotes || ""} onChange={e => onChange("charterOmSpecialNotes", e.target.value)} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

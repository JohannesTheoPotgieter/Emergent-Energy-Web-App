import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectCharter } from "@shared/schema";

interface CharterScheduleProps {
  charter: Partial<ProjectCharter>;
  onChange: <K extends keyof ProjectCharter>(field: K, value: ProjectCharter[K]) => void;
}

const SCHEDULE_FIELDS: { key: keyof ProjectCharter; label: string }[] = [
  { key: "charterAlignmentMeetingDate", label: "Alignment Meeting Date" },
  { key: "charterInstallerWalkthroughDate", label: "Installer Walkthrough Date" },
  { key: "charterExternalIntroMeetingDate", label: "External Intro Meeting Date" },
  { key: "charterInternalReviewDate", label: "Internal Review Date" },
  { key: "charterClientKickoffDate", label: "Client Kickoff Date" },
  { key: "charterSiteEstablishmentDate", label: "Site Establishment Date" },
  { key: "charterExpectedCompletionDate", label: "Expected Completion Date" },
  { key: "charterHandoverDateTarget", label: "Handover Date Target (Matriarch + Client)" },
];

export function CharterSchedule({ charter, onChange }: CharterScheduleProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Section 4 — Schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          All dates can be blank at charter creation — they are filled during the handover meeting and become the baseline schedule.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SCHEDULE_FIELDS.map(field => (
            <div key={field.key}>
              <Label className="text-xs">{field.label}</Label>
              <Input
                className="mt-1 h-8 text-sm"
                type="date"
                value={(charter[field.key] as string) || ""}
                onChange={e => onChange(field.key, e.target.value || null)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

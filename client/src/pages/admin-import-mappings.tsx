/**
 * Import setup — the management screen for everything Smart Import "remembers"
 * so it can stop re-asking.
 *
 * Four tabs:
 *   - Needs attention: every project whose latest import needs a human.
 *   - Column mappings: learned template profiles + their rules (edit / clear).
 *   - Project bindings: sticky filename → project bindings (forget).
 *   - Teams alerts: where to post when a scheduled import fails / parks.
 *
 * Gated on the existing `smart_import` permission (view to read, edit to
 * mutate) — server enforces; this screen just hides mutate affordances.
 */

import { useEffect, useState } from "react";
import { PageLayout } from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Save, FileSpreadsheet, Link2, Bell, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";
import { ImportsNeedingAttention } from "@/components/import/ImportsNeedingAttention";
import {
  useImportProfiles,
  useProfileRules,
  useUpdateImportRule,
  useDeleteImportRule,
  useDeleteImportProfile,
  useProjectBindings,
  useDeleteProjectBinding,
  useImportAlertSettings,
  useUpdateImportAlertSettings,
  type ImportRule,
  type ImportAlertSettings,
} from "@/hooks/use-import-config";

export default function AdminImportMappingsPage() {
  return (
    <PageLayout
      header={
        <PageHeader
          title="Import setup"
          subtitle="What Smart Import remembers — column mappings, project bindings, and alerts"
        />
      }
    >
      <Tabs defaultValue="attention" className="space-y-4">
        <TabsList>
          <TabsTrigger value="attention" data-testid="tab-attention">
            <AlertTriangle className="h-4 w-4 mr-1.5" /> Needs attention
          </TabsTrigger>
          <TabsTrigger value="mappings" data-testid="tab-mappings">
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Column mappings
          </TabsTrigger>
          <TabsTrigger value="bindings" data-testid="tab-bindings">
            <Link2 className="h-4 w-4 mr-1.5" /> Project bindings
          </TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-alerts">
            <Bell className="h-4 w-4 mr-1.5" /> Teams alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attention">
          <ImportsNeedingAttention />
        </TabsContent>
        <TabsContent value="mappings">
          <MappingsTab />
        </TabsContent>
        <TabsContent value="bindings">
          <BindingsTab />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

// =========================================================================
// Column mappings
// =========================================================================

function MappingsTab() {
  const { data, isLoading } = useImportProfiles();
  const profiles = data?.profiles ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const deleteProfile = useDeleteImportProfile();
  const { toast } = useToast();

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Saved templates</CardTitle>
          <CardDescription>Each tracker layout you've corrected once.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="profiles-empty">
              Nothing learned yet. Mappings appear here once you correct a column during an import.
            </p>
          ) : (
            profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                data-testid={`profile-${p.id}`}
                className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                  p.id === selectedId ? "bg-emerald-50 text-emerald-900" : "hover:bg-muted"
                }`}
              >
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {p.ruleCount} rule{p.ruleCount === 1 ? "" : "s"}
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">{selected ? selected.name : "Select a template"}</CardTitle>
            <CardDescription>
              {selected ? "Edit where a source column maps, or remove a rule." : "Pick a template on the left."}
            </CardDescription>
          </div>
          {selected && (
            <Button
              variant="outline"
              size="sm"
              className="text-rose-700 border-rose-200 hover:bg-rose-50"
              data-testid="btn-clear-profile"
              onClick={() =>
                deleteProfile.mutate(selected.id, {
                  onSuccess: () => {
                    toast({ title: "Template forgotten", description: `"${selected.name}" and its rules were cleared.` });
                    setSelectedId(null);
                  },
                })
              }
            >
              <Trash2 className="h-4 w-4 mr-1.5" /> Forget template
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {selected ? <RulesTable profileId={selected.id} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function RulesTable({ profileId }: { profileId: number }) {
  const { data, isLoading } = useProfileRules(profileId);
  const rules = data?.rules ?? [];

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading rules…</p>;
  if (rules.length === 0) return <p className="text-xs text-muted-foreground">No rules in this template.</p>;

  return (
    <Table data-testid="rules-table">
      <TableHeader>
        <TableRow>
          <TableHead>Section</TableHead>
          <TableHead>Source column</TableHead>
          <TableHead>Maps to field</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} profileId={profileId} />
        ))}
      </TableBody>
    </Table>
  );
}

function RuleRow({ rule, profileId }: { rule: ImportRule; profileId: number }) {
  const [field, setField] = useState(rule.canonicalField);
  const update = useUpdateImportRule();
  const remove = useDeleteImportRule();
  const { toast } = useToast();
  const dirty = field.trim() !== rule.canonicalField && field.trim().length > 0;

  return (
    <TableRow data-testid={`rule-row-${rule.id}`}>
      <TableCell>
        <Badge variant="outline" className="text-[10px]">{rule.section}</Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">{rule.sourceHeader}</TableCell>
      <TableCell>
        <Input
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="h-8 text-xs"
          data-testid={`rule-field-${rule.id}`}
        />
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || update.isPending}
          data-testid={`btn-save-rule-${rule.id}`}
          onClick={() =>
            update.mutate(
              { id: rule.id, profileId, patch: { canonicalField: field.trim() } },
              {
                onSuccess: () => toast({ title: "Mapping updated" }),
              },
            )
          }
        >
          <Save className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-rose-700"
          data-testid={`btn-delete-rule-${rule.id}`}
          onClick={() =>
            remove.mutate(
              { id: rule.id, profileId },
              {
                onSuccess: () => toast({ title: "Rule removed" }),
              },
            )
          }
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// =========================================================================
// Project bindings
// =========================================================================

function BindingsTab() {
  const { data, isLoading } = useProjectBindings();
  const bindings = data?.bindings ?? [];
  const remove = useDeleteProjectBinding();
  const { toast } = useToast();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Project bindings</CardTitle>
        <CardDescription>
          Trackers remembered against a project, so scheduled imports don't re-guess. Forget one to re-prompt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : bindings.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="bindings-empty">
            No bindings yet. They're created when you confirm a project for an import.
          </p>
        ) : (
          <Table data-testid="bindings-table">
            <TableHeader>
              <TableRow>
                <TableHead>Source (file key)</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <TableRow key={b.id} data-testid={`binding-row-${b.id}`}>
                  <TableCell className="font-mono text-xs max-w-[280px] truncate">{b.sourceKey}</TableCell>
                  <TableCell className="text-sm">{b.projectName ?? `#${b.projectId}`}</TableCell>
                  <TableCell className="text-xs">{b.timesUsed}×</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {b.lastUsedAt ? formatRelativeWithAbsoluteZA(b.lastUsedAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-700"
                      data-testid={`btn-forget-binding-${b.id}`}
                      onClick={() =>
                        remove.mutate(b.id, {
                          onSuccess: () => toast({ title: "Binding forgotten" }),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" /> Forget
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// =========================================================================
// Teams alerts
// =========================================================================

const EMPTY_ALERTS: ImportAlertSettings = {
  alertsEnabled: false,
  alertTeamId: null,
  alertChannelId: null,
  alertSenderUserId: null,
  alertOnFailure: true,
  alertOnReview: true,
};

function AlertsTab() {
  const { data, isLoading } = useImportAlertSettings();
  const save = useUpdateImportAlertSettings();
  const { toast } = useToast();
  const [form, setForm] = useState<ImportAlertSettings>(EMPTY_ALERTS);

  useEffect(() => {
    if (data?.alerts) setForm(data.alerts);
  }, [data]);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;

  if (data && !data.configured) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground" data-testid="alerts-not-configured">
            Configure the SharePoint import scheduler first — alert settings live alongside it.
          </p>
        </CardContent>
      </Card>
    );
  }

  const set = (patch: Partial<ImportAlertSettings>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Teams alerts</CardTitle>
        <CardDescription>
          Post to a Microsoft Teams channel when a scheduled import fails or parks for review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        <div className="flex items-center justify-between">
          <Label htmlFor="alertsEnabled">Send alerts</Label>
          <Switch
            id="alertsEnabled"
            checked={form.alertsEnabled}
            onCheckedChange={(v) => set({ alertsEnabled: v })}
            data-testid="switch-alerts-enabled"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alertTeamId">Teams team ID</Label>
          <Input
            id="alertTeamId"
            value={form.alertTeamId ?? ""}
            onChange={(e) => set({ alertTeamId: e.target.value || null })}
            placeholder="e.g. 19:abc...@thread.tacv2"
            data-testid="input-team-id"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alertChannelId">Channel ID</Label>
          <Input
            id="alertChannelId"
            value={form.alertChannelId ?? ""}
            onChange={(e) => set({ alertChannelId: e.target.value || null })}
            placeholder="e.g. 19:def...@thread.tacv2"
            data-testid="input-channel-id"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alertSenderUserId">Sender user ID</Label>
          <Input
            id="alertSenderUserId"
            type="number"
            value={form.alertSenderUserId ?? ""}
            onChange={(e) => set({ alertSenderUserId: e.target.value ? Number(e.target.value) : null })}
            placeholder="App user whose Microsoft token posts the message"
            data-testid="input-sender-id"
          />
          <p className="text-[11px] text-muted-foreground">
            The scheduler has no user, so it posts using this person's connected Microsoft account.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="alertOnFailure">Alert on failure</Label>
          <Switch
            id="alertOnFailure"
            checked={form.alertOnFailure}
            onCheckedChange={(v) => set({ alertOnFailure: v })}
            data-testid="switch-on-failure"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="alertOnReview">Alert when parked for review</Label>
          <Switch
            id="alertOnReview"
            checked={form.alertOnReview}
            onCheckedChange={(v) => set({ alertOnReview: v })}
            data-testid="switch-on-review"
          />
        </div>
        <Button
          data-testid="btn-save-alerts"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(form, {
              onSuccess: () => toast({ title: "Alert settings saved" }),
            })
          }
        >
          <Save className="h-4 w-4 mr-1.5" /> Save alert settings
        </Button>
      </CardContent>
    </Card>
  );
}

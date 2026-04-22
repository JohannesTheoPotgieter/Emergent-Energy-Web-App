import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useStageDefinitions, useStageChecklistTemplates } from "@/hooks/use-stage-lifecycle";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import type { StageDefinition, StageChecklistTemplate } from "@shared/schema";
import { Settings, ListChecks, Save, Loader2, Trash2 } from "lucide-react";

export default function StageAdminPanel() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Stage Lifecycle Admin</h1>
      </div>

      <Tabs defaultValue="definitions">
        <TabsList>
          <TabsTrigger value="definitions">Stage Definitions</TabsTrigger>
          <TabsTrigger value="templates">Checklist Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="definitions" className="mt-4">
          <StageDefinitionsTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <ChecklistTemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StageDefinitionsTab() {
  const { data, isLoading } = useStageDefinitions();
  const qc = useQueryClient();
  const [saving, setSaving] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, { stageName: string; description: string; stageSequence: number }>>({});
  const [newStage, setNewStage] = useState({ stageCode: "", stageName: "", stageSequence: 99 });

  const handleSave = async (def: StageDefinition) => {
    setSaving(def.id);
    try {
      const form = draft[def.id] || { stageName: def.stageName, description: def.description || "", stageSequence: def.stageSequence };
      await apiRequest("PATCH", `/api/admin/stage-definitions/${def.id}`, {
        stageName: form.stageName,
        description: form.description,
        stageSequence: form.stageSequence,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/stage-definitions"] });
    } finally {
      setSaving(null);
    }
  };

  const handleToggle = async (def: StageDefinition) => {
    setSaving(def.id);
    try {
      await apiRequest("PATCH", `/api/admin/stage-definitions/${def.id}`, { isActive: !def.isActive });
      qc.invalidateQueries({ queryKey: ["/api/admin/stage-definitions"] });
    } finally {
      setSaving(null);
    }
  };

  const handleCreate = async () => {
    if (!newStage.stageCode.trim() || !newStage.stageName.trim()) return;
    await apiRequest("POST", "/api/admin/stage-definitions", newStage);
    setNewStage({ stageCode: "", stageName: "", stageSequence: 99 });
    qc.invalidateQueries({ queryKey: ["/api/admin/stage-definitions"] });
  };

  const handleArchive = async (def: StageDefinition) => {
    setSaving(def.id);
    try {
      await apiRequest("DELETE", `/api/admin/stage-definitions/${def.id}`);
      qc.invalidateQueries({ queryKey: ["/api/admin/stage-definitions"] });
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-2">
      <Card>
        <CardContent className="grid grid-cols-12 gap-2 py-3">
          <Input className="col-span-3" placeholder="Stage code" value={newStage.stageCode} onChange={(e) => setNewStage((p) => ({ ...p, stageCode: e.target.value }))} />
          <Input className="col-span-5" placeholder="Stage name" value={newStage.stageName} onChange={(e) => setNewStage((p) => ({ ...p, stageName: e.target.value }))} />
          <Input className="col-span-2" placeholder="Order" type="number" value={newStage.stageSequence} onChange={(e) => setNewStage((p) => ({ ...p, stageSequence: Number(e.target.value) || 0 }))} />
          <Button className="col-span-2" onClick={handleCreate}>Create</Button>
        </CardContent>
      </Card>
      {data?.definitions?.map((def: StageDefinition) => (
        <Card key={def.id}>
          <CardContent className="flex items-center gap-4 py-3">
            <Badge variant="outline" className="text-xs">{def.stageSequence}</Badge>
            <div className="flex-1">
              <Input
                className="h-8 text-sm font-medium"
                value={draft[def.id]?.stageName ?? def.stageName}
                onChange={(e) => setDraft((prev) => ({ ...prev, [def.id]: { stageName: e.target.value, description: prev[def.id]?.description ?? def.description ?? "", stageSequence: prev[def.id]?.stageSequence ?? def.stageSequence } }))}
              />
              <p className="text-xs text-muted-foreground">{def.stageCode}</p>
              <Input
                className="h-8 text-xs mt-1"
                placeholder="Description"
                value={draft[def.id]?.description ?? def.description ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [def.id]: { stageName: prev[def.id]?.stageName ?? def.stageName, description: e.target.value, stageSequence: prev[def.id]?.stageSequence ?? def.stageSequence } }))}
              />
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <Input
                className="h-8 w-16 mb-1 text-xs"
                type="number"
                value={draft[def.id]?.stageSequence ?? def.stageSequence}
                onChange={(e) => setDraft((prev) => ({ ...prev, [def.id]: { stageName: prev[def.id]?.stageName ?? def.stageName, description: prev[def.id]?.description ?? def.description ?? "", stageSequence: Number(e.target.value) || 0 } }))}
              />
              <p>Owner: {def.defaultOwnerRole || '-'}</p>
              <p>Approver: {def.defaultApproverRole || '-'}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => handleSave(def)} disabled={saving === def.id}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleArchive(def)} disabled={saving === def.id}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Active</span>
              <Switch
                checked={def.isActive}
                onCheckedChange={() => handleToggle(def)}
                disabled={saving === def.id}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChecklistTemplatesTab() {
  const { data, isLoading } = useStageChecklistTemplates();
  const qc = useQueryClient();
  const [saving, setSaving] = useState<number | null>(null);

  const handleToggleGate = async (template: StageChecklistTemplate) => {
    setSaving(template.id);
    try {
      await apiRequest("PATCH", `/api/admin/stage-checklist-templates/${template.id}`, {
        blocksGate: !template.blocksGate,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/stage-checklist-templates"] });
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const templates = data?.templates ?? [];
  const grouped: Record<string, StageChecklistTemplate[]> = {};
  for (const t of templates) {
    if (!grouped[t.stageCode]) grouped[t.stageCode] = [];
    grouped[t.stageCode].push(t);
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([stageCode, items]) => (
        <Card key={stageCode}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{stageCode.replace(/^S\d+_/, '').replace(/_/g, ' ')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {items.map((t: StageChecklistTemplate) => (
                <div key={t.id} className="flex items-center gap-2 py-1 text-sm">
                  <Badge variant="outline" className="text-[10px] w-20 justify-center">{t.department}</Badge>
                  <span className="flex-1">{t.itemName}</span>
                  <span className="text-xs text-muted-foreground">{t.itemCode}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">Blocks gate</span>
                    <Switch
                      checked={t.blocksGate}
                      onCheckedChange={() => handleToggleGate(t)}
                      disabled={saving === t.id}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

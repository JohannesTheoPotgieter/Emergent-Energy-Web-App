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
import { Settings, ListChecks, Save, Loader2 } from "lucide-react";

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

  const handleToggle = async (def: StageDefinition) => {
    setSaving(def.id);
    try {
      await apiRequest("PATCH", `/api/admin/stage-definitions/${def.id}`, { isActive: !def.isActive });
      qc.invalidateQueries({ queryKey: ["/api/admin/stage-definitions"] });
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-2">
      {data?.definitions?.map((def: StageDefinition) => (
        <Card key={def.id}>
          <CardContent className="flex items-center gap-4 py-3">
            <Badge variant="outline" className="text-xs">{def.stageSequence}</Badge>
            <div className="flex-1">
              <p className="text-sm font-medium">{def.stageName}</p>
              <p className="text-xs text-muted-foreground">{def.stageCode}</p>
              {def.description && <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>}
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>Owner: {def.defaultOwnerRole || '-'}</p>
              <p>Approver: {def.defaultApproverRole || '-'}</p>
            </div>
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

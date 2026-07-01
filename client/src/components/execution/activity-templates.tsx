// ============================================================
// Activity Planning — link templates
//
// Build-once / apply link templates for the Activity Planning workspace: save a
// project's milestone→task→outflow links as keyword rules (TemplateControls) and
// hand-edit those rules (TemplateManagerDialog). Extracted from
// milestone-tracker.tsx. Writes go through the milestone-tracker template routes.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { apiRequest } from "@/lib/queryClient";

interface TemplateRule { label: string; milestoneKeywords: string[]; taskKeywords: string[]; outflowKeywords: string[] }
interface TemplateSummary { id: number; name: string; description: string | null; rules: TemplateRule[] }
interface ApplyResult { milestoneTaskLinks: number; taskCostLinks: number; rulesMatched: number; rulesTotal: number }

const csvToWords = (s: string): string[] => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const wordsToCsv = (a: string[]): string => a.join(", ");

/** Build-once / apply link templates: save this project's milestone→task→outflow
 *  links as keyword rules, or apply a saved template to auto-link this project. */
export function TemplateControls({ projectId, onApplied }: { projectId: number; onApplied: () => void }) {
  const qc = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [name, setName] = useState("");
  const { data: templates } = useQuery<TemplateSummary[]>({ queryKey: ["/api/milestone-tracker/templates"] });

  const apply = useApiMutation({
    mutationFn: async (templateId: number): Promise<ApplyResult> => {
      const res = await apiRequest("POST", `/api/milestone-tracker/templates/${templateId}/apply`, { projectId });
      return res.json();
    },
    successToast: (r: ApplyResult) =>
      `Template applied — ${r.milestoneTaskLinks} task link(s), ${r.taskCostLinks} outflow link(s) from ${r.rulesMatched}/${r.rulesTotal} rules`,
    errorToast: "Could not apply template",
    onSuccess: onApplied,
  });

  const save = useApiMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/milestone-tracker/templates/from-project", { projectId, name: name.trim() }); },
    successToast: "Template saved",
    errorToast: "Could not save template",
    onSuccess: () => { setSaveOpen(false); setName(""); qc.invalidateQueries({ queryKey: ["/api/milestone-tracker/templates"] }); },
  });

  const options = (templates ?? []).map((t) => ({ value: String(t.id), label: t.name }));
  return (
    <div className="flex items-center gap-2">
      <SearchableSelect value="" onValueChange={(v) => { if (v) apply.mutate(Number(v)); }}
        placeholder={options.length ? "Apply template…" : "No templates yet"} triggerClassName="h-8 w-44 text-xs" options={options} data-testid="apply-template" />
      <Button size="sm" variant="outline" className="h-8" onClick={() => setSaveOpen(true)} data-testid="save-template">Save as template</Button>
      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setManageOpen(true)} aria-label="Manage templates" data-testid="manage-templates"><Settings2 className="w-4 h-4" /></Button>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Save as template</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Captures this project's milestone → task → outflow links as keyword rules. Apply it to a new project to auto-link by matching milestone, task and outflow words.</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name, e.g. Standard C&I rooftop" data-testid="template-name" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()} data-testid="template-save-confirm">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TemplateManagerDialog open={manageOpen} onOpenChange={setManageOpen} templates={templates ?? []} onChanged={() => { qc.invalidateQueries({ queryKey: ["/api/milestone-tracker/templates"] }); }} />
    </div>
  );
}

/** Hand-edit a template's name and keyword rules (milestone / task / outflow
 *  words, comma-separated), add or remove rules, or delete the template. */
function TemplateManagerDialog({ open, onOpenChange, templates, onChanged }: {
  open: boolean; onOpenChange: (v: boolean) => void; templates: TemplateSummary[]; onChanged: () => void;
}) {
  const [selId, setSelId] = useState<string>("");
  const [name, setName] = useState("");
  const [rules, setRules] = useState<Array<{ label: string; milestone: string; task: string; outflow: string }>>([]);
  const selected = templates.find((t) => String(t.id) === selId) ?? null;

  // Load the picked template's values into the editable form ONCE per selection.
  // Keying on `selected` (a fresh object each render) re-ran this on every
  // background templates refetch and wiped the user's in-progress edits; sync
  // only when the selected template's identity actually changes.
  const lastSyncedId = useRef<string | null>(null);
  useEffect(() => {
    if (lastSyncedId.current === selId) return; // selection unchanged — keep edits
    const t = templates.find((x) => String(x.id) === selId) ?? null;
    if (selId && !t) return; // templates not loaded yet — don't clobber, wait
    lastSyncedId.current = selId;
    if (!t) { setName(""); setRules([]); return; }
    setName(t.name);
    setRules(t.rules.map((r) => ({ label: r.label, milestone: wordsToCsv(r.milestoneKeywords), task: wordsToCsv(r.taskKeywords), outflow: wordsToCsv(r.outflowKeywords) })));
  }, [selId, templates]);

  const updateRule = (i: number, patch: Partial<{ label: string; milestone: string; task: string; outflow: string }>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = useApiMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        rules: rules.map((r) => ({ label: r.label.trim() || "Rule", milestoneKeywords: csvToWords(r.milestone), taskKeywords: csvToWords(r.task), outflowKeywords: csvToWords(r.outflow) })),
      };
      await apiRequest("PATCH", `/api/milestone-tracker/templates/${selId}`, payload);
    },
    successToast: "Template updated", errorToast: "Could not update template",
    onSuccess: onChanged,
  });
  const del = useApiMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/milestone-tracker/templates/${selId}`); },
    successToast: "Template deleted", errorToast: "Could not delete template",
    onSuccess: () => { setSelId(""); onChanged(); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Manage templates</DialogTitle></DialogHeader>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No templates yet — link a project's milestones, tasks and outflows, then “Save as template”.</p>
        ) : (
          <>
            <label className="text-sm block">
              <span className="text-muted-foreground">Template</span>
              <SearchableSelect value={selId} onValueChange={setSelId} placeholder="Pick a template to edit…" triggerClassName="h-8 text-xs"
                options={templates.map((t) => ({ value: String(t.id), label: t.name }))} data-testid="manage-pick" />
            </label>
            {selected && (
              <div className="space-y-3">
                <label className="text-sm block">
                  <span className="text-muted-foreground">Name</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="manage-name" />
                </label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Rules <span className="text-muted-foreground">· words are comma-separated, matched case-insensitively</span></span>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setRules((rs) => [...rs, { label: "New rule", milestone: "", task: "", outflow: "" }])} data-testid="manage-add-rule"><Plus className="w-3.5 h-3.5" />Add rule</Button>
                  </div>
                  {rules.length === 0 && <p className="text-xs text-muted-foreground">No rules. Add one, or re-save from a linked project.</p>}
                  {rules.map((r, i) => (
                    <div key={i} className="rounded-md border p-2 space-y-1.5" data-testid={`manage-rule-${i}`}>
                      <div className="flex items-center gap-2">
                        <Input value={r.label} onChange={(e) => updateRule(i, { label: e.target.value })} placeholder="Rule label" className="h-7 text-xs flex-1" />
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove rule"><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></Button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                        <label className="text-[11px] text-emerald-700">Milestone words<Input value={r.milestone} onChange={(e) => updateRule(i, { milestone: e.target.value })} placeholder="acceptance, deposit" className="h-7 text-xs" /></label>
                        <label className="text-[11px] text-slate-600">Task words<Input value={r.task} onChange={(e) => updateRule(i, { task: e.target.value })} placeholder="install, signoff" className="h-7 text-xs" /></label>
                        <label className="text-[11px] text-red-700">Outflow words<Input value={r.outflow} onChange={(e) => updateRule(i, { outflow: e.target.value })} placeholder="huawei, inverter" className="h-7 text-xs" /></label>
                      </div>
                    </div>
                  ))}
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" className="mr-auto text-red-600 hover:text-red-700" onClick={() => del.mutate()} disabled={del.isPending} data-testid="manage-delete">Delete template</Button>
                  <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
                  <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()} data-testid="manage-save">Save changes</Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

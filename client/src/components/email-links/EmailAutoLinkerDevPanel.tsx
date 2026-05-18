import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {} from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Mail, Send, Loader2, CheckCircle2, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api-error";

/**
 * Dev-only front-end trigger for the email auto-linker mock ingester.
 *
 * Lets super users synthesize one or more inbound emails and run them
 * through the layered-signal auto-linker to verify (without a Graph
 * webhook) that:
 *   - client_domain matches attribute to the right client
 *   - subject_tag [PRJ-42] regex finds the project
 *   - thread_inheritance inherits the right project on replies
 *
 * Posts to /api/dev/email-links/mock-ingest (which refuses in prod).
 * Results show per-email signalsFired + resolved client/project.
 */

interface DraftRow {
  id: string;
  graphMessageId: string;
  senderEmail: string;
  subject: string;
  graphConversationId: string;
}

interface AutoLinkResult {
  rowsCreated: number;
  signalsFired: string[];
  clientId: number | null;
  projectId: number | null;
}

function blankDraft(): DraftRow {
  const uid = Math.random().toString(36).slice(2, 10);
  return {
    id: uid,
    graphMessageId: `mock-msg-${uid}`,
    senderEmail: "",
    subject: "",
    graphConversationId: `mock-thread-${uid}`,
  };
}

export function EmailAutoLinkerDevPanel() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<DraftRow[]>([blankDraft()]);
  const [results, setResults] = useState<AutoLinkResult[] | null>(null);

  const ingestMut = useMutation({
    mutationFn: async () => {
      const body = {
        emails: drafts
          .filter((d) => d.senderEmail.trim() && d.subject.trim())
          .map((d) => ({
            graphMessageId: d.graphMessageId.trim(),
            graphConversationId: d.graphConversationId.trim() || undefined,
            senderEmail: d.senderEmail.trim(),
            subject: d.subject.trim(),
          })),
      };
      if (body.emails.length === 0) throw new Error("Add at least one email with sender + subject.");
      const res = await apiRequest("POST", "/api/dev/email-links/mock-ingest", body);
      return res.json() as Promise<{ results: AutoLinkResult[] }>;
    },
    onSuccess: (data) => {
      setResults(data.results ?? []);
      const total = (data.results ?? []).reduce((sum, r) => sum + r.rowsCreated, 0);
      toast({
        title: "Ingest complete",
        description: `${total} attribution row${total === 1 ? "" : "s"} created.`,
      });
      // Refresh the Communications tab (if the user is also viewing a
      // project) plus any approval counts.
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
    },
    onError: (err) => {
      toast({
        title: "Ingest failed",
        description: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : "Please try again."),
        variant: "destructive",
      });
    },
  });

  const addDraft = () => setDrafts((prev) => [...prev, blankDraft()]);
  const removeDraft = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id));
  const patchDraft = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  return (
    <Card data-testid="email-auto-linker-dev-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Email auto-linker — test ingest
          <Badge variant="outline" className="text-[10px]">Dev-only</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-xs text-muted-foreground">
          Synthesize inbound emails to verify domain-match + subject-tag + thread-inheritance auto-linking. Refuses in production.
        </p>
        <ul className="space-y-3">
          {drafts.map((d, idx) => (
            <li key={d.id} className="rounded-md border bg-muted/20 p-3 space-y-2" data-testid={`mock-email-draft-${idx}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Email #{idx + 1}</p>
                {drafts.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-700"
                    onClick={() => removeDraft(d.id)}
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Sender email</Label>
                  <Input
                    value={d.senderEmail}
                    onChange={(e) => patchDraft(d.id, { senderEmail: e.target.value })}
                    placeholder="bob@clientabc.com"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Subject</Label>
                  <Input
                    value={d.subject}
                    onChange={(e) => patchDraft(d.id, { subject: e.target.value })}
                    placeholder="[PRJ-42] Project update"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Message ID (unique)</Label>
                  <Input
                    value={d.graphMessageId}
                    onChange={(e) => patchDraft(d.id, { graphMessageId: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Conversation (thread) ID</Label>
                  <Input
                    value={d.graphConversationId}
                    onChange={(e) => patchDraft(d.id, { graphConversationId: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={addDraft}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add another
          </Button>
          <Button size="sm" onClick={() => ingestMut.mutate()} disabled={ingestMut.isPending}>
            {ingestMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Run auto-linker
          </Button>
        </div>

        {results && (
          <div className="rounded-md border bg-card p-3 space-y-2">
            <p className="text-xs font-medium">Results</p>
            <ul className="space-y-1.5 text-xs">
              {results.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {r.rowsCreated > 0
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                    Email #{i + 1}:
                    {r.signalsFired.length > 0
                      ? ` fired ${r.signalsFired.join(", ")}`
                      : " no signals matched (would need manual link)"}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {r.rowsCreated} row{r.rowsCreated === 1 ? "" : "s"}
                    {r.clientId ? ` · client ${r.clientId}` : ""}
                    {r.projectId ? ` · project ${r.projectId}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

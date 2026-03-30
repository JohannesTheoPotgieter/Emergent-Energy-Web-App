import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useProjectQueries,
  useCreateQuery,
  useRespondToQuery,
} from "@/hooks/use-collaboration-workflow";
import { QUERY_TYPES, QUERY_ROUTING } from "@shared/schema";
import { Plus, MessageSquare, Clock } from "lucide-react";
import type { ProjectQuery } from "@shared/schema";

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700" },
  answered: { label: "Answered", color: "bg-green-100 text-green-700" },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500" },
};

const PRIORITY_BADGES: Record<string, { label: string; color: string }> = {
  normal: { label: "Normal", color: "bg-gray-100 text-gray-600" },
  urgent: { label: "Urgent", color: "bg-red-100 text-red-700" },
};

interface QueryRouterProps {
  projectId: number;
  stageCode: string;
}

export function QueryRouter({ projectId, stageCode }: QueryRouterProps) {
  const { data } = useProjectQueries(projectId, stageCode);
  const createMutation = useCreateQuery(projectId);
  const respondMutation = useRespondToQuery(projectId);

  const [showForm, setShowForm] = useState(false);
  const [queryType, setQueryType] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [respondId, setRespondId] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");

  const queries = data?.queries || [];
  const openCount = queries.filter((q: ProjectQuery) => q.status === "open" || q.status === "in_progress").length;

  const handleCreate = async () => {
    if (!queryType || !subject.trim()) return;
    await createMutation.mutateAsync({
      stageCode,
      queryType,
      subject,
      description: description || undefined,
      priority,
    });
    setShowForm(false);
    setQueryType("");
    setSubject("");
    setDescription("");
    setPriority("normal");
  };

  const handleRespond = async () => {
    if (!respondId || !responseText.trim()) return;
    await respondMutation.mutateAsync({ id: respondId, responseText });
    setRespondId(null);
    setResponseText("");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            <MessageSquare className="inline mr-1 h-3.5 w-3.5" />
            Queries
            {openCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{openCount} open</Badge>
            )}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-3 w-3" /> Raise Query
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showForm && (
          <div className="space-y-2 rounded border p-2">
            <div className="flex gap-2">
              <select
                value={queryType}
                onChange={(e) => setQueryType(e.target.value)}
                className="h-8 rounded border px-2 text-xs flex-1"
              >
                <option value="">Query type...</option>
                {QUERY_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-8 rounded border px-2 text-xs w-24"
              >
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            {queryType && (
              <p className="text-xs text-muted-foreground">
                Routes to: <strong>{QUERY_ROUTING[queryType] || "PM"}</strong>
              </p>
            )}
            <Input
              placeholder="Subject..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-8 text-sm"
            />
            <Textarea
              placeholder="Description (optional)..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm min-h-[40px]"
              rows={2}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={!queryType || !subject.trim() || createMutation.isPending}>
                Submit Query
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {queries.length === 0 && !showForm && (
          <p className="text-xs text-muted-foreground">No queries raised.</p>
        )}

        {queries.map((q: ProjectQuery) => {
          const statusBadge = STATUS_BADGES[q.status] || STATUS_BADGES.open;
          const priorityBadge = PRIORITY_BADGES[q.priority] || PRIORITY_BADGES.normal;
          const ageDays = Math.floor((Date.now() - new Date(q.createdAt).getTime()) / 86400000);
          const isStale = ageDays > 3 && (q.status === "open" || q.status === "in_progress");

          return (
            <div key={q.id} className={`rounded border px-2 py-1.5 text-xs space-y-1 ${isStale ? "border-red-300 bg-red-50" : ""}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium">{q.subject}</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>{q.queryType}</span>
                    <span>→ {q.assignedToDepartment}</span>
                    <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{ageDays}d</span>
                    {isStale && <span className="text-red-600 font-medium">Overdue</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {q.priority === "urgent" && <Badge className={priorityBadge.color}>{priorityBadge.label}</Badge>}
                  <Badge className={statusBadge.color}>{statusBadge.label}</Badge>
                </div>
              </div>

              {q.description && <p className="text-muted-foreground">{q.description}</p>}

              {q.responseText && (
                <div className="rounded bg-green-50 p-1.5">
                  <p className="font-medium text-green-700">Response:</p>
                  <p>{q.responseText}</p>
                </div>
              )}

              {(q.status === "open" || q.status === "in_progress") && respondId === q.id && (
                <div className="flex gap-1">
                  <Textarea
                    placeholder="Response..."
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    className="text-xs min-h-[30px] flex-1"
                    rows={2}
                  />
                  <Button size="sm" className="h-auto text-xs" onClick={handleRespond} disabled={!responseText.trim()}>
                    Reply
                  </Button>
                </div>
              )}

              {(q.status === "open" || q.status === "in_progress") && respondId !== q.id && (
                <Button size="sm" variant="ghost" className="h-5 px-1 text-xs" onClick={() => setRespondId(q.id)}>
                  Respond
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

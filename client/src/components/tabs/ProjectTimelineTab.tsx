import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowDownUp, CalendarClock, ClipboardCheck, FileText, Filter, Package, ShieldAlert, UserCircle2 } from "lucide-react";

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

type ProjectEvent = {
  id: number;
  eventType: string;
  eventTimestamp: string;
  actorUserId: number | null;
  actorRole: string | null;
  actorName: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  summary: string;
  details: Record<string, any> | null;
};

const EVENT_FILTERS = [
  "project.created",
  "project.stage_changed",
  "project.gate_passed",
  "project.gate_failed",
  "project.override_granted",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "procurement.item_created",
  "procurement.po_issued",
  "procurement.delivery_captured",
  "invoice.captured",
  "invoice.approved",
  "invoice.payment_status_changed",
  "raid.created",
  "raid.status_changed",
  "change.created",
  "change.status_changed",
];

function eventIcon(type: string) {
  if (type.startsWith("approval.")) return <ClipboardCheck className="h-4 w-4 text-blue-600" />;
  if (type.startsWith("procurement.") || type.startsWith("invoice.")) return <Package className="h-4 w-4 text-violet-600" />;
  if (type.startsWith("project.gate") || type.includes("override")) return <ShieldAlert className="h-4 w-4 text-amber-600" />;
  if (type.startsWith("change.") || type.startsWith("raid.")) return <FileText className="h-4 w-4 text-orange-600" />;
  return <CalendarClock className="h-4 w-4 text-emerald-600" />;
}

function sourceLink(projectName: string, e: ProjectEvent): string | null {
  if (e.sourceEntityType === "approvals") return `/project/${encodeURIComponent(projectName)}?tab=history`;
  if (e.sourceEntityType === "procurement_items" || e.sourceEntityType === "invoice_captures") return `/project/${encodeURIComponent(projectName)}?tab=money`;
  if (e.sourceEntityType === "raid_items") return `/project/${encodeURIComponent(projectName)}?tab=history`;
  if (e.sourceEntityType === "change_requests") return `/project/${encodeURIComponent(projectName)}?tab=history`;
  return null;
}

export function ProjectTimelineTab({ projectName, projectInfoId }: { projectName: string; projectInfoId: number | null }) {
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [eventType, setEventType] = useState<string>("");
  const [actorUserId, setActorUserId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("order", order);
    if (eventType) params.set("eventTypes", eventType);
    if (actorUserId) params.set("actorUserId", actorUserId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [order, eventType, actorUserId, from, to]);

  const { data = [], isLoading } = useQuery<ProjectEvent[]>({
    queryKey: ["project-events", projectInfoId, queryString],
    queryFn: async () => {
      if (!projectInfoId) return [];
      const res = await engFetch(`/api/project-events/project/${projectInfoId}?${queryString}`);
      if (!res.ok) return [];
      const payload = await res.json();
      return payload.events || [];
    },
    enabled: !!projectInfoId,
  });

  return (
    <div className="space-y-4" data-testid="project-timeline-tab">
      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium"><Filter className="h-4 w-4" /> Timeline filters</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Event type</Label>
            <select className="h-9 w-full rounded-md border px-2 text-xs" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              <option value="">All</option>
              {EVENT_FILTERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Actor user ID</Label>
            <Input value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} placeholder="e.g. 7" className="h-9 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Order</Label>
            <Button variant="outline" className="h-9 w-full justify-between text-xs" onClick={() => setOrder(order === "desc" ? "asc" : "desc")}> 
              {order === "desc" ? "Newest first" : "Oldest first"} <ArrowDownUp className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading timeline…</div>}
      {!isLoading && data.length === 0 && <div className="text-sm text-muted-foreground">No timeline events for the selected filters.</div>}

      <div className="space-y-2">
        {data.map((e) => {
          const link = sourceLink(projectName, e);
          return (
            <Card key={e.id}>
              <CardContent className="p-3 flex items-start gap-3">
                <div className="mt-0.5">{eventIcon(e.eventType)}</div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{e.summary}</p>
                    <Badge variant="outline" className="text-[10px]">{e.eventType}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <CalendarClock className="h-3 w-3" /> {new Date(e.eventTimestamp).toLocaleString("en-ZA")}
                    <span>•</span>
                    <UserCircle2 className="h-3 w-3" /> {e.actorName || (e.actorUserId ? `User ${e.actorUserId}` : "System")}
                    {e.actorRole ? <span>({e.actorRole})</span> : null}
                  </p>
                  {link && <a className="text-xs text-primary underline" href={link}>Open source record</a>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

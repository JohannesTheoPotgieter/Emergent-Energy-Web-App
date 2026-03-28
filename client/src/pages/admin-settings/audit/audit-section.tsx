import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Clock, FileText, ChevronDown, ChevronRight } from "lucide-react";
import * as api from "../settings-api";
import type { AuditLogEntry } from "../settings-types";
import { summarizeChangeDetail } from "../settings-types";

const EVENT_TYPES = ["role_created", "role_updated", "role_deleted", "role_cloned", "role_archived", "user_role_changed", "user_override_added", "user_override_removed"];

function formatEventType(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getEventColor(type: string): string {
  if (type.includes("deleted") || type.includes("removed")) return "bg-red-100 text-red-700 border-red-200";
  if (type.includes("created") || type.includes("added") || type.includes("cloned")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (type.includes("updated") || type.includes("changed")) return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

export function AuditSection() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await api.fetchAuditLog({ eventType: eventTypeFilter || undefined });
    setEntries(data);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [eventTypeFilter]);

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-purple-600" />
          Permission Audit Log
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Track all role changes, permission updates, user overrides, and access control events.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-64">
            <SearchableSelect
              options={[{ value: "", label: "All Events" }, ...EVENT_TYPES.map((t) => ({ value: t, label: formatEventType(t) }))]}
              value={eventTypeFilter}
              onValueChange={setEventTypeFilter}
              placeholder="Filter by event type..."
            />
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">{entries.length} events</span>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading audit log...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No permission audit events recorded yet.</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-8" />
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Time</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Event</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Target</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Changed By</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Summary</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr className="border-t hover:bg-gray-50/50 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : entry.id)}>
                        <td className="px-2 py-2">
                          {isExpanded ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className={getEventColor(entry.eventType)}>
                            {formatEventType(entry.eventType)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {entry.targetRole && <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{entry.targetRole}</span>}
                          {entry.targetUserName && <span className="ml-1 text-gray-600">{entry.targetUserName}</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">
                          {entry.changedByName || "System"}
                          {entry.changedByRole && <span className="text-gray-400 ml-1">({entry.changedByRole})</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">
                          {summarizeChangeDetail(entry.changeDetail)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50/80">
                          <td colSpan={6} className="px-8 py-3">
                            <div className="text-xs space-y-1">
                              <p className="font-semibold text-gray-700">Full Change Detail</p>
                              <pre className="bg-white rounded border border-gray-200 p-3 overflow-x-auto text-[11px] text-gray-600 max-h-48">
                                {JSON.stringify(entry.changeDetail, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

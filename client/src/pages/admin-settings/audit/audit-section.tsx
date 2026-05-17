import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Clock, FileText, ChevronDown, ChevronRight, AlertTriangle, Search, X } from "lucide-react";
import * as api from "../settings-api";
import type { AuditLogEntry } from "../settings-types";
import { summarizeChangeDetail } from "../settings-types";
import { AuditDetailView } from "@/components/admin/audit-detail-view";
import { formatDateTimeZA } from "@/lib/datetime";

const EVENT_TYPES = ["role_created", "role_updated", "role_deleted", "role_cloned", "role_archived", "user_role_changed", "user_override_added", "user_override_updated", "user_override_removed"];

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
  // UI/UX audit P0 #9 — a failed fetch MUST fail loudly, not silently render
  // an empty "nothing recorded" state (which falsely implies a clean trail).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  // #9 — filter parity: search + changed-by, matching the activity log.
  const [textFilter, setTextFilter] = useState("");
  const [changedByFilter, setChangedByFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.fetchAuditLog({ eventType: eventTypeFilter || undefined });
      setEntries(data);
    } catch (err) {
      // Friendly message to the COO; technical detail to engineers only.
      console.error("[AuditSection] Failed to load audit log:", err);
      setLoadError("The audit log could not be loaded. This does NOT mean the trail is empty.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [eventTypeFilter]);

  const changedByOptions = useMemo(() => {
    const names = new Set<string>();
    entries.forEach((e) => { if (e.changedByName) names.add(e.changedByName); });
    return [{ value: "", label: "Anyone" }, ...[...names].sort().map((n) => ({ value: n, label: n }))];
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    return entries.filter((e) => {
      if (changedByFilter && e.changedByName !== changedByFilter) return false;
      if (!q) return true;
      const hay = [
        e.eventType,
        e.targetRole ?? "",
        e.targetUserName ?? "",
        e.changedByName ?? "",
        e.changedByRole ?? "",
        summarizeChangeDetail(e.changeDetail),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, textFilter, changedByFilter]);

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-emerald-600" />
          Audit log
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Every role change, permission update, user override, and access-control event. Times shown in SAST (Africa/Johannesburg).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-56">
            <SearchableSelect
              options={[{ value: "", label: "All Events" }, ...EVENT_TYPES.map((t) => ({ value: t, label: formatEventType(t) }))]}
              value={eventTypeFilter}
              onValueChange={setEventTypeFilter}
              placeholder="Filter by event type..."
            />
          </div>
          <div className="w-48">
            <SearchableSelect
              options={changedByOptions}
              value={changedByFilter}
              onValueChange={setChangedByFilter}
              placeholder="Changed by..."
            />
          </div>
          <div className="relative w-56">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 h-9 text-sm"
              placeholder="Search audit entries..."
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              data-testid="input-audit-search"
            />
          </div>
          {(textFilter || changedByFilter || eventTypeFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setTextFilter(""); setChangedByFilter(""); setEventTypeFilter(""); }}
              data-testid="button-audit-clear-filters"
            >
              <X className="h-3 w-3 mr-1" /> Clear filters
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">{filteredEntries.length} events</span>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading audit log...</div>
        ) : loadError ? (
          <div
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-6 text-center"
            data-testid="audit-load-error"
            role="alert"
          >
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-600" />
            <p className="text-sm font-semibold text-red-800">Audit log unavailable</p>
            <p className="mt-1 text-xs text-red-700">{loadError}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
              onClick={load}
              data-testid="button-audit-retry"
            >
              Retry
            </Button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            {entries.length === 0 ? "No audit events recorded yet." : "No events match your filters."}
          </div>
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
                {filteredEntries.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr className="border-t hover:bg-gray-50/50 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : entry.id)}>
                        <td className="px-2 py-2">
                          {isExpanded ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {formatDateTimeZA(entry.createdAt)}
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
                            <AuditDetailView detail={entry.changeDetail} title="Change detail" />
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

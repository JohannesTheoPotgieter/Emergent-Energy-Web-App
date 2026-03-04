import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Search, FileEdit, Filter, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { usePermission } from "@/hooks/use-permissions";

function pdFetch(url: string) {
  return fetch(url, { credentials: "include" }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); });
}

const REQUEST_TYPES = ["Cost Proposal", "IFC Planning", "Site Assessment", "Feasibility Study", "Grid Application", "Design Review", "Battery Assessment", "Full EPC"];
const STATUSES = ["Draft", "In Progress", "On Hold", "Completed", "Cancelled"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];

export default function PdTicketsPage() {
  const [, navigate] = useLocation();
  const { allowed: canView, loading: permLoading } = usePermission('pd_tickets', 'view');
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: tickets = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/pd/tickets"],
    queryFn: () => pdFetch("/api/pd/tickets"),
  });

  const filtered = tickets.filter((row: any) => {
    const t = row.ticket;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (typeFilter !== "all" && t.requestType !== typeFilter) return false;
    if (search) {
      const term = search.toLowerCase();
      return (
        t.projectSiteName?.toLowerCase().includes(term) ||
        (row.clientName || "").toLowerCase().includes(term) ||
        (row.projectName || "").toLowerCase().includes(term) ||
        (row.developerName || "").toLowerCase().includes(term)
      );
    }
    return true;
  }).sort((a: any, b: any) => {
    const today = new Date().toISOString().split("T")[0];
    const aOverdue = a.ticket.dueDate && a.ticket.dueDate < today && a.ticket.status !== "Completed" && a.ticket.status !== "Cancelled";
    const bOverdue = b.ticket.dueDate && b.ticket.dueDate < today && b.ticket.status !== "Completed" && b.ticket.status !== "Cancelled";
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    return 0;
  });

  if (!permLoading && !canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full"><CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to view PD Tickets.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2" data-testid="pd-tickets-title">
          <FileEdit className="h-5 w-5 text-violet-600" />
          PD Tickets
        </h1>
        <Button onClick={() => navigate("/pd/tickets/create")} className="gap-1.5" data-testid="btn-create-ticket">
          <Plus className="h-4 w-4" /> New Ticket
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tickets..." className="pl-9 h-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} data-testid="pd-tickets-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="pd-filter-status">
            <Filter className="h-3 w-3 mr-1" /><SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[110px] h-8 text-xs" data-testid="pd-filter-priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="pd-filter-type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {REQUEST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <FileEdit className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No tickets found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="bg-muted/40 border-b text-[11px] text-muted-foreground">
                <th className="text-left p-2.5 pl-3">Project / Site</th>
                <th className="text-left p-2.5">Client</th>
                <th className="text-left p-2.5">Request Type</th>
                <th className="text-left p-2.5">Priority</th>
                <th className="text-left p-2.5">Status</th>
                <th className="text-left p-2.5">Due Date</th>
                <th className="text-left p-2.5">Days In Progress</th>
                <th className="text-left p-2.5">Developer</th>
                <th className="text-left p-2.5">Tasks</th>
                <th className="text-left p-2.5">Designer</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row: any) => {
                const t = row.ticket;
                const today = new Date();
                const created = new Date(t.createdAt);
                const daysInProgress = Math.max(0, Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)));
                const overdue = t.dueDate && t.dueDate < today.toISOString().split("T")[0] && t.status !== "Completed" && t.status !== "Cancelled";
                const daysOverdue = overdue ? Math.floor((today.getTime() - new Date(t.dueDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;
                return (
                  <tr key={t.id} className={`border-b hover:bg-muted/10 cursor-pointer transition-colors ${overdue ? "border-l-4 border-l-red-500 bg-red-50/30" : ""}`} onClick={() => navigate(`/pd/tickets/${t.id}`)} data-testid={`pd-ticket-row-${t.id}`}>
                    <td className="p-2.5 pl-3 font-medium">{t.projectSiteName}</td>
                    <td className="p-2.5 text-muted-foreground">{row.clientName || "—"}</td>
                    <td className="p-2.5"><Badge variant="outline" className="text-[10px]">{t.requestType}</Badge></td>
                    <td className="p-2.5"><Badge className={`text-[10px] ${priorityColor(t.priority)}`}>{t.priority}</Badge></td>
                    <td className="p-2.5"><Badge className={`text-[10px] ${statusColor(t.status)}`}>{t.status}</Badge></td>
                    <td className={`p-2.5 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                      <div className="flex items-center gap-1.5">
                        <span>{t.dueDate || "—"}</span>
                        {overdue && <Badge variant="destructive" className="text-[9px] px-1 py-0" data-testid={`overdue-badge-${t.id}`}>{daysOverdue}d overdue</Badge>}
                      </div>
                    </td>
                    <td className="p-2.5 text-muted-foreground">{daysInProgress}d</td>
                    <td className="p-2.5 text-muted-foreground">{row.developerName || "—"}</td>
                    <td className="p-2.5">
                      {row.taskTotal > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${row.taskCompleted === row.taskTotal ? "bg-green-500" : row.taskCompleted > 0 ? "bg-blue-500" : "bg-gray-300"}`}
                              style={{ width: `${Math.round((row.taskCompleted / row.taskTotal) * 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{row.taskCompleted}/{row.taskTotal}</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2.5 text-muted-foreground">{row.designerName || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function statusColor(s: string) {
  if (s === "Completed") return "bg-green-100 text-green-700";
  if (s === "In Progress") return "bg-blue-100 text-blue-700";
  if (s === "On Hold") return "bg-orange-100 text-orange-700";
  if (s === "Cancelled") return "bg-muted text-muted-foreground";
  return "bg-muted text-foreground";
}

function priorityColor(p: string) {
  if (p === "Critical") return "bg-red-100 text-red-700";
  if (p === "High") return "bg-orange-100 text-orange-700";
  if (p === "Low") return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}

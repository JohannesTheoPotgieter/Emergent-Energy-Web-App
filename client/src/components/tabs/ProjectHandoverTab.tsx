/**
 * Project-level Handover tab — shows handover packs and SSEG items
 * scoped to the current project.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateProjectV2Queries } from "@/hooks/use-project-v2";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PageEmpty } from "@/components/ui/page-states";
import { Handshake, Plus, FileCheck, AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

interface Props { projectId: number; projectName: string; initialFilter?: "all" | "blocked"; }

interface HandoverPackRow { id: number; packType: string; checklistStatus: string; documentCompletenessPct: number; openSnagsCount: number; status: string; }
interface SsegItemRow { id: number; itemType: string; authority: string | null; status: string; expectedDate: string | null; }

const PACK_TYPES = [
  { value: "pd_to_pm", label: "PD to PM" },
  { value: "practical_completion", label: "Practical Completion" },
  { value: "client_handover", label: "Client Handover" },
  { value: "matriarch_handover", label: "Matriarch Handover" },
  { value: "sseg_closeout", label: "SSEG Closeout" },
];

function statusColor(s: string) {
  if (s === "accepted" || s === "complete") return "bg-green-50 text-green-700";
  if (s === "submitted") return "bg-blue-50 text-blue-700";
  if (s === "in_progress" || s === "draft") return "bg-amber-50 text-amber-700";
  if (s === "rejected") return "bg-red-50 text-red-700";
  return "bg-muted text-muted-foreground";
}

export function ProjectHandoverTab({ projectId, projectName: _projectName, initialFilter = "all" }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [packType, setPackType] = useState("client_handover");
  const [activeFilter, setActiveFilter] = useState<"all" | "blocked">(initialFilter);

  useEffect(() => {
    setActiveFilter(initialFilter);
  }, [initialFilter]);

  const { data: packs = [], isLoading: packsLoading } = useQuery<HandoverPackRow[]>({
    queryKey: ["/api/handover/packs", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/handover/packs?projectId=${projectId}`);
      return res.json();
    },
  });

  const { data: ssegItems = [] } = useQuery<SsegItemRow[]>({
    queryKey: ["/api/handover/sseg", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/handover/sseg?projectId=${projectId}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/handover/packs", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/handover/packs", projectId] });
      invalidateProjectV2Queries(queryClient, projectId);
      toast({ title: "Handover pack created" });
      setShowCreate(false);
    },
  });

  const filteredPacks = packs.filter((pack) => {
    if (activeFilter !== "blocked") return true;
    return pack.openSnagsCount > 0 || ["rejected", "in_progress"].includes(pack.status);
  });

  const filteredSsegItems = ssegItems.filter((item) => {
    if (activeFilter !== "blocked") return true;
    const isOpen = item.status !== "complete" && item.status !== "approved";
    return isOpen;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{filteredPacks.length} handover packs</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/handover"><Button size="sm" variant="ghost" className="gap-1 text-xs text-muted-foreground"><ExternalLink className="h-3 w-3" />Handover Dashboard</Button></Link>
          <Link href={`/pd/handover/${projectId}`}><Button size="sm" variant="ghost" className="gap-1 text-xs text-muted-foreground"><ExternalLink className="h-3 w-3" />PD→PM Handover</Button></Link>
          <Button size="sm" className="gap-1 text-xs" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3" /> New Pack
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button size="sm" variant={activeFilter === "all" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setActiveFilter("all")}>All</Button>
        <Button size="sm" variant={activeFilter === "blocked" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setActiveFilter("blocked")}>Blocked/Open</Button>
      </div>

      {/* Handover Packs */}
      {packsLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!packsLoading && packs.length === 0 && ssegItems.length === 0 && (
        <PageEmpty icon={FileCheck} title="No handover data" description="Create a handover pack to start tracking closeout for this project." />
      )}

      {filteredPacks.map(pack => (
        <Card key={pack.id}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-[10px]">
                {PACK_TYPES.find(t => t.value === pack.packType)?.label || pack.packType}
              </Badge>
              <Badge className={`text-[10px] ${statusColor(pack.status)}`}>{pack.status}</Badge>
              <span className="flex-1" />
              <span className="text-xs text-muted-foreground">{pack.documentCompletenessPct}% docs</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pack.documentCompletenessPct}%` }} />
            </div>
            {pack.openSnagsCount > 0 && (
              <p className="text-xs text-amber-600 mt-1.5"><AlertTriangle className="h-3 w-3 inline mr-0.5" />{pack.openSnagsCount} open snags</p>
            )}
          </CardContent>
        </Card>
      ))}

      {/* SSEG Items */}
      {filteredSsegItems.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">SSEG Items</h4>
          <div className="space-y-1.5">
            {filteredSsegItems.map(item => {
              const isOverdue = item.expectedDate && new Date(item.expectedDate) < new Date() && item.status !== "complete" && item.status !== "approved";
              return (
                <Card key={item.id} className={isOverdue ? "border-red-200" : ""}>
                  <CardContent className="p-2.5 flex items-center gap-2">
                    {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                    <span className="text-sm flex-1">{item.itemType.replace(/_/g, " ")}</span>
                    {item.authority && <span className="text-[10px] text-muted-foreground">{item.authority}</span>}
                    {item.expectedDate && (
                      <span className={`text-[10px] ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                        <Clock className="h-3 w-3 inline mr-0.5" />{item.expectedDate}
                      </span>
                    )}
                    <Badge className={`text-[10px] ${statusColor(item.status)}`}>{item.status}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>New Handover Pack</DialogTitle></DialogHeader>
          <div><Label className="text-xs">Pack Type</Label><SearchableSelect value={packType} onValueChange={setPackType} options={PACK_TYPES} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ projectId, packType })} disabled={createMutation.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

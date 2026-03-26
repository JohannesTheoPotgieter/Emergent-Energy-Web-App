import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Handshake, FileCheck, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface HandoverPackSummary {
  id: number;
  projectId: number;
  packType: string;
  checklistStatus: string;
  documentCompletenessPct: number;
  openSnagsCount: number;
  status: string;
  createdAt: string;
}

interface SsegItemSummary {
  id: number;
  projectId: number;
  itemType: string;
  authority: string | null;
  status: string;
  expectedDate: string | null;
}

const PACK_TYPE_LABELS: Record<string, string> = {
  pd_to_pm: "PD to PM",
  practical_completion: "Practical Completion",
  client_handover: "Client Handover",
  matriarch_handover: "Matriarch Handover",
  sseg_closeout: "SSEG Closeout",
};

function statusBadge(s: string) {
  if (s === "accepted" || s === "complete") return "bg-green-50 text-green-600";
  if (s === "submitted") return "bg-blue-50 text-blue-600";
  if (s === "in_progress" || s === "draft") return "bg-amber-50 text-amber-600";
  if (s === "rejected") return "bg-red-50 text-red-600";
  return "bg-muted text-muted-foreground";
}

export default function HandoverDashboardPage() {
  const [tab, setTab] = useState<"packs" | "sseg">("packs");

  const { data: packs = [], isLoading: packsLoading } = useQuery<HandoverPackSummary[]>({
    queryKey: ["/api/handover/packs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/handover/packs");
      return res.json();
    },
  });

  const { data: ssegItems = [], isLoading: ssegLoading } = useQuery<SsegItemSummary[]>({
    queryKey: ["/api/handover/sseg"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/handover/sseg");
      return res.json();
    },
  });

  const activePacks = packs.filter(p => p.status !== "accepted");
  const overdueSseg = ssegItems.filter(s => s.expectedDate && new Date(s.expectedDate) < new Date() && s.status !== "complete" && s.status !== "approved");
  const pendingSseg = ssegItems.filter(s => s.status === "pending" || s.status === "submitted");

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-handover-dashboard">
      <SectionHeader
        icon={<Handshake className="h-5 w-5" />}
        eyebrow="Projects"
        title="Handover & Closeout"
        description={`${activePacks.length} active handover packs, ${pendingSseg.length} SSEG items pending`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{activePacks.length}</div>
            <div className="text-xs text-muted-foreground">Active Packs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{packs.filter(p => p.status === "accepted").length}</div>
            <div className="text-xs text-muted-foreground">Accepted</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{pendingSseg.length}</div>
            <div className="text-xs text-muted-foreground">SSEG Pending</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-red-600">{overdueSseg.length}</div>
            <div className="text-xs text-muted-foreground">SSEG Overdue</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 w-fit">
        {([
          { key: "packs" as const, label: "Handover Packs" },
          { key: "sseg" as const, label: "SSEG Tracker" },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "packs" && (
        <div className="space-y-2">
          {packsLoading && <p className="text-sm text-muted-foreground">Loading handover packs...</p>}
          {!packsLoading && packs.length === 0 && (
            <Card><CardContent className="py-12 text-center">
              <FileCheck className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No handover packs created yet.</p>
            </CardContent></Card>
          )}
          {packs.map(pack => (
            <Card key={pack.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="outline" className="text-[10px]">{PACK_TYPE_LABELS[pack.packType] || pack.packType}</Badge>
                  <Badge className={`text-[10px] ${statusBadge(pack.status)}`}>{pack.status}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {pack.documentCompletenessPct}% docs complete
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Checklist: {pack.checklistStatus}</span>
                  {pack.openSnagsCount > 0 && (
                    <span className="text-amber-600">
                      <AlertTriangle className="h-3 w-3 inline mr-0.5" />
                      {pack.openSnagsCount} open snags
                    </span>
                  )}
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${pack.documentCompletenessPct}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "sseg" && (
        <div className="space-y-2">
          {ssegLoading && <p className="text-sm text-muted-foreground">Loading SSEG items...</p>}
          {!ssegLoading && ssegItems.length === 0 && (
            <Card><CardContent className="py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No SSEG items tracked yet.</p>
            </CardContent></Card>
          )}
          {ssegItems.map(item => {
            const isOverdue = item.expectedDate && new Date(item.expectedDate) < new Date() && item.status !== "complete" && item.status !== "approved";
            return (
              <Card key={item.id} className={`hover:shadow-sm transition-shadow ${isOverdue ? "border-red-200" : ""}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  {isOverdue ? (
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  ) : (
                    <FileCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium">{item.itemType.replace(/_/g, " ")}</span>
                  {item.authority && <span className="text-xs text-muted-foreground">{item.authority}</span>}
                  <span className="flex-1" />
                  {item.expectedDate && (
                    <span className={`text-xs ${isOverdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                      <Clock className="h-3 w-3 inline mr-0.5" />{item.expectedDate}
                    </span>
                  )}
                  <Badge className={`text-[10px] ${statusBadge(item.status)}`}>{item.status}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

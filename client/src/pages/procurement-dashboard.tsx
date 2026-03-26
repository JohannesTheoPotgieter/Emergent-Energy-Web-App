import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Package, Truck, Clock, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ProcurementSummary {
  id: number;
  title: string;
  status: string;
  requisitionStatus: string | null;
  deliveryStatus: string | null;
  deliveryExpectedDate: string | null;
  isLongLead: boolean;
  projectId: number;
  expectedCost: number | null;
  quoteAmount: string | null;
}

function deliveryBadge(s: string | null) {
  if (!s || s === "not_ordered") return "bg-muted text-muted-foreground";
  if (s === "ordered" || s === "shipped") return "bg-blue-50 text-blue-600";
  if (s === "delivered") return "bg-green-50 text-green-600";
  if (s === "partial") return "bg-amber-50 text-amber-600";
  return "bg-muted text-muted-foreground";
}

export default function ProcurementDashboardPage() {
  const [tab, setTab] = useState<"requisitions" | "delivery" | "long_lead">("requisitions");

  const { data: items = [], isLoading } = useQuery<ProcurementSummary[]>({
    queryKey: ["/api/procurement-items-all"],
    queryFn: async () => {
      // Use the existing procurement items endpoint
      const res = await apiRequest("GET", "/api/procurement-items");
      return res.json();
    },
  });

  const requisitions = items.filter(i => i.requisitionStatus && i.requisitionStatus !== "none" && i.requisitionStatus !== "po_issued");
  const deliveryTracking = items.filter(i => i.deliveryStatus === "ordered" || i.deliveryStatus === "shipped" || i.deliveryStatus === "partial");
  const longLead = items.filter(i => i.isLongLead);
  const lateDeliveries = items.filter(i =>
    i.deliveryExpectedDate && new Date(i.deliveryExpectedDate) < new Date() &&
    i.deliveryStatus !== "delivered" && i.deliveryStatus !== "not_ordered"
  );

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-procurement-dashboard">
      <SectionHeader
        icon={<Package className="h-5 w-5" />}
        eyebrow="Finance"
        title="Procurement"
        description={`${requisitions.length} pending requisitions, ${deliveryTracking.length} items in delivery`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{requisitions.length}</div>
            <div className="text-xs text-muted-foreground">Pending Requisitions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{deliveryTracking.length}</div>
            <div className="text-xs text-muted-foreground">In Delivery</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-red-600">{lateDeliveries.length}</div>
            <div className="text-xs text-muted-foreground">Late Deliveries</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-amber-600">{longLead.length}</div>
            <div className="text-xs text-muted-foreground">Long Lead Items</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 w-fit">
        {([
          { key: "requisitions" as const, label: "Requisitions" },
          { key: "delivery" as const, label: "Delivery Tracker" },
          { key: "long_lead" as const, label: "Long Lead" },
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

      {isLoading && <p className="text-sm text-muted-foreground">Loading procurement items...</p>}

      {!isLoading && tab === "requisitions" && (
        <div className="space-y-2">
          {requisitions.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Package className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No pending requisitions.</p>
            </CardContent></Card>
          ) : requisitions.map(item => (
            <Card key={item.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3 flex items-center gap-3">
                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">{item.title}</span>
                <Badge variant="secondary" className="text-[10px]">{item.requisitionStatus}</Badge>
                {item.quoteAmount && <span className="text-xs text-muted-foreground">R{Number(item.quoteAmount).toLocaleString()}</span>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && tab === "delivery" && (
        <div className="space-y-2">
          {deliveryTracking.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No items currently in delivery.</p>
            </CardContent></Card>
          ) : deliveryTracking.map(item => (
            <Card key={item.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3 flex items-center gap-3">
                <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.deliveryExpectedDate || "No date"}</span>
                <Badge className={`text-[10px] ${deliveryBadge(item.deliveryStatus)}`}>{item.deliveryStatus}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && tab === "long_lead" && (
        <div className="space-y-2">
          {longLead.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No items flagged as long lead.</p>
            </CardContent></Card>
          ) : longLead.map(item => (
            <Card key={item.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3 flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">{item.title}</span>
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">Long Lead</Badge>
                <Badge className={`text-[10px] ${deliveryBadge(item.deliveryStatus)}`}>{item.deliveryStatus || "not ordered"}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}

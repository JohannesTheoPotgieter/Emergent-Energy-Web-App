import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageEmpty } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { MapPin, Plus, Pencil, Search, Map, List } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

interface SiteRow {
  id: number;
  clientId: number | null;
  siteName: string;
  address: string | null;
  municipality: string | null;
  roofType: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  status: string;
}

interface ClientOption { id: number; name: string; }

const ROOF_TYPES = [
  { value: "flat_roof", label: "Flat Roof" },
  { value: "pitched_roof", label: "Pitched Roof" },
  { value: "ground_mount", label: "Ground Mount" },
  { value: "carport", label: "Carport" },
  { value: "other", label: "Other" },
];

const emptyForm = {
  siteName: "",
  address: "",
  municipality: "",
  roofType: "",
  clientId: "",
  gpsLat: "",
  gpsLng: "",
  siteConstraints: "",
  hseConstraints: "",
  accessRules: "",
};

// South Africa bounding box for coordinate mapping
const SA_BOUNDS = {
  latMin: -35.0, // southern tip
  latMax: -22.0, // northern border
  lngMin: 16.5,  // western coast
  lngMax: 33.0,  // eastern coast
};

function latLngToXY(lat: number, lng: number, width: number, height: number) {
  const x = ((lng - SA_BOUNDS.lngMin) / (SA_BOUNDS.lngMax - SA_BOUNDS.lngMin)) * width;
  const y = ((SA_BOUNDS.latMax - lat) / (SA_BOUNDS.latMax - SA_BOUNDS.latMin)) * height;
  return { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) };
}

// Simplified South Africa outline as SVG path (major coastal outline)
const SA_OUTLINE = "M 95 10 L 130 8 L 165 15 L 200 10 L 240 18 L 280 30 L 320 50 L 355 75 L 380 105 L 395 140 L 400 170 L 395 200 L 380 230 L 355 255 L 330 272 L 295 282 L 260 288 L 225 290 L 190 285 L 155 275 L 125 280 L 100 290 L 75 285 L 50 270 L 30 248 L 18 220 L 10 190 L 8 155 L 12 120 L 20 90 L 35 60 L 55 38 L 75 22 Z";

// Major city reference points
const SA_CITIES = [
  { name: "Johannesburg", lat: -26.2041, lng: 28.0473 },
  { name: "Cape Town", lat: -33.9249, lng: 18.4241 },
  { name: "Durban", lat: -29.8587, lng: 31.0218 },
  { name: "Pretoria", lat: -25.7479, lng: 28.2293 },
  { name: "Port Elizabeth", lat: -33.9608, lng: 25.6022 },
  { name: "Bloemfontein", lat: -29.0852, lng: 26.1596 },
];

function SouthAfricaMap({ sites, onSiteClick }: { sites: SiteRow[]; onSiteClick?: (site: SiteRow) => void }) {
  const mapWidth = 410;
  const mapHeight = 300;

  const sitesWithCoords = useMemo(() =>
    sites.filter(s => s.gpsLat && s.gpsLng).map(s => ({
      ...s,
      ...latLngToXY(Number(s.gpsLat), Number(s.gpsLng), mapWidth, mapHeight),
    })),
    [sites]
  );

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Map className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Site Locations — South Africa</span>
          <Badge variant="secondary" className="text-[10px] ml-auto">{sitesWithCoords.length} plotted</Badge>
        </div>
        <svg viewBox={`0 0 ${mapWidth} ${mapHeight}`} className="w-full h-auto border rounded-lg bg-blue-50/30 dark:bg-blue-950/10" style={{ maxHeight: 360 }}>
          {/* SA outline */}
          <path d={SA_OUTLINE} fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth="1.5" opacity="0.6" />

          {/* Reference cities */}
          {SA_CITIES.map(city => {
            const { x, y } = latLngToXY(city.lat, city.lng, mapWidth, mapHeight);
            return (
              <g key={city.name}>
                <circle cx={x} cy={y} r="2" fill="hsl(var(--muted-foreground))" opacity="0.4" />
                <text x={x + 4} y={y + 3} fontSize="7" fill="hsl(var(--muted-foreground))" opacity="0.5">{city.name}</text>
              </g>
            );
          })}

          {/* Site pins */}
          {sitesWithCoords.map(site => (
            <g
              key={site.id}
              className="cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onSiteClick?.(site); }}
            >
              <circle cx={site.x} cy={site.y} r="6" fill="hsl(var(--primary))" opacity="0.2" />
              <circle cx={site.x} cy={site.y} r="3.5" fill="hsl(var(--primary))" stroke="white" strokeWidth="1" />
              <title>{site.siteName}{site.address ? `\n${site.address}` : ""}</title>
            </g>
          ))}

          {/* Empty state */}
          {sitesWithCoords.length === 0 && (
            <text x={mapWidth / 2} y={mapHeight / 2} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
              No sites with GPS coordinates captured
            </text>
          )}
        </svg>
      </CardContent>
    </Card>
  );
}

export default function SitesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");

  const { data: sites = [], isLoading, isError, error, refetch } = useQuery<SiteRow[]>({
    queryKey: ["/api/sites"],
    queryFn: async () => { const res = await apiRequest("GET", "/api/sites"); return res.json(); },
  });

  const { data: clients = [] } = useQuery<ClientOption[]>({
    queryKey: ["/api/clients-list"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/clients");
      const data = await res.json();
      return (data || []).map((c: any) => ({ id: c.id, name: c.name }));
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/sites", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
      toast({ title: "Site created" });
      closeForm();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/sites/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
      toast({ title: "Site updated" });
      closeForm();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
  }

  function openEdit(site: SiteRow) {
    setForm({
      siteName: site.siteName,
      address: site.address || "",
      municipality: site.municipality || "",
      roofType: site.roofType || "",
      clientId: site.clientId ? String(site.clientId) : "",
      gpsLat: site.gpsLat || "",
      gpsLng: site.gpsLng || "",
      siteConstraints: "",
      hseConstraints: "",
      accessRules: "",
    });
    setEditId(site.id);
    setShowForm(true);
  }

  function handleSubmit() {
    if (!form.siteName.trim()) {
      toast({ title: "Site name required", variant: "destructive" });
      return;
    }
    const body: Record<string, unknown> = {
      siteName: form.siteName,
      address: form.address || null,
      municipality: form.municipality || null,
      roofType: form.roofType || null,
      clientId: form.clientId ? Number(form.clientId) : null,
      gpsLat: form.gpsLat ? form.gpsLat : null,
      gpsLng: form.gpsLng ? form.gpsLng : null,
      siteConstraints: form.siteConstraints || null,
      hseConstraints: form.hseConstraints || null,
      accessRules: form.accessRules || null,
    };
    if (editId) updateMutation.mutate({ id: editId, body });
    else createMutation.mutate(body);
  }

  const filtered = sites.filter(s =>
    !search || s.siteName.toLowerCase().includes(search.toLowerCase()) ||
    (s.address && s.address.toLowerCase().includes(search.toLowerCase()))
  );

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4 md:p-6" data-testid="page-sites"><SectionHeader icon={<MapPin className="h-5 w-5" />} eyebrow="Project Delivery" title="Sites" description="Physical locations" /><PageError title="Unable to load sites" message={error instanceof Error ? error.message : "Failed to fetch site data"} onRetry={() => refetch()} /></PageShell>;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-sites">
      <SectionHeader
        icon={<MapPin className="h-5 w-5" />}
        eyebrow="Project Delivery"
        title="Sites"
        description={`${sites.length} physical locations`}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> Add Site
          </Button>
        }
      />

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sites..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("map")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
              viewMode === "map" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Map className="h-3.5 w-3.5" /> Map
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
              viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
        </div>
      </div>

      {/* South Africa Map View */}
      {viewMode === "map" && (
        <SouthAfricaMap sites={filtered} onSiteClick={openEdit} />
      )}

      {/* Card Grid */}
      {filtered.length === 0 ? (
        <PageEmpty
          icon={MapPin}
          title="No sites yet"
          description="Sites represent physical locations where projects are delivered. Add a site to get started."
          actionLabel="Add Site"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(site => (
            <Card key={site.id} className="hover:shadow-sm transition-shadow cursor-pointer" onClick={() => openEdit(site)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm">{site.siteName}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{site.status}</Badge>
                </div>
                {site.address && <p className="text-xs text-muted-foreground mb-1">{site.address}</p>}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {site.municipality && <span>{site.municipality}</span>}
                  {site.roofType && <Badge variant="outline" className="text-[10px]">{site.roofType.replace(/_/g, " ")}</Badge>}
                  {site.gpsLat && site.gpsLng && (
                    <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">GPS</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) closeForm(); else setShowForm(true); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Site" : "Add Site"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Site Name *</Label>
              <Input value={form.siteName} onChange={(e) => setForm(f => ({ ...f, siteName: e.target.value }))} placeholder="e.g., Sandton Office Complex" />
            </div>
            <div>
              <Label className="text-xs">Client</Label>
              <SearchableSelect
                value={form.clientId || "__none__"}
                onValueChange={(v) => setForm(f => ({ ...f, clientId: v === "__none__" ? "" : v }))}
                options={[{ value: "__none__", label: "None" }, ...clients.map(c => ({ value: String(c.id), label: c.name }))]}
              />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Municipality</Label>
                <Input value={form.municipality} onChange={(e) => setForm(f => ({ ...f, municipality: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Roof Type</Label>
                <SearchableSelect
                  value={form.roofType || "__none__"}
                  onValueChange={(v) => setForm(f => ({ ...f, roofType: v === "__none__" ? "" : v }))}
                  options={[{ value: "__none__", label: "None" }, ...ROOF_TYPES]}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">GPS Latitude</Label>
                <Input value={form.gpsLat} onChange={(e) => setForm(f => ({ ...f, gpsLat: e.target.value }))} placeholder="-26.2041" type="number" step="any" />
              </div>
              <div>
                <Label className="text-xs">GPS Longitude</Label>
                <Input value={form.gpsLng} onChange={(e) => setForm(f => ({ ...f, gpsLng: e.target.value }))} placeholder="28.0473" type="number" step="any" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Site Constraints</Label>
              <Textarea value={form.siteConstraints} onChange={(e) => setForm(f => ({ ...f, siteConstraints: e.target.value }))} placeholder="Access limitations, structural concerns..." className="min-h-[60px]" />
            </div>
            <div>
              <Label className="text-xs">HSE Constraints</Label>
              <Textarea value={form.hseConstraints} onChange={(e) => setForm(f => ({ ...f, hseConstraints: e.target.value }))} placeholder="Safety requirements, hazards..." className="min-h-[60px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

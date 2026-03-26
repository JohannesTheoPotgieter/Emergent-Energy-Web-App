import { useState } from "react";
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
import { MapPin, Plus, Building2, Pencil, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface SiteRow {
  id: number;
  clientId: number | null;
  siteName: string;
  address: string | null;
  municipality: string | null;
  roofType: string | null;
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
  siteConstraints: "",
  hseConstraints: "",
  accessRules: "",
};

export default function SitesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: sites = [], isLoading } = useQuery<SiteRow[]>({
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

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-sites">
      <SectionHeader
        icon={<MapPin className="h-5 w-5" />}
        eyebrow="Projects"
        title="Sites"
        description={`${sites.length} physical locations`}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> Add Site
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search sites..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading sites...</p>}

      {!isLoading && filtered.length === 0 && (
        <PageEmpty
          icon={MapPin}
          title="No sites yet"
          description="Sites represent physical locations where projects are delivered. Add a site to get started."
          actionLabel="Add Site"
          onAction={() => setShowForm(true)}
        />
      )}

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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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

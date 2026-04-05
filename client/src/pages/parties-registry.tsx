/**
 * Parties Registry — Wave 1 (read) + Wave 2 (CRUD)
 *
 * Unified view of all business relationships (clients, suppliers, subcontractors, internal staff).
 * Reads from GET /api/parties, writes via POST/PATCH /api/parties.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/layout/page-shell";
import { useToast } from "@/hooks/use-toast";
import { Search, Building2, User, Users, ChevronRight, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Party {
  id: number;
  party_type: string;
  party_kind: string | null;
  name: string;
  legal_name: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  vat_number: string | null;
  is_active: boolean;
  legacy_client_id: number | null;
  legacy_counterparty_id: number | null;
  legacy_user_id: number | null;
  project_count: number;
}

interface PartiesResponse {
  parties: Party[];
  total: number;
  limit: number;
  offset: number;
}

const KIND_LABELS: Record<string, { label: string; color: string; icon: typeof Building2 }> = {
  organisation: { label: "Organisation", color: "bg-blue-100 text-blue-700", icon: Building2 },
  person: { label: "Person", color: "bg-violet-100 text-violet-700", icon: User },
};

function getKindDisplay(kind: string | null) {
  if (!kind) return { label: "Unknown", color: "bg-muted text-foreground", icon: Users };
  return KIND_LABELS[kind] || { label: kind, color: "bg-muted text-foreground", icon: Users };
}

function getDetailLink(party: Party): string | null {
  if (party.legacy_client_id) return `/clients/${encodeURIComponent(party.name)}`;
  if (party.legacy_counterparty_id) return `/counterparties`;
  return null;
}

export default function PartiesRegistryPage() {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [createOpen, setCreateOpen] = useState(false);
  const [newParty, setNewParty] = useState({ name: "", partyKind: "organisation", contactPerson: "", contactEmail: "", contactPhone: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: typeof newParty) => {
      const res = await apiRequest("POST", "/api/parties", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parties-registry"] });
      setCreateOpen(false);
      setNewParty({ name: "", partyKind: "organisation", contactPerson: "", contactEmail: "", contactPhone: "" });
      toast({ title: "Party created", description: "New party added to the registry." });
    },
    onError: () => {
      toast({ title: "Failed to create party", variant: "destructive" });
    },
  });

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (kindFilter !== "all") params.set("kind", kindFilter);
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    return params.toString();
  }, [search, kindFilter, page]);

  const { data, isLoading, isError } = useQuery<PartiesResponse>({
    queryKey: ["parties-registry", queryParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/parties?${queryParams}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <PageShell className="p-3 md:p-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Parties Registry
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {data ? `${data.total} total` : "Loading..."}
              </Badge>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Party
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mt-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-8"
              />
            </div>
            <Select value={kindFilter} onValueChange={(v) => { setKindFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All kinds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="organisation">Organisations</SelectItem>
                <SelectItem value="person">People</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {isError && (
            <div className="text-center py-8 text-muted-foreground">
              Failed to load parties. Please try again.
            </div>
          )}

          {data && data.parties.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No parties found matching your filters.
            </div>
          )}

          {data && data.parties.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Projects</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.parties.map((party) => {
                    const kindDisplay = getKindDisplay(party.party_kind);
                    const detailLink = getDetailLink(party);
                    const KindIcon = kindDisplay.icon;

                    return (
                      <TableRow key={party.id}>
                        <TableCell className="font-medium">
                          {detailLink ? (
                            <Link href={detailLink} className="hover:underline text-primary">
                              {party.name}
                            </Link>
                          ) : (
                            party.name
                          )}
                          {party.legal_name && party.legal_name !== party.name && (
                            <div className="text-xs text-muted-foreground">{party.legal_name}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${kindDisplay.color}`}>
                            <KindIcon className="h-3 w-3 mr-1" />
                            {kindDisplay.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {party.contact_person || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {party.contact_email || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {party.project_count > 0 ? (
                            <Badge variant="secondary" className="text-xs">
                              {party.project_count}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {detailLink && (
                            <Link href={detailLink}>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Party Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Party</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Name *</Label>
              <Input value={newParty.name} onChange={(e) => setNewParty((p) => ({ ...p, name: e.target.value }))} placeholder="Organisation or person name" />
            </div>
            <div>
              <Label>Kind</Label>
              <Select value={newParty.partyKind} onValueChange={(v) => setNewParty((p) => ({ ...p, partyKind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="organisation">Organisation</SelectItem>
                  <SelectItem value="person">Person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contact Person</Label>
              <Input value={newParty.contactPerson} onChange={(e) => setNewParty((p) => ({ ...p, contactPerson: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={newParty.contactEmail} onChange={(e) => setNewParty((p) => ({ ...p, contactEmail: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={newParty.contactPhone} onChange={(e) => setNewParty((p) => ({ ...p, contactPhone: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newParty)} disabled={!newParty.name || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

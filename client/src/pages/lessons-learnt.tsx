import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Plus, Search } from "lucide-react";

const PROJECT_TYPES = ["C&I", "Utility", "BESS", "Hybrid"];

interface LessonRow {
  id: number;
  title: string;
  description: string;
  tags: string[];
  projectType: string | null;
  technologyTags: string[];
  addedByName: string | null;
  createdAt: string;
}

export default function LessonsLearntPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState("");
  const [form, setForm] = useState({ title: "", description: "", projectType: "", tags: "", technologyTags: "" });

  const { data, isLoading } = useQuery<{ items: LessonRow[] }>({
    queryKey: ["lessons-learnt"],
    queryFn: async () => {
      const res = await fetch("/api/lessons-learnt", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load lessons");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.description.trim()) throw new Error("Title and description required.");
      const res = await fetch("/api/lessons-learnt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          projectType: form.projectType || null,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
          technologyTags: form.technologyTags ? form.technologyTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      });
      if (!res.ok) throw new Error("Could not create lesson.");
    },
    onSuccess: () => {
      toast({ title: "Lesson added" });
      setForm({ title: "", description: "", projectType: "", tags: "", technologyTags: "" });
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["lessons-learnt"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    let items = data?.items || [];
    if (filterType) items = items.filter((r) => r.projectType === filterType);
    if (searchText.trim()) {
      const lower = searchText.toLowerCase();
      items = items.filter((r) =>
        r.title.toLowerCase().includes(lower) ||
        r.description.toLowerCase().includes(lower) ||
        (r.tags || []).some((t: string) => t.toLowerCase().includes(lower)) ||
        (r.technologyTags || []).some((t: string) => t.toLowerCase().includes(lower))
      );
    }
    return items;
  }, [data, searchText, filterType]);

  return (
    <PageShell className="space-y-4 p-4 md:p-6" data-testid="lessons-learnt-page">
      <SectionHeader
        icon={<BookOpen className="h-5 w-5" />}
        title="Lessons Learnt Library"
        description="Capture and share project learnings across the organisation."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Lesson
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by title, description, or tags..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <Select value={filterType || "ALL"} onValueChange={(v) => setFilterType(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Project type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}

      {filtered.length === 0 && !isLoading ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No lessons found. Add the first lesson to get started.</CardContent></Card>
      ) : null}

      <div className="border rounded-xl overflow-auto">
        {filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3 whitespace-nowrap">Title</th>
                <th className="p-3 whitespace-nowrap">Project Type</th>
                <th className="p-3 whitespace-nowrap">Tags</th>
                <th className="p-3 whitespace-nowrap">Technology</th>
                <th className="p-3 whitespace-nowrap">Description</th>
                <th className="p-3 whitespace-nowrap">Added By</th>
                <th className="p-3 whitespace-nowrap">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3 font-medium max-w-[200px]">{row.title}</td>
                  <td className="p-3">{row.projectType || "—"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.tags || []).map((tag: string) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.technologyTags || []).map((tag: string) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}
                    </div>
                  </td>
                  <td className="p-3 max-w-[300px] truncate">{row.description}</td>
                  <td className="p-3">{row.addedByName || "—"}</td>
                  <td className="p-3 whitespace-nowrap">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add Lesson Learnt</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} /></div>
            <div>
              <Label>Project Type</Label>
              <Select value={form.projectType || "NONE"} onValueChange={(v) => setForm({ ...form, projectType: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— Select —</SelectItem>
                  {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Tags (comma separated)</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="e.g. Generator integration, Shopping centre" /></div>
            <div><Label>Technology Tags (comma separated)</Label><Input value={form.technologyTags} onChange={(e) => setForm({ ...form, technologyTags: e.target.value })} placeholder="e.g. Battery, Hybrid" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>{createMutation.isPending ? "Adding..." : "Add Lesson"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { type AssignableDirectoryEntry, fetchAssignables, getAssigneeBadgeLabel, getAuthHeaders as authHeaders } from "@/lib/assignables";
import {
  Upload, FileText, Package, DollarSign, ListChecks,
  ChevronRight, Check, ChevronsUpDown, Loader2,
  X, Paperclip, Download, ArrowLeft, Info, FolderOpen,
} from "lucide-react";

type LinkType = "work_item" | "cost_line" | "revenue_line" | null;
type Step = "project" | "link" | "upload";

interface CaptureDeliverableProps {
  projectId?: number;
  projectName?: string;
  preselectedLinkType?: LinkType;
  preselectedLinkId?: number;
  trigger?: React.ReactNode;
  onComplete?: () => void;
}

export default function CaptureDeliverable({
  projectId: propProjectId,
  projectName: propProjectName,
  preselectedLinkType,
  preselectedLinkId,
  trigger,
  onComplete,
}: CaptureDeliverableProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(propProjectId ? "link" : "project");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(propProjectId ?? null);
  const [selectedProjectName, setSelectedProjectName] = useState(propProjectName ?? "");
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [linkType, setLinkType] = useState<LinkType>(preselectedLinkType ?? null);
  const [linkId, setLinkId] = useState<number | null>(preselectedLinkId ?? null);
  const [linkLabel, setLinkLabel] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [deliverableType, setDeliverableType] = useState("project_document");
  const [ownerAssigneeType, setOwnerAssigneeType] = useState<"internal" | "external">("internal");
  const [ownerAssigneeValue, setOwnerAssigneeValue] = useState<string>("");
  const [itemSearch, setItemSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) {
      setStep(propProjectId ? "link" : "project");
      setSelectedProjectId(propProjectId ?? null);
      setSelectedProjectName(propProjectName ?? "");
      setLinkType(preselectedLinkType ?? null);
      setLinkId(preselectedLinkId ?? null);
      setLinkLabel("");
      setTitle("");
      setDescription("");
      setFile(null);
      setDeliverableType("project_document");
      setOwnerAssigneeType("internal");
      setOwnerAssigneeValue("");
      setItemSearch("");
    }
  }, [open]);

  const { data: projects = [] } = useQuery<{ id: number; projectName: string }[]>({
    queryKey: ["deliverable-capture-projects"],
    queryFn: async () => {
      const res = await fetch("/api/deliverable-capture/projects", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !propProjectId,
    staleTime: 60_000,
  });

  const { data: linkableItems, isLoading: loadingItems } = useQuery<{
    workItems: any[];
    costLines: any[];
    revenueLines: any[];
  }>({
    queryKey: ["deliverable-capture-linkable", selectedProjectId],
    queryFn: async () => {
      const res = await fetch(`/api/deliverable-capture/linkable-items/${selectedProjectId}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return { workItems: [], costLines: [], revenueLines: [] };
      return res.json();
    },
    enabled: open && !!selectedProjectId && step === "link",
    staleTime: 30_000,
  });

  const { data: assignables = [] } = useQuery<AssignableDirectoryEntry[]>({
    queryKey: ["deliverable-assignables"],
    queryFn: async () => fetchAssignables("deliverable"),
    enabled: open,
    staleTime: 60_000,
  });

  const { data: linkedFolder } = useQuery<{ folderName?: string; folderPath?: string } | null>({
    queryKey: ["user-project-folder", selectedProjectName],
    queryFn: async () => {
      const res = await fetch(`/api/user-project-folder/${encodeURIComponent(selectedProjectName)}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open && !!selectedProjectName && step === "upload",
    staleTime: 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("projectId", String(selectedProjectId));
      formData.append("projectName", selectedProjectName);
      formData.append("title", title);
      formData.append("deliverableType", deliverableType);
      if (ownerAssigneeValue) {
        const selectedAssignee = assignables.find((entry) => `${entry.assigneeType}:${entry.assigneeId}` === ownerAssigneeValue);
        if (selectedAssignee) {
          formData.append("ownerAssigneeType", selectedAssignee.assigneeType);
          formData.append("ownerAssigneeId", String(selectedAssignee.assigneeId));
        }
      }
      if (description) formData.append("description", description);
      if (linkType) formData.append("linkType", linkType);
      if (linkId) formData.append("linkId", String(linkId));
      if (file) formData.append("file", file);

      const res = await fetch("/api/deliverable-capture/upload", {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Deliverable captured", description: `${data.fileName || title} saved successfully` });
      qc.invalidateQueries({ queryKey: ["deliverable-capture-list"] });
      setOpen(false);
      onComplete?.();
    },
    onError: () => {
      toast({ title: "Upload failed", description: "Could not save the deliverable", variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!title) {
        const nameWithoutExt = f.name.replace(/\.[^/.]+$/, "");
        setTitle(nameWithoutExt);
      }
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ""));
    }
  }, [title]);

  const selectLink = (type: LinkType, id: number, label: string) => {
    setLinkType(type);
    setLinkId(id);
    setLinkLabel(label);
    if (type === "cost_line") setDeliverableType("invoice");
    else if (type === "revenue_line") setDeliverableType("invoice");
    else setDeliverableType("project_document");
    setStep("upload");
  };

  const skipLink = () => {
    setLinkType(null);
    setLinkId(null);
    setLinkLabel("");
    setStep("upload");
  };

  const formatAmount = (val: string | null | undefined) => {
    if (!val) return "";
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const filteredWorkItems = (linkableItems?.workItems || []).filter(
    (w: any) => !itemSearch || w.title?.toLowerCase().includes(itemSearch.toLowerCase())
  );
  const filteredCostLines = (linkableItems?.costLines || []).filter(
    (c: any) =>
      !itemSearch ||
      c.description?.toLowerCase().includes(itemSearch.toLowerCase()) ||
      c.counterpartyName?.toLowerCase().includes(itemSearch.toLowerCase()) ||
      c.costCategory?.toLowerCase().includes(itemSearch.toLowerCase())
  );
  const filteredRevenueLines = (linkableItems?.revenueLines || []).filter(
    (r: any) =>
      !itemSearch ||
      r.milestoneName?.toLowerCase().includes(itemSearch.toLowerCase()) ||
      r.description?.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const canSubmit = !!selectedProjectId && !!title && !!file;
  const ownerAssignableOptions = assignables
    .filter((entry) => ownerAssigneeType === "internal" ? entry.assigneeType === "internal_user" : entry.assigneeType !== "internal_user")
    .map((entry) => ({
      value: `${entry.assigneeType}:${entry.assigneeId}`,
      label: `${entry.displayLabel}${entry.secondaryLabel ? ` | ${entry.secondaryLabel}` : ""} | ${getAssigneeBadgeLabel(entry.assigneeType)}`,
    }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" data-testid="btn-capture-deliverable">
            <Upload className="h-4 w-4 mr-1.5" />
            Capture Deliverable
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto w-[95vw] sm:w-auto"
        data-testid="capture-deliverable-dialog"
        onEscapeKeyDown={() => setOpen(false)}
        onPointerDownOutside={() => setOpen(false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Capture Deliverable
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end -mt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} data-testid="btn-close-capture-deliverable">
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
          <span className={step === "project" ? "font-bold text-foreground" : selectedProjectId ? "text-emerald-600" : ""}>
            1. Project
          </span>
          <ChevronRight className="h-3 w-3" />
          <span className={step === "link" ? "font-bold text-foreground" : linkType ? "text-emerald-600" : ""}>
            2. Link To
          </span>
          <ChevronRight className="h-3 w-3" />
          <span className={step === "upload" ? "font-bold text-foreground" : ""}>
            3. Upload
          </span>
        </div>

        {step === "project" && (
          <div className="space-y-4" data-testid="step-project">
            <p className="text-sm text-muted-foreground">Select the project this deliverable belongs to.</p>
            <Popover open={projectSearchOpen} onOpenChange={setProjectSearchOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between" data-testid="btn-select-project">
                  {selectedProjectName || "Select a project..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search projects..." data-testid="input-project-search" />
                  <CommandList>
                    <CommandEmpty>No projects found.</CommandEmpty>
                    <CommandGroup>
                      {projects.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={p.projectName}
                          onSelect={() => {
                            setSelectedProjectId(p.id);
                            setSelectedProjectName(p.projectName);
                            setProjectSearchOpen(false);
                            setStep("link");
                          }}
                          data-testid={`project-option-${p.id}`}
                        >
                          <Check className={`mr-2 h-4 w-4 ${selectedProjectId === p.id ? "opacity-100" : "opacity-0"}`} />
                          {p.projectName}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {step === "link" && (
          <div className="space-y-4" data-testid="step-link">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Link to an item in {selectedProjectName}</p>
                <p className="text-xs text-muted-foreground">Browse tasks, cost lines, or revenue milestones to link this deliverable.</p>
              </div>
              {!propProjectId && (
                <Button variant="ghost" size="sm" onClick={() => setStep("project")} data-testid="btn-back-project">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
              )}
            </div>

            <Input
              placeholder="Search items..."
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              data-testid="input-link-search"
            />

            {loadingItems ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {filteredCostLines.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <DollarSign className="h-4 w-4 text-red-500" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cost Lines / Invoices ({filteredCostLines.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {filteredCostLines.map((c: any) => (
                        <button
                          key={`cost-${c.id}`}
                          className="w-full text-left p-2.5 rounded-md border hover:bg-muted/50 transition-colors"
                          onClick={() => selectLink("cost_line", c.id, c.description || c.counterpartyName || `Cost #${c.id}`)}
                          data-testid={`link-cost-${c.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {c.counterpartyName || c.description || `Cost Line #${c.id}`}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {c.costCategory}{c.poNumber ? ` | PO: ${c.poNumber}` : ""}
                                {c.invoiceNumber ? ` | Inv: ${c.invoiceNumber}` : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs font-medium">{formatAmount(c.amountExVat)}</span>
                              <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filteredRevenueLines.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <DollarSign className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Revenue Milestones ({filteredRevenueLines.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {filteredRevenueLines.map((r: any) => (
                        <button
                          key={`rev-${r.id}`}
                          className="w-full text-left p-2.5 rounded-md border hover:bg-muted/50 transition-colors"
                          onClick={() => selectLink("revenue_line", r.id, r.milestoneName || r.description || `Revenue #${r.id}`)}
                          data-testid={`link-revenue-${r.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {r.milestoneName || r.description || `Revenue Line #${r.id}`}
                              </div>
                              {r.invoiceNumber && (
                                <div className="text-xs text-muted-foreground">Inv: {r.invoiceNumber}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs font-medium">{formatAmount(r.amountExVat)}</span>
                              <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filteredWorkItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <ListChecks className="h-4 w-4 text-blue-500" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tasks & Work Items ({filteredWorkItems.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {filteredWorkItems.slice(0, 50).map((w: any) => (
                        <button
                          key={`wi-${w.id}`}
                          className="w-full text-left p-2.5 rounded-md border hover:bg-muted/50 transition-colors"
                          onClick={() => selectLink("work_item", w.id, w.title)}
                          data-testid={`link-workitem-${w.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{w.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {w.workstream}{w.phase ? ` / ${w.phase}` : ""}{w.wbsCode ? ` | WBS: ${w.wbsCode}` : ""}
                              </div>
                            </div>
                            <Badge variant="outline" className="text-[10px] shrink-0">{w.status}</Badge>
                          </div>
                        </button>
                      ))}
                      {filteredWorkItems.length > 50 && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          Showing 50 of {filteredWorkItems.length} - use search to narrow down
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {!filteredCostLines.length && !filteredRevenueLines.length && !filteredWorkItems.length && (
                  <p className="text-sm text-muted-foreground text-center py-6">No items found for this project.</p>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={skipLink} data-testid="btn-skip-link">
                Skip - Upload without linking
              </Button>
            </div>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-4" data-testid="step-upload">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Upload File</p>
                <p className="text-xs text-muted-foreground">
                  Project: <span className="font-medium text-foreground">{selectedProjectName}</span>
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStep("link")} data-testid="btn-back-link">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            </div>

            {linkType && (
              <Card className="border-dashed">
                <CardContent className="p-3 flex items-center gap-2">
                  {linkType === "cost_line" ? (
                    <DollarSign className="h-4 w-4 text-red-500 shrink-0" />
                  ) : linkType === "revenue_line" ? (
                    <DollarSign className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <ListChecks className="h-4 w-4 text-blue-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">
                      Linked to {linkType === "cost_line" ? "Cost Line" : linkType === "revenue_line" ? "Revenue Milestone" : "Work Item"}
                    </div>
                    <div className="text-sm font-medium truncate">{linkLabel}</div>
                  </div>
                  <Button variant="ghost" size="sm" className="ml-auto shrink-0 h-7 w-7 p-0" onClick={() => { setLinkType(null); setLinkId(null); setLinkLabel(""); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {(linkType === "cost_line" || linkType === "revenue_line") && (
              <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  The file name (without extension) will be saved as the invoice number on this financial line item.
                </p>
              </div>
            )}

            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${file ? "border-emerald-300 bg-emerald-50/50" : "border-muted-foreground/25 hover:border-muted-foreground/50"}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              data-testid="dropzone"
            >
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <Paperclip className="h-5 w-5 text-emerald-600" />
                  <div className="text-left">
                    <p className="text-sm font-medium truncate max-w-[300px]">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setFile(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Drag and drop a file here, or</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="btn-browse-file"
                  >
                    Browse Files
                  </Button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-file"
              />
            </div>

            <div>
              <Label className="text-xs mb-1.5 block">Document Type *</Label>
              <div className="flex flex-wrap gap-1.5" data-testid="deliverable-type-pills">
                {[
                  { value: "po", label: "PO" },
                  { value: "invoice", label: "Invoice" },
                  { value: "engineering_document", label: "Engineering Document" },
                  { value: "project_document", label: "Project Document" },
                ].map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setDeliverableType(t.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${deliverableType === t.value ? "bg-emerald-100 border-emerald-300 text-emerald-800 shadow-sm" : "bg-muted/50 border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    data-testid={`type-pill-${t.value}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Title *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Deliverable title or invoice reference"
                  data-testid="input-deliverable-title"
                />
              </div>
              <div>
                <Label className="text-xs">Assign To</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={ownerAssigneeType === "internal" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => {
                        setOwnerAssigneeType("internal");
                        setOwnerAssigneeValue("");
                      }}
                    >
                      Internal
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={ownerAssigneeType === "external" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => {
                        setOwnerAssigneeType("external");
                        setOwnerAssigneeValue("");
                      }}
                    >
                      External
                    </Button>
                  </div>
                  <SearchableSelect
                    value={ownerAssigneeValue}
                    onValueChange={setOwnerAssigneeValue}
                    placeholder={ownerAssigneeType === "internal" ? "Select internal owner..." : "Select counterparty or contact..."}
                    data-testid="select-owner-user"
                    options={ownerAssignableOptions}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes about this deliverable..."
                rows={2}
                data-testid="input-deliverable-description"
              />
            </div>

            {linkedFolder?.folderName && (
              <div className="flex items-center gap-2 p-2.5 bg-blue-50 rounded-lg border border-blue-100" data-testid="linked-folder-reference">
                <FolderOpen className="h-4 w-4 text-blue-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground">Linked Folder</p>
                  <p className="text-xs font-medium text-blue-700 truncate">{linkedFolder.folderName}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setOpen(false)} data-testid="btn-cancel-upload">Cancel</Button>
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={!canSubmit || uploadMutation.isPending}
                data-testid="btn-submit-deliverable"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-1.5" />
                )}
                Upload & Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

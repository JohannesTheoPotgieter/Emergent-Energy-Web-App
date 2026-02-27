import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  ArrowLeft, 
  Plus, 
  Edit2, 
  Save, 
  X, 
  FileText, 
  Users, 
  Wrench, 
  ClipboardList, 
  Layers, 
  Link as LinkIcon,
  ChevronRight,
  Info
} from "lucide-react";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { 
  Breadcrumb, 
  BreadcrumbItem, 
  BreadcrumbLink, 
  BreadcrumbList, 
  BreadcrumbPage, 
  BreadcrumbSeparator 
} from "@/components/ui/breadcrumb";
import AppLayout from "@/components/layout/AppLayout";

interface SOPData {
  purpose: string;
  triggers: string[];
  inputs: string[];
  outputs: string[];
  raci: { role: string; r: boolean; a: boolean; c: boolean; i: boolean }[];
  tools: string[];
  templates: string[];
  reviewCadence: string;
}

interface ProcessNode {
  id: string;
  slug: string;
  title: string;
  contentMarkdown: string | null;
  status: string;
  category: string;
  nodeType: string;
  departmentSlug: string | null;
  sopData: SOPData | null;
  sortOrder: number;
}

interface StepNode {
  id: string;
  title: string;
  contentMarkdown: string | null;
  sortOrder: number;
}

interface ProcessDetailResponse {
  process: ProcessNode;
  steps: StepNode[];
  department: { title: string; slug: string } | null;
  lifecycleStages: { title: string; slug: string }[];
  edges: any[];
  relatedProcesses: { title: string; slug: string; id: string }[];
}

export default function ProcessDetail() {
  const [, params] = useRoute("/ee-info/os/process/:slug");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editSop, setEditSop] = useState<SOPData | null>(null);

  const slug = params?.slug;

  const { data, isLoading, error } = useQuery<ProcessDetailResponse>({
    queryKey: [`/api/ee-info/os/processes/${slug}`],
    enabled: !!slug,
  });

  useEffect(() => {
    if (data?.process?.sopData) {
      setEditSop(data.process.sopData);
    }
  }, [data]);

  const isCOO = user?.role === "COO_ADMIN" || user?.role === "admin" || user?.role === "CEO_ADMIN";

  const createSopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ee-info/os/processes/${slug}/sop`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to create SOP");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ee-info/os/processes/${slug}`] });
      toast({ title: "SOP Shell Created", description: "You can now fill in the details." });
    },
  });

  const updateNodeMutation = useMutation({
    mutationFn: async (updates: Partial<ProcessNode>) => {
      const res = await fetch(`/api/ee-info/os/nodes/${data?.process.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update node");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ee-info/os/processes/${slug}`] });
      setIsEditing(false);
      toast({ title: "Process Updated", description: "Standard Operating Procedure has been saved." });
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="p-8 text-center">
          <h2 className="text-2xl font-bold">Process not found</h2>
          <Button onClick={() => setLocation("/ee-info")} className="mt-4">
            Back to OS Map
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { process, steps, department, relatedProcesses } = data;

  const handleSave = () => {
    if (!editSop) return;
    updateNodeMutation.mutate({ sopData: editSop });
  };

  const renderMarkdown = (content: string | null) => {
    if (!content) return null;
    // Simple markdown header splitting as requested
    const sections = content.split(/(?=^##\s)/m);
    return sections.map((section, idx) => {
      const lines = section.trim().split('\n');
      const titleLine = lines[0].startsWith('##') ? lines[0].replace('##', '').trim() : null;
      const body = titleLine ? lines.slice(1).join('\n') : section;
      
      return (
        <div key={idx} className="mb-6">
          {titleLine && <h3 className="text-xl font-semibold mb-3">{titleLine}</h3>}
          <div className="whitespace-pre-wrap text-muted-foreground leading-relaxed">
            {body.trim()}
          </div>
        </div>
      );
    });
  };

  const statusColors: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800 border-yellow-200",
    published: "bg-green-100 text-green-800 border-green-200",
    stub: "bg-gray-100 text-gray-800 border-gray-200"
  };

  return (
    <AppLayout>
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        {/* Breadcrumbs */}
        <Breadcrumb className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/ee-info" data-testid="breadcrumb-os-map">OS Map</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            {department && (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink href={`/ee-info/os/department/${department.slug}`} data-testid={`breadcrumb-dept-${department.slug}`}>
                    {department.title}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            )}
            <BreadcrumbItem>
              <BreadcrumbPage data-testid="breadcrumb-process-name">{process.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold tracking-tight" data-testid="text-process-title">{process.title}</h1>
              <Badge 
                variant="outline" 
                className={statusColors[process.status] || ""}
                data-testid={`badge-status-${process.status}`}
              >
                {process.status.toUpperCase()}
              </Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Standard Operating Procedure
            </p>
          </div>

          <div className="flex gap-2">
            {isCOO && (
              <>
                {!isEditing ? (
                  <Button 
                    onClick={() => setIsEditing(true)} 
                    variant="outline" 
                    className="flex items-center gap-2"
                    data-testid="button-edit-sop"
                  >
                    <Edit2 className="h-4 w-4" />
                    Edit SOP
                  </Button>
                ) : (
                  <>
                    <Button 
                      onClick={() => setIsEditing(false)} 
                      variant="ghost"
                      data-testid="button-cancel-edit"
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleSave} 
                      className="flex items-center gap-2"
                      disabled={updateNodeMutation.isPending}
                      data-testid="button-save-sop"
                    >
                      {updateNodeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save Changes
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {!process.sopData && !isEditing ? (
          <Card className="mb-8 border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <ClipboardList className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
              <h3 className="text-lg font-medium mb-2">No SOP Data Yet</h3>
              <p className="text-muted-foreground mb-6 text-center max-w-md">
                This process exists in the OS map but does not have a formal Standard Operating Procedure shell yet.
              </p>
              {isCOO && (
                <Button 
                  onClick={() => createSopMutation.mutate()} 
                  disabled={createSopMutation.isPending}
                  data-testid="button-create-sop-shell"
                >
                  {createSopMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  Create SOP Shell
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-8">
            {/* SOP Header Sections */}
            <Card data-testid="card-sop-details">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  SOP Fundamentals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <Info className="h-4 w-4 text-primary" />
                      Purpose
                    </label>
                    {isEditing ? (
                      <Textarea 
                        value={editSop?.purpose || ""} 
                        onChange={(e) => setEditSop(prev => prev ? { ...prev, purpose: e.target.value } : null)}
                        placeholder="Define the primary objective of this process..."
                        data-testid="input-sop-purpose"
                        rows={3}
                      />
                    ) : (
                      <p className="text-muted-foreground bg-muted/50 p-3 rounded-md min-h-[60px]" data-testid="text-sop-purpose">
                        {process.sopData?.purpose || "No purpose defined."}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <ChevronRight className="h-4 w-4 text-primary" />
                      Review Cadence
                    </label>
                    {isEditing ? (
                      <Input 
                        value={editSop?.reviewCadence || ""} 
                        onChange={(e) => setEditSop(prev => prev ? { ...prev, reviewCadence: e.target.value } : null)}
                        placeholder="e.g. Quarterly, Annually..."
                        data-testid="input-sop-cadence"
                      />
                    ) : (
                      <p className="text-muted-foreground bg-muted/50 p-3 rounded-md" data-testid="text-sop-cadence">
                        {process.sopData?.reviewCadence || "Not specified."}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Triggers</label>
                    {isEditing ? (
                      <Textarea 
                        value={editSop?.triggers.join("\n") || ""} 
                        onChange={(e) => setEditSop(prev => prev ? { ...prev, triggers: e.target.value.split("\n") } : null)}
                        placeholder="What starts this process? (one per line)"
                        data-testid="input-sop-triggers"
                        rows={3}
                      />
                    ) : (
                      <ul className="list-disc list-inside text-muted-foreground space-y-1" data-testid="list-sop-triggers">
                        {process.sopData?.triggers.length ? process.sopData.triggers.map((t, i) => <li key={i}>{t}</li>) : <li>No triggers defined.</li>}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Inputs</label>
                    {isEditing ? (
                      <Textarea 
                        value={editSop?.inputs.join("\n") || ""} 
                        onChange={(e) => setEditSop(prev => prev ? { ...prev, inputs: e.target.value.split("\n") } : null)}
                        placeholder="Required resources... (one per line)"
                        data-testid="input-sop-inputs"
                        rows={3}
                      />
                    ) : (
                      <ul className="list-disc list-inside text-muted-foreground space-y-1" data-testid="list-sop-inputs">
                        {process.sopData?.inputs.length ? process.sopData.inputs.map((t, i) => <li key={i}>{t}</li>) : <li>No inputs defined.</li>}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Outputs</label>
                    {isEditing ? (
                      <Textarea 
                        value={editSop?.outputs.join("\n") || ""} 
                        onChange={(e) => setEditSop(prev => prev ? { ...prev, outputs: e.target.value.split("\n") } : null)}
                        placeholder="Deliverables... (one per line)"
                        data-testid="input-sop-outputs"
                        rows={3}
                      />
                    ) : (
                      <ul className="list-disc list-inside text-muted-foreground space-y-1" data-testid="list-sop-outputs">
                        {process.sopData?.outputs.length ? process.sopData.outputs.map((t, i) => <li key={i}>{t}</li>) : <li>No outputs defined.</li>}
                      </ul>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* RACI Table */}
            <Card data-testid="card-sop-raci">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  RACI Matrix
                </CardTitle>
                <CardDescription>Responsible, Accountable, Consulted, Informed</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-center">R</TableHead>
                      <TableHead className="text-center">A</TableHead>
                      <TableHead className="text-center">C</TableHead>
                      <TableHead className="text-center">I</TableHead>
                      {isEditing && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(isEditing ? editSop?.raci : process.sopData?.raci)?.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          {isEditing ? (
                            <Input 
                              value={row.role} 
                              onChange={(e) => {
                                const newRaci = [...(editSop?.raci || [])];
                                newRaci[idx].role = e.target.value;
                                setEditSop(prev => prev ? { ...prev, raci: newRaci } : null);
                              }}
                              placeholder="Role name"
                            />
                          ) : row.role}
                        </TableCell>
                        <TableCell className="text-center">
                          {isEditing ? (
                            <input 
                              type="checkbox" 
                              checked={row.r} 
                              onChange={(e) => {
                                const newRaci = [...(editSop?.raci || [])];
                                newRaci[idx].r = e.target.checked;
                                setEditSop(prev => prev ? { ...prev, raci: newRaci } : null);
                              }}
                              className="h-4 w-4"
                            />
                          ) : row.r && <Badge variant="secondary">R</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                           {isEditing ? (
                            <input 
                              type="checkbox" 
                              checked={row.a} 
                              onChange={(e) => {
                                const newRaci = [...(editSop?.raci || [])];
                                newRaci[idx].a = e.target.checked;
                                setEditSop(prev => prev ? { ...prev, raci: newRaci } : null);
                              }}
                              className="h-4 w-4"
                            />
                          ) : row.a && <Badge className="bg-primary text-primary-foreground">A</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                           {isEditing ? (
                            <input 
                              type="checkbox" 
                              checked={row.c} 
                              onChange={(e) => {
                                const newRaci = [...(editSop?.raci || [])];
                                newRaci[idx].c = e.target.checked;
                                setEditSop(prev => prev ? { ...prev, raci: newRaci } : null);
                              }}
                              className="h-4 w-4"
                            />
                          ) : row.c && <span className="font-bold text-muted-foreground">C</span>}
                        </TableCell>
                        <TableCell className="text-center">
                           {isEditing ? (
                            <input 
                              type="checkbox" 
                              checked={row.i} 
                              onChange={(e) => {
                                const newRaci = [...(editSop?.raci || [])];
                                newRaci[idx].i = e.target.checked;
                                setEditSop(prev => prev ? { ...prev, raci: newRaci } : null);
                              }}
                              className="h-4 w-4"
                            />
                          ) : row.i && <span className="font-bold text-muted-foreground">I</span>}
                        </TableCell>
                        {isEditing && (
                          <TableCell>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => {
                                const newRaci = (editSop?.raci || []).filter((_, i) => i !== idx);
                                setEditSop(prev => prev ? { ...prev, raci: newRaci } : null);
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {isEditing && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-4" 
                    onClick={() => {
                      const newRaci = [...(editSop?.raci || []), { role: "", r: false, a: false, c: false, i: false }];
                      setEditSop(prev => prev ? { ...prev, raci: newRaci } : null);
                    }}
                    data-testid="button-add-raci-row"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Role
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Tools & Templates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card data-testid="card-sop-tools">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-primary" />
                    Tools Used
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing ? (
                    <Textarea 
                      value={editSop?.tools.join("\n") || ""} 
                      onChange={(e) => setEditSop(prev => prev ? { ...prev, tools: e.target.value.split("\n") } : null)}
                      placeholder="Tools used... (one per line)"
                      data-testid="input-sop-tools"
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {process.sopData?.tools.length ? process.sopData.tools.map((tool, i) => (
                        <Badge key={i} variant="secondary" className="px-3 py-1" data-testid={`badge-tool-${i}`}>
                          {tool}
                        </Badge>
                      )) : <p className="text-muted-foreground">No tools listed.</p>}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-sop-templates">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    Templates & Artifacts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing ? (
                    <Textarea 
                      value={editSop?.templates.join("\n") || ""} 
                      onChange={(e) => setEditSop(prev => prev ? { ...prev, templates: e.target.value.split("\n") } : null)}
                      placeholder="Templates required... (one per line)"
                      data-testid="input-sop-templates"
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {process.sopData?.templates.length ? process.sopData.templates.map((template, i) => (
                        <Badge key={i} variant="outline" className="px-3 py-1 flex items-center gap-1" data-testid={`badge-template-${i}`}>
                          <LinkIcon className="h-3 w-3" />
                          {template}
                        </Badge>
                      )) : <p className="text-muted-foreground">No templates listed.</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Steps Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Process Steps</h2>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {steps.length > 0 ? steps.map((step, index) => (
                  <Card key={step.id} className="relative overflow-hidden" data-testid={`card-step-${index}`}>
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                          {index + 1}
                        </div>
                        <CardTitle className="text-lg">{step.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-muted-foreground">
                        {step.contentMarkdown ? step.contentMarkdown : "No description provided for this step."}
                      </div>
                    </CardContent>
                  </Card>
                )) : (
                  <div className="text-center py-8 border rounded-lg bg-muted/20">
                    <p className="text-muted-foreground">No granular steps documented for this process.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Related Processes */}
            {relatedProcesses.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">Related Processes</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {relatedProcesses.map((related) => (
                    <Button 
                      key={related.id} 
                      variant="outline" 
                      className="justify-start h-auto py-4 px-6"
                      onClick={() => setLocation(`/ee-info/os/process/${related.slug}`)}
                      data-testid={`button-related-process-${related.slug}`}
                    >
                      <div className="flex flex-col items-start gap-1 text-left">
                        <span className="font-semibold">{related.title}</span>
                        <span className="text-xs text-muted-foreground">View connected process SOP</span>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Markdown Content Section */}
            {process.contentMarkdown && (
              <div className="mt-8 border-t pt-8">
                <h2 className="text-2xl font-bold mb-6">Detailed Content</h2>
                <div className="prose prose-slate max-w-none dark:prose-invert" data-testid="text-process-markdown">
                  {renderMarkdown(process.contentMarkdown)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

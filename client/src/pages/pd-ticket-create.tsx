import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { PD_REQUEST_TYPE_TASK_TEMPLATES } from "@shared/schema";
import {
  Loader2, Plus, ArrowLeft, Search, CheckCircle2, Building2, FolderKanban, FileEdit,
  ChevronRight, MapPin, Zap, Battery, HardHat, CalendarIcon, ListTodo,
} from "lucide-react";

function pdFetch(url: string, opts?: RequestInit) {
  return fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  }).then(async r => {
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || "Request failed");
    }
    return r.json();
  });
}

const REQUEST_TYPES = ["Cost Proposal", "IFC Planning", "Site Assessment", "Feasibility Study", "Grid Application", "Design Review", "Battery Assessment", "Full EPC"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const FUNDING_TYPES = ["PPA", "Cash", "Lease", "Hybrid", "Other"];
const PROVINCES = ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "Northern Cape", "North West", "Western Cape"];


export default function PdTicketCreatePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);

  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [newClientName, setNewClientName] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);

  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [createNewProject, setCreateNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  const [form, setForm] = useState({
    projectSiteName: "",
    requestType: "",
    priority: "Medium",
    dueDate: "",
    fundingType: "",
    sizeKwp: "",
    province: "",
    gpsCoordinates: "",
    billsOrTariffData: false,
    meteringDataAvailable: false,
    siteInspectionForm: false,
    siteInspectionLink: "",
    workingSchedule: "",
    batteriesNeeded: false,
    batterySize: "",
    dieselGenIntegration: false,
    roofReplacementNeeded: false,
    hseDiscussed: false,
    comments: "",
    designerUserId: "",
  });

  const { data: clientResults = [] } = useQuery<any[]>({
    queryKey: ["/api/pd/clients", clientSearch],
    queryFn: () => pdFetch(`/api/pd/clients?search=${encodeURIComponent(clientSearch)}`),
    enabled: step === 1,
  });

  const { data: projectResults = [] } = useQuery<any[]>({
    queryKey: ["/api/pd/projects/search", projectSearch],
    queryFn: () => pdFetch(`/api/pd/projects/search?search=${encodeURIComponent(projectSearch)}`),
    enabled: step === 2,
  });

  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/pd/users"],
    queryFn: () => pdFetch("/api/pd/users"),
  });

  const designers = useMemo(() => allUsers.filter((u: any) => u.role === "ENGINEER" || u.role === "PROJECT_DEVELOPER"), [allUsers]);

  const availableTaskTemplates = useMemo(() => PD_REQUEST_TYPE_TASK_TEMPLATES[form.requestType] || [], [form.requestType]);

  const createClientMutation = useMutation({
    mutationFn: (name: string) => pdFetch("/api/pd/clients", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (data) => {
      setSelectedClient(data);
      setCreatingClient(false);
      setNewClientName("");
      queryClient.invalidateQueries({ queryKey: ["/api/pd/clients"] });
      toast({ title: "Client created", description: `Client ID: ${data.clientId}` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createTicketMutation = useMutation({
    mutationFn: (body: any) => pdFetch("/api/pd/tickets", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pd/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pd/dashboard"] });
      toast({ title: "PD Ticket created", description: `Ticket #${data.id} created successfully` });
      navigate(`/pd/tickets/${data.id}`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createProjectMutation = useMutation({
    mutationFn: (name: string) => pdFetch("/api/projects", { method: "POST", body: JSON.stringify({ projectName: name, clientName: selectedClient?.name || "" }) }),
    onSuccess: (data) => {
      setSelectedProject({ id: data.id, projectName: data.projectName });
      setCreateNewProject(false);
      setNewProjectName("");
      queryClient.invalidateQueries({ queryKey: ["/api/pd/projects/search"] });
      toast({ title: "Project created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!form.projectSiteName.trim()) {
      toast({ title: "Project/Site Name required", variant: "destructive" });
      return;
    }
    if (!form.requestType) {
      toast({ title: "Request Type required", variant: "destructive" });
      return;
    }

    const body: any = {
      ...form,
      clientId: selectedClient?.id || null,
      clientNameSnapshot: selectedClient?.name || null,
      projectId: selectedProject?.id || null,
      sizeKwp: form.sizeKwp ? parseFloat(form.sizeKwp) : null,
      batterySize: form.batterySize ? parseFloat(form.batterySize) : null,
      designerUserId: form.designerUserId ? parseInt(form.designerUserId) : null,
      selectedTasks: Array.from(selectedTasks),
    };

    createTicketMutation.mutate(body);
  };

  const filteredClients = clientSearch.trim()
    ? clientResults
    : clientResults;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pd/tickets")} data-testid="btn-back-to-tickets">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2" data-testid="pd-create-title">
          <FileEdit className="h-5 w-5 text-violet-600" />
          Create PD Ticket
        </h1>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= s ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground"}`}>
              {step > s ? <CheckCircle2 className="h-4 w-4" /> : s}
            </div>
            <span className={`text-xs font-medium ${step >= s ? "text-foreground" : "text-muted-foreground"}`}>
              {s === 1 ? "Client" : s === 2 ? "Project" : "Details"}
            </span>
            {s < 3 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Select or Create Client
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedClient ? (
              <div className="flex items-center justify-between p-3 border rounded-lg bg-green-50 dark:bg-green-950/20">
                <div>
                  <p className="font-medium">{selectedClient.name}</p>
                  <p className="text-xs text-muted-foreground">Client ID: {selectedClient.clientId}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelectedClient(null)} data-testid="btn-change-client">Change</Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search existing clients..."
                    className="pl-9"
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setCreatingClient(false); }}
                    data-testid="input-client-search"
                  />
                </div>
                {filteredClients.length > 0 && (
                  <div className="border rounded-lg max-h-48 overflow-y-auto">
                    {filteredClients.map((c: any) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 flex items-center justify-between"
                        onClick={() => setSelectedClient(c)}
                        data-testid={`select-client-${c.id}`}
                      >
                        <span className="font-medium text-sm">{c.name}</span>
                        <Badge variant="outline" className="text-[10px]">{c.clientId}</Badge>
                      </button>
                    ))}
                  </div>
                )}

                <Separator />
                {!creatingClient ? (
                  <Button variant="outline" className="w-full gap-1.5" onClick={() => setCreatingClient(true)} data-testid="btn-new-client">
                    <Plus className="h-4 w-4" /> Create New Client
                  </Button>
                ) : (
                  <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
                    <Label className="text-xs">New Client Name</Label>
                    <Input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Enter client name" data-testid="input-new-client-name" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!newClientName.trim() || createClientMutation.isPending} onClick={() => createClientMutation.mutate(newClientName.trim())} data-testid="btn-save-new-client">
                        {createClientMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create Client"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setCreatingClient(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => setStep(2)} disabled={!selectedClient} data-testid="btn-step1-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FolderKanban className="h-4 w-4" /> Map to Project
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedProject ? (
              <div className="flex items-center justify-between p-3 border rounded-lg bg-green-50 dark:bg-green-950/20">
                <div>
                  <p className="font-medium">{selectedProject.projectName}</p>
                  {selectedProject.phase && <p className="text-xs text-muted-foreground">Phase: {selectedProject.phase}</p>}
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelectedProject(null)} data-testid="btn-change-project">Change</Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search existing projects..."
                    className="pl-9"
                    value={projectSearch}
                    onChange={e => { setProjectSearch(e.target.value); setCreateNewProject(false); }}
                    data-testid="input-project-search"
                  />
                </div>
                {projectResults.length > 0 && (
                  <div className="border rounded-lg max-h-48 overflow-y-auto">
                    {projectResults.map((p: any) => (
                      <button
                        key={p.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 flex items-center justify-between"
                        onClick={() => setSelectedProject(p)}
                        data-testid={`select-project-${p.id}`}
                      >
                        <span className="font-medium text-sm">{p.projectName}</span>
                        {p.phase && <Badge variant="outline" className="text-[10px]">{p.phase}</Badge>}
                      </button>
                    ))}
                  </div>
                )}

                <Separator />
                {!createNewProject ? (
                  <Button variant="outline" className="w-full gap-1.5" onClick={() => { setCreateNewProject(true); setNewProjectName(form.projectSiteName || ""); }} data-testid="btn-new-project">
                    <Plus className="h-4 w-4" /> Create New Project
                  </Button>
                ) : (
                  <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
                    <Label className="text-xs">New Project Name</Label>
                    <Input value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="Enter project name" data-testid="input-new-project-name" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!newProjectName.trim() || createProjectMutation.isPending} onClick={() => createProjectMutation.mutate(newProjectName.trim())} data-testid="btn-save-new-project">
                        {createProjectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create Project"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setCreateNewProject(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">You can also skip project mapping and save without linking to a project.</p>
              </>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)} data-testid="btn-step2-back">Back</Button>
              <Button onClick={() => setStep(3)} data-testid="btn-step2-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileEdit className="h-4 w-4" /> Ticket Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedClient && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Building2 className="h-3 w-3" /> Client: <strong>{selectedClient.name}</strong> ({selectedClient.clientId})
                {selectedProject && <><span className="mx-1">·</span><FolderKanban className="h-3 w-3" /> Project: <strong>{selectedProject.projectName}</strong></>}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Project / Site Name *</Label>
                <Input value={form.projectSiteName} onChange={e => setForm(p => ({ ...p, projectSiteName: e.target.value }))} placeholder="e.g. Sandton Office Park" data-testid="input-site-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Request Type *</Label>
                <Select value={form.requestType} onValueChange={v => { setForm(p => ({ ...p, requestType: v })); const templates = PD_REQUEST_TYPE_TASK_TEMPLATES[v] || []; setSelectedTasks(new Set(templates.map(t => t.title))); }}>
                  <SelectTrigger data-testid="select-request-type"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {REQUEST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger data-testid="select-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} data-testid="input-due-date" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Funding Type</Label>
                <Select value={form.fundingType} onValueChange={v => setForm(p => ({ ...p, fundingType: v }))}>
                  <SelectTrigger data-testid="select-funding-type"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {FUNDING_TYPES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Size (kWp)</Label>
                <Input type="number" value={form.sizeKwp} onChange={e => setForm(p => ({ ...p, sizeKwp: e.target.value }))} placeholder="e.g. 500" data-testid="input-size-kwp" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Province</Label>
                <Select value={form.province} onValueChange={v => setForm(p => ({ ...p, province: v }))}>
                  <SelectTrigger data-testid="select-province"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {PROVINCES.map(pr => <SelectItem key={pr} value={pr}>{pr}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">GPS Coordinates</Label>
                <Input value={form.gpsCoordinates} onChange={e => setForm(p => ({ ...p, gpsCoordinates: e.target.value }))} placeholder="-26.2041, 28.0473" data-testid="input-gps" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Designer</Label>
                <Select value={form.designerUserId} onValueChange={v => setForm(p => ({ ...p, designerUserId: v }))}>
                  <SelectTrigger data-testid="select-designer"><SelectValue placeholder="Select designer..." /></SelectTrigger>
                  <SelectContent>
                    {designers.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Working Schedule</Label>
                <Input value={form.workingSchedule} onChange={e => setForm(p => ({ ...p, workingSchedule: e.target.value }))} placeholder="e.g. 8am-5pm weekdays" data-testid="input-working-schedule" />
              </div>
            </div>

            <Separator />
            <p className="text-xs font-medium text-muted-foreground">Site Details</p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { key: "billsOrTariffData", label: "Bills / Tariff Data?" },
                { key: "meteringDataAvailable", label: "Metering Data Available?" },
                { key: "siteInspectionForm", label: "Site Inspection Form?" },
                { key: "batteriesNeeded", label: "Batteries Needed?" },
                { key: "dieselGenIntegration", label: "Diesel Gen / Integration?" },
                { key: "roofReplacementNeeded", label: "Roof Replacement Needed?" },
                { key: "hseDiscussed", label: "HSE Discussed?" },
              ].map(item => (
                <div key={item.key} className="flex items-center gap-2 py-1">
                  <Switch
                    checked={(form as any)[item.key]}
                    onCheckedChange={v => setForm(p => ({ ...p, [item.key]: v }))}
                    data-testid={`switch-${item.key}`}
                  />
                  <span className="text-xs">{item.label}</span>
                </div>
              ))}
            </div>

            {form.batteriesNeeded && (
              <div className="space-y-1.5 max-w-xs">
                <Label className="text-xs">Battery Size (kWh)</Label>
                <Input type="number" value={form.batterySize} onChange={e => setForm(p => ({ ...p, batterySize: e.target.value }))} placeholder="e.g. 200" data-testid="input-battery-size" />
              </div>
            )}

            {form.siteInspectionForm && (
              <div className="space-y-1.5 max-w-md">
                <Label className="text-xs">Site Inspection Link</Label>
                <Input value={form.siteInspectionLink} onChange={e => setForm(p => ({ ...p, siteInspectionLink: e.target.value }))} placeholder="https://..." data-testid="input-inspection-link" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Comments</Label>
              <Textarea value={form.comments} onChange={e => setForm(p => ({ ...p, comments: e.target.value }))} placeholder="Additional notes..." className="min-h-[80px]" data-testid="input-comments" />
            </div>

            {availableTaskTemplates.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ListTodo className="h-4 w-4 text-violet-600" />
                      <Label className="text-sm font-medium">Engineering Tasks to Spawn</Label>
                      <Badge variant="secondary" className="text-[10px]">{selectedTasks.size}/{availableTaskTemplates.length}</Badge>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => setSelectedTasks(new Set(availableTaskTemplates.map(t => t.title)))}
                        data-testid="btn-select-all-tasks"
                      >Select All</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => setSelectedTasks(new Set())}
                        data-testid="btn-deselect-all-tasks"
                      >Deselect All</Button>
                    </div>
                  </div>
                  <div className="border rounded-lg divide-y">
                    {availableTaskTemplates.map((tmpl, idx) => (
                      <label
                        key={idx}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${selectedTasks.has(tmpl.title) ? "bg-violet-50/50 dark:bg-violet-950/10" : "hover:bg-muted/30"}`}
                        data-testid={`task-template-${idx}`}
                      >
                        <Checkbox
                          checked={selectedTasks.has(tmpl.title)}
                          onCheckedChange={(checked) => {
                            setSelectedTasks(prev => {
                              const next = new Set(prev);
                              if (checked) next.add(tmpl.title);
                              else next.delete(tmpl.title);
                              return next;
                            });
                          }}
                          data-testid={`checkbox-task-${idx}`}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm">{tmpl.title}</span>
                        </div>
                        <Badge variant={tmpl.priority === "High" ? "default" : "secondary"} className={`text-[10px] shrink-0 ${tmpl.priority === "High" ? "bg-red-100 text-red-700 hover:bg-red-100" : ""}`}>
                          {tmpl.priority}
                        </Badge>
                      </label>
                    ))}
                  </div>
                  {selectedTasks.size === 0 && (
                    <p className="text-[10px] text-amber-600 flex items-center gap-1">No tasks selected — ticket will be created without engineering tasks.</p>
                  )}
                </div>
              </>
            )}

            <Separator />

            <div className="flex justify-between items-center pt-2">
              <Button variant="outline" onClick={() => setStep(2)} data-testid="btn-step3-back">Back</Button>
              <Button
                onClick={handleSubmit}
                disabled={createTicketMutation.isPending || !form.projectSiteName.trim() || !form.requestType}
                className="gap-1.5"
                data-testid="btn-submit-ticket"
              >
                {createTicketMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Create PD Ticket
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { FormEvent, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type Project = { id: number; projectName: string };
type LaunchAction = "engineering-request" | "task" | "handover" | "create-po" | "link-invoice";

const ACTION_LABELS: Record<LaunchAction, string> = {
  "engineering-request": "Create Engineering Request",
  task: "Create Task",
  handover: "Start Handover",
  "create-po": "Create PO",
  "link-invoice": "Link Invoice",
};

const guidance = "If this keeps happening, refresh and retry. If it still fails, contact your admin to verify permissions and API availability.";

async function parseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return data?.error || data?.message || fallback;
}

export default function ActionLaunchpadPage() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const search = useMemo(() => new URLSearchParams(location.split("?")[1] || ""), [location]);
  const requested = (search.get("action") || "") as LaunchAction;
  const [activeAction, setActiveAction] = useState<LaunchAction>(Object.keys(ACTION_LABELS).includes(requested) ? requested : "task");

  const { data: projects = [], isLoading: projectsLoading, error: projectsError, refetch: refetchProjects, isFetching: projectsFetching } = useQuery<Project[]>({
    queryKey: ["action-launchpad-projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", { credentials: "include" });
      if (!res.ok) throw new Error(`Could not load projects. ${guidance}`);
      const data = await res.json();
      return Array.isArray(data) ? data.map((p: any) => ({ id: p.id || p.project_info_id, projectName: p.projectName || p.project_name })).filter((p: Project) => p.id && p.projectName) : [];
    },
    retry: 1,
  });

  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [poNumber, setPoNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [poReference, setPoReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedProject = projects.find((p) => String(p.id) === projectId);

  const submitTaskLike = async (isEngineeringRequest: boolean) => {
    const trimmedTitle = title.trim();
    if (!projectId || !trimmedTitle) {
      toast({ title: "Cannot create item", description: "What failed: form validation. Likely reason: Project and title are required. How to fix: select a project and enter a clear title, then try again.", variant: "destructive" });
      return;
    }

    const res = await fetch("/api/eng/tasks", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: trimmedTitle,
        description: description.trim() || null,
        projectId: Number(projectId),
        projectName: selectedProject?.projectName,
        status: "TO DO",
        priority,
        category: isEngineeringRequest ? "engineering_request" : "task",
        taskType: isEngineeringRequest ? "REQUEST" : "TASK",
      }),
    });

    if (!res.ok) {
      const reason = await parseError(res, "The server rejected the request.");
      throw new Error(`What failed: ${ACTION_LABELS[isEngineeringRequest ? "engineering-request" : "task"]}. Likely reason: ${reason} How to fix: confirm required fields and your project permissions, then retry.`);
    }

    const created = await res.json();
    toast({ title: "Created", description: `${ACTION_LABELS[isEngineeringRequest ? "engineering-request" : "task"]} created successfully.` });
    navigate(`/engineering/tasks?highlightId=${created.id}`);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (activeAction === "engineering-request") await submitTaskLike(true);
      if (activeAction === "task") await submitTaskLike(false);

      if (activeAction === "handover") {
        if (!selectedProject) throw new Error("What failed: Start Handover. Likely reason: No project selected. How to fix: choose a project and retry.");
        navigate(`/pd/handover/${selectedProject.id}`);
        toast({ title: "Handover started", description: "Opened the PD to PM handover workflow for this project." });
      }

      if (activeAction === "create-po") {
        if (!projectId || !poNumber.trim() || !description.trim()) {
          throw new Error("What failed: Create PO. Likely reason: PO number, project, and description are required. How to fix: fill in all required fields and retry.");
        }
        const res = await fetch(`/api/pm-otg/projects/${projectId}/generate-po`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poNumber: poNumber.trim(), description: description.trim(), supplier: supplier.trim() || null, amount: amount || null }),
        });
        if (!res.ok) {
          const reason = await parseError(res, "Unable to create PO record.");
          throw new Error(`What failed: Create PO. Likely reason: ${reason} How to fix: confirm PM assignment to the project, supplier details, and required PO fields, then retry.`);
        }
        toast({ title: "PO created", description: "PO request submitted and logged against the project." });
        navigate(`/pm/on-the-go/project/${projectId}`);
      }

      if (activeAction === "link-invoice") {
        if (!projectId || !invoiceNumber.trim()) {
          throw new Error("What failed: Link Invoice. Likely reason: Invoice number and project are required. How to fix: pick a project, enter an invoice number, and retry.");
        }
        const res = await fetch(`/api/pm-otg/projects/${projectId}/link-invoice`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceNumber: invoiceNumber.trim(), amount: amount || null, poReference: poReference.trim() || null }),
        });
        if (!res.ok) {
          const reason = await parseError(res, "Unable to link invoice.");
          throw new Error(`What failed: Link Invoice. Likely reason: ${reason} How to fix: verify invoice number and PM access for the selected project, then retry.`);
        }
        toast({ title: "Invoice linked", description: "Invoice linkage was saved successfully." });
        navigate(`/pm/on-the-go/project/${projectId}`);
      }
    } catch (error: any) {
      toast({ title: "Action failed", description: error.message || `The action could not be completed. ${guidance}`, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Quick Create</h1>
        <p className="text-sm text-slate-600">Launch core operational actions from one reliable create flow.</p>
      </div>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Action</CardTitle>
          <CardDescription>Select an action and complete required details.</CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            {(Object.entries(ACTION_LABELS) as Array<[LaunchAction, string]>).map(([key, label]) => (
              <Button key={key} type="button" variant={activeAction === key ? "default" : "outline"} onClick={() => setActiveAction(key)}>{label}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {projectsError ? (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-2">
              <p>Could not load projects. Likely reason: server/network issue. How to fix: refresh the page and retry. If it persists, contact your admin.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => refetchProjects()} disabled={projectsFetching} data-testid="btn-retry-projects">
                {projectsFetching ? "Retrying..." : "Retry projects"}
              </Button>
              <p className="text-xs text-amber-700">Project data is unavailable, so this action cannot be submitted yet.</p>
            </div>
          ) : null}
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="project">Project</Label>
              <select id="project" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={projectsLoading || submitting || !!projectsError}>
                <option value="">Select project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
              </select>
            </div>

            {["engineering-request", "task"].includes(activeAction) && (
              <>
                <div className="space-y-1.5"><Label htmlFor="title">Title</Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="priority">Priority</Label><Input id="priority" value={priority} onChange={(e) => setPriority(e.target.value.toUpperCase())} /></div>
                <div className="space-y-1.5"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              </>
            )}

            {activeAction === "create-po" && (
              <>
                <div className="space-y-1.5"><Label htmlFor="po-number">PO Number</Label><Input id="po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="supplier">Supplier</Label><Input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="amount">Amount</Label><Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="po-description">Description</Label><Textarea id="po-description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              </>
            )}

            {activeAction === "link-invoice" && (
              <>
                <div className="space-y-1.5"><Label htmlFor="invoice-number">Invoice Number</Label><Input id="invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="po-ref">PO Reference</Label><Input id="po-ref" value={poReference} onChange={(e) => setPoReference(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="invoice-amount">Amount</Label><Input id="invoice-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              </>
            )}

            {activeAction === "handover" && <p className="text-sm text-slate-600">This launches the formal PD to PM handover workflow with mandatory validation and PM review.</p>}

            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={submitting || projectsLoading || !!projectsError || !projectId}>{submitting ? "Submitting..." : ACTION_LABELS[activeAction]}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

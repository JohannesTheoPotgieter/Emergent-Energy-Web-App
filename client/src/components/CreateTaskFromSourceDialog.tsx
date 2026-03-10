import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, MessageSquare, FileText } from "lucide-react";

interface SourceData {
  sourceType: "email" | "teams" | "sharepoint";
  sourceRef?: string;
  outlookMessageId?: string;
  subject: string;
  sender?: string;
  receivedAt?: string;
  snippet?: string;
  webLink?: string;
}

interface CreateTaskFromSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SourceData | null;
}

const CATEGORY_OPTIONS = [
  "Personal",
  "Engineering",
  "Quality",
  "Project Plan",
  "PM / Delivery",
  "Finance",
  "Operations",
  "Other",
];

export default function CreateTaskFromSourceDialog({ open, onOpenChange, source }: CreateTaskFromSourceDialogProps) {
  const { toast } = useToast();

  const [createType, setCreateType] = useState<"task" | "action">("task");
  const [category, setCategory] = useState("Personal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [priority, setPriority] = useState("Med");
  const [dueDate, setDueDate] = useState("");
  const [projectBehavior, setProjectBehavior] = useState<"accept_suggested" | "choose_other" | "leave_unlinked">("accept_suggested");
  const [projectSearch, setProjectSearch] = useState("");

  const [suggestedProjectName, setSuggestedProjectName] = useState("");
  const [suggestedAssigneeUserId, setSuggestedAssigneeUserId] = useState("");
  const [suggestedDueDate, setSuggestedDueDate] = useState("");
  const [suggestedTitle, setSuggestedTitle] = useState("");
  const [suggestedSummary, setSuggestedSummary] = useState("");

  const [overrideProjectReason, setOverrideProjectReason] = useState("");
  const [overrideAssigneeReason, setOverrideAssigneeReason] = useState("");
  const [overrideDueDateReason, setOverrideDueDateReason] = useState("");
  const [overrideTitleReason, setOverrideTitleReason] = useState("");
  const [overrideSummaryReason, setOverrideSummaryReason] = useState("");

  const { data: rolloutFlags } = useQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
    enabled: open,
  });
  const msCreateEnabled = !!rolloutFlags?.ms_create_action;

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string; is_active: boolean }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) =>
      data
        .filter((p: any) => p.is_active !== false)
        .map((p: any) => ({ project_name: p.project_name, is_active: true }))
        .sort((a, b) => a.project_name.localeCompare(b.project_name)),
    enabled: open,
  });

  const { data: allUsers = [] } = useQuery<Array<{ id: number; name: string; username: string; role: string }>>({
    queryKey: ["/api/eng/users"],
    enabled: open,
  });

  const filteredProjects = projectSearch
    ? allProjects.filter((p) => p.project_name.toLowerCase().includes(projectSearch.toLowerCase()))
    : allProjects;

  const overrideRequired = useMemo(() => ({
    project: suggestedProjectName && (projectName || "") !== suggestedProjectName,
    assignee: suggestedAssigneeUserId && (assigneeUserId || "") !== suggestedAssigneeUserId,
    dueDate: suggestedDueDate && (dueDate || "") !== suggestedDueDate,
    title: suggestedTitle && title.trim() !== suggestedTitle,
    summary: suggestedSummary && description.trim() !== suggestedSummary,
  }), [suggestedProjectName, projectName, suggestedAssigneeUserId, assigneeUserId, suggestedDueDate, dueDate, suggestedTitle, title, suggestedSummary, description]);

  const createTaskMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/outlook/email-to-task", data),
    onSuccess: () => {
      toast({ title: `${createType === "task" ? "Task" : "Action"} created successfully` });
      resetAndClose();
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operational-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
    },
    onError: (err: any) =>
      toast({
        title: "Failed to create item",
        description: err.message,
        variant: "destructive",
      }),
  });

  const resetAndClose = () => {
    setCreateType("task");
    setCategory("Personal");
    setTitle("");
    setDescription("");
    setProjectName("");
    setAssigneeUserId("");
    setPriority("Med");
    setDueDate("");
    setProjectSearch("");
    setProjectBehavior("accept_suggested");
    setSuggestedProjectName("");
    setSuggestedAssigneeUserId("");
    setSuggestedDueDate("");
    setSuggestedTitle("");
    setSuggestedSummary("");
    setOverrideProjectReason("");
    setOverrideAssigneeReason("");
    setOverrideDueDateReason("");
    setOverrideTitleReason("");
    setOverrideSummaryReason("");
    onOpenChange(false);
  };

  useEffect(() => {
    if (open && source) {
      const suggestedTitleLocal = source.subject || "";
      const suggestedSummaryLocal = source.snippet || "";
      const defaultProject = "";
      const defaultAssignee = "";

      setSuggestedProjectName(defaultProject);
      setSuggestedAssigneeUserId(defaultAssignee);
      setSuggestedDueDate("");
      setSuggestedTitle(suggestedTitleLocal);
      setSuggestedSummary(suggestedSummaryLocal);

      setTitle(suggestedTitleLocal);
      const lines = [];
      if (source.sender) lines.push(`From: ${source.sender}`);
      if (source.snippet) lines.push(source.snippet);
      setDescription(lines.join("\n\n"));
      setProjectName(defaultProject);
      setAssigneeUserId(defaultAssignee);
      setDueDate("");
      setProjectBehavior("leave_unlinked");
    }
  }, [open, source, allProjects]);

  const handleSubmit = () => {
    if (!title.trim() || !category) return;

    if ((projectBehavior === "accept_suggested" || projectBehavior === "choose_other") && !projectName) {
      toast({ title: "Project selection is required for linked items", variant: "destructive" });
      return;
    }

    if (overrideRequired.project && !overrideProjectReason.trim()) {
      toast({ title: "Reason required for project override", variant: "destructive" });
      return;
    }
    if (overrideRequired.assignee && !overrideAssigneeReason.trim()) {
      toast({ title: "Reason required for owner override", variant: "destructive" });
      return;
    }
    if (overrideRequired.dueDate && !overrideDueDateReason.trim()) {
      toast({ title: "Reason required for due date override", variant: "destructive" });
      return;
    }
    if (overrideRequired.title && !overrideTitleReason.trim()) {
      toast({ title: "Reason required for title override", variant: "destructive" });
      return;
    }
    if (overrideRequired.summary && !overrideSummaryReason.trim()) {
      toast({ title: "Reason required for summary override", variant: "destructive" });
      return;
    }

    const effectiveProject = projectBehavior === "leave_unlinked" ? null : projectName || null;

    createTaskMutation.mutate({
      sourceType: source?.sourceType || "email",
      sourceRef: source?.sourceRef || source?.outlookMessageId || source?.webLink || source?.subject,
      webLink: source?.webLink || null,
      subject: title.trim(),
      sender: source?.sender || null,
      receivedAt: source?.receivedAt || null,
      snippet: source?.snippet || null,
      createType,
      category,
      projectBehavior,
      projectName: effectiveProject,
      assigneeUserId: assigneeUserId ? parseInt(assigneeUserId) : null,
      priority,
      dueDate: dueDate || null,
      description: description.trim() || null,
      suggestions: {
        projectName: suggestedProjectName || null,
        assigneeUserId: suggestedAssigneeUserId || null,
        dueDate: suggestedDueDate || null,
        title: suggestedTitle || null,
        summary: suggestedSummary || null,
      },
      chosenValues: {
        projectName: effectiveProject,
        assigneeUserId: assigneeUserId || null,
        dueDate: dueDate || null,
        title: title.trim(),
        summary: description.trim() || null,
      },
      overrideReasons: {
        projectName: overrideProjectReason.trim() || null,
        assigneeUserId: overrideAssigneeReason.trim() || null,
        dueDate: overrideDueDateReason.trim() || null,
        title: overrideTitleReason.trim() || null,
        summary: overrideSummaryReason.trim() || null,
      },
    });
  };

  const sourceLabel = source?.sourceType === "teams" ? "Teams" : source?.sourceType === "sharepoint" ? "SharePoint/OneDrive" : "Email";

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-create-task-from-source">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="dialog-title">
            {source?.sourceType === "teams" ? (
              <MessageSquare className="h-5 w-5 text-purple-600" />
            ) : source?.sourceType === "sharepoint" ? (
              <FileText className="h-5 w-5 text-emerald-600" />
            ) : (
              <Mail className="h-5 w-5 text-blue-600" />
            )}
            Create Task/Action from {sourceLabel}
          </DialogTitle>
        </DialogHeader>

        {!msCreateEnabled ? (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">This workflow is disabled by feature flag (`ms_create_action`).</div>
        ) : (
          <>
            {source && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1" data-testid="source-preview">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{sourceLabel}</Badge>
                  <span className="text-xs text-muted-foreground truncate">{source.sender || "Unknown sender/author"}</span>
                </div>
                <p className="text-sm font-medium truncate">{source.subject}</p>
                {source.snippet && <p className="text-xs text-muted-foreground line-clamp-2">{source.snippet}</p>}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Create As</Label>
                  <SearchableSelect
                    value={createType}
                    onValueChange={(v) => setCreateType(v as "task" | "action")}
                    options={[{ value: "task", label: "Create Task" }, { value: "action", label: "Create Action" }]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Category / Type</Label>
                  <SearchableSelect
                    value={category}
                    onValueChange={setCategory}
                    options={CATEGORY_OPTIONS.map((value) => ({ value, label: value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-title">Title / Summary</Label>
                <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                {overrideRequired.title && (
                  <Textarea placeholder="Reason for overriding suggested title" value={overrideTitleReason} onChange={(e) => setOverrideTitleReason(e.target.value)} rows={2} />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-description">Description</Label>
                <Textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                {overrideRequired.summary && (
                  <Textarea placeholder="Reason for overriding suggested summary" value={overrideSummaryReason} onChange={(e) => setOverrideSummaryReason(e.target.value)} rows={2} />
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Project behavior (explicit choice)</Label>
                <SearchableSelect
                  value={projectBehavior}
                  onValueChange={(v) => setProjectBehavior(v as "accept_suggested" | "choose_other" | "leave_unlinked")}
                  options={[
                    { value: "accept_suggested", label: "Accept suggested project" },
                    { value: "choose_other", label: "Choose different project" },
                    { value: "leave_unlinked", label: "Leave unlinked" },
                  ]}
                />
              </div>

              {projectBehavior !== "leave_unlinked" && (
                <div className="space-y-1.5">
                  <Label htmlFor="task-project">Project</Label>
                  <SearchableSelect
                    value={projectName}
                    onValueChange={setProjectName}
                    placeholder="Select a project"
                    data-testid="select-project"
                    options={filteredProjects.map((p) => ({ value: p.project_name, label: p.project_name }))}
                  />
                  {overrideRequired.project && (
                    <Textarea placeholder="Reason for overriding suggested project" value={overrideProjectReason} onChange={(e) => setOverrideProjectReason(e.target.value)} rows={2} />
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Owner</Label>
                  <SearchableSelect
                    value={assigneeUserId}
                    onValueChange={setAssigneeUserId}
                    placeholder="Select owner"
                    options={allUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.role})` }))}
                  />
                  {overrideRequired.assignee && (
                    <Textarea placeholder="Reason for overriding suggested owner" value={overrideAssigneeReason} onChange={(e) => setOverrideAssigneeReason(e.target.value)} rows={2} />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Due date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  {overrideRequired.dueDate && (
                    <Textarea placeholder="Reason for overriding suggested due date" value={overrideDueDateReason} onChange={(e) => setOverrideDueDateReason(e.target.value)} rows={2} />
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!msCreateEnabled || !title.trim() || createTaskMutation.isPending}>
            {createTaskMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {createType === "task" ? "Create Task" : "Create Action"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, MessageSquare, Link2 } from "lucide-react";

interface SourceData {
  sourceType: "email" | "teams";
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

export default function CreateTaskFromSourceDialog({
  open,
  onOpenChange,
  source,
}: CreateTaskFromSourceDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [priority, setPriority] = useState("Med");
  const [dueDate, setDueDate] = useState("");
  const [projectSearch, setProjectSearch] = useState("");

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
    ? allProjects.filter((p) =>
        p.project_name.toLowerCase().includes(projectSearch.toLowerCase())
      )
    : allProjects;

  const createTaskMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/outlook/email-to-task", data),
    onSuccess: () => {
      toast({ title: "Task created and linked to project" });
      resetAndClose();
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operational-tasks"] });
    },
    onError: (err: any) =>
      toast({
        title: "Failed to create task",
        description: err.message,
        variant: "destructive",
      }),
  });

  const resetAndClose = () => {
    setTitle("");
    setDescription("");
    setProjectName("");
    setAssigneeUserId("");
    setPriority("Med");
    setDueDate("");
    setProjectSearch("");
    onOpenChange(false);
  };

  useEffect(() => {
    if (open && source) {
      setTitle(source.subject || "");
      const lines = [];
      if (source.sender) lines.push(`From: ${source.sender}`);
      if (source.snippet) lines.push(source.snippet);
      setDescription(lines.join("\n\n"));
    }
  }, [open, source]);

  const handleSubmit = () => {
    if (!title.trim() || !projectName) return;

    createTaskMutation.mutate({
      outlookMessageId: source?.outlookMessageId || null,
      subject: title.trim(),
      sender: source?.sender || null,
      receivedAt: source?.receivedAt || null,
      snippet: source?.snippet || null,
      webLink: source?.webLink || null,
      targetType: "operational_new",
      sourceType: source?.sourceType || "email",
      projectName,
      assigneeUserId: assigneeUserId ? parseInt(assigneeUserId) : null,
      priority,
      dueDate: dueDate || null,
      description: description.trim() || null,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetAndClose();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="dialog-create-task-from-source">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="dialog-title">
            {source?.sourceType === "teams" ? (
              <MessageSquare className="h-5 w-5 text-purple-600" />
            ) : (
              <Mail className="h-5 w-5 text-blue-600" />
            )}
            Create Task from {source?.sourceType === "teams" ? "Message" : "Email"}
          </DialogTitle>
        </DialogHeader>

        {source && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1" data-testid="source-preview">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {source.sourceType === "teams" ? "Teams" : "Email"}
              </Badge>
              <span className="text-xs text-muted-foreground truncate">
                {source.sender}
              </span>
            </div>
            <p className="text-sm font-medium truncate">{source.subject}</p>
            {source.snippet && (
              <p className="text-xs text-muted-foreground line-clamp-2">{source.snippet}</p>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Task Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter task title"
              data-testid="input-task-title"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-project">Project *</Label>
            <Select value={projectName} onValueChange={setProjectName}>
              <SelectTrigger data-testid="select-project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                <div className="p-2">
                  <Input
                    placeholder="Search projects..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="input-project-search"
                  />
                </div>
                {filteredProjects.map((p) => (
                  <SelectItem key={p.project_name} value={p.project_name}>
                    {p.project_name}
                  </SelectItem>
                ))}
                {filteredProjects.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    No projects found
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-assignee">Assign To</Label>
            <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
              <SelectTrigger data-testid="select-assignee">
                <SelectValue placeholder="Select a team member" />
              </SelectTrigger>
              <SelectContent>
                {allUsers.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Critical">Critical</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Med">Medium</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due Date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="input-due-date"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Add context or instructions..."
              className="text-sm"
              data-testid="input-description"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={resetAndClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || !projectName || createTaskMutation.isPending}
            data-testid="button-create-task"
          >
            {createTaskMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Link2 className="h-4 w-4 mr-1" />
            )}
            Create & Link Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

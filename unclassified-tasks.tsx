import { useState } from "react";
import MyToolNav from "@/components/my-tool-nav";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, Loader2, AlertCircle, FolderOpen } from "lucide-react";

interface UnclassifiedTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  projectName: string | null;
  bucket: string | null;
  department: string | null;
  createdAt: string;
  dueAt: string | null;
}

interface ProjectSummary {
  project_name: string;
}

export default function UnclassifiedTasksPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<string>("");

  const { data: tasks = [], isLoading } = useQuery<UnclassifiedTask[]>({
    queryKey: ["/api/mytool/unclassified-tasks"],
    enabled: isAdmin,
  });

  const { data: projects = [] } = useQuery<ProjectSummary[]>({
    queryKey: ["/api/projects-summary"],
    enabled: isAdmin,
  });

  const classifyMutation = useMutation({
    mutationFn: async ({
      taskId,
      bucket,
      projectName,
    }: {
      taskId: number;
      bucket: string;
      projectName?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/mytool/tasks/${taskId}`, {
        bucket,
        projectName: projectName || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/mytool/unclassified-tasks"],
      });
      setEditingTaskId(null);
      setSelectedBucket("");
      setSelectedProject("");
    },
  });

  if (!isAdmin) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-[60vh] gap-3"
        data-testid="admin-access-required"
      >
        <Shield className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Admin Access Required</h2>
        <p className="text-muted-foreground">
          You need admin privileges to view this page.
        </p>
      </div>
    );
  }

  const handleStartEdit = (taskId: number) => {
    setEditingTaskId(taskId);
    setSelectedBucket("");
    setSelectedProject("");
  };

  const handleSave = (taskId: number) => {
    if (!selectedBucket) return;
    classifyMutation.mutate({
      taskId,
      bucket: selectedBucket,
      projectName:
        selectedBucket === "project" ? selectedProject : undefined,
    });
  };

  return (
    <div
      className="p-6 max-w-[1400px] mx-auto space-y-6"
      data-testid="unclassified-tasks-page"
    >
      <MyToolNav subtitle="Unclassified" />
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1
              className="text-2xl font-bold"
              data-testid="text-page-title"
            >
              Unclassified Tasks
            </h1>
            {!isLoading && (
              <Badge
                variant="destructive"
                className="text-sm"
                data-testid="badge-count"
              >
                {tasks.length}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground" data-testid="text-page-subtitle">
            Tasks needing bucket/project assignment
          </p>
        </div>
      </div>

      {isLoading ? (
        <div
          className="flex justify-center py-16"
          data-testid="loading-spinner"
        >
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <Card data-testid="empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <FolderOpen className="w-12 h-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No Unclassified Tasks</h3>
            <p className="text-muted-foreground text-sm">
              All tasks have been properly classified with buckets and projects.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="tasks-table-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="w-4 h-4 text-red-500" />
              Tasks Requiring Classification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table data-testid="tasks-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current Bucket</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id} data-testid={`row-task-${task.id}`}>
                    <TableCell
                      className="font-medium max-w-[300px] truncate"
                      data-testid={`text-task-title-${task.id}`}
                    >
                      {task.title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        data-testid={`badge-status-${task.id}`}
                      >
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-bucket-${task.id}`}>
                      {task.bucket ? (
                        <Badge variant="secondary">{task.bucket}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          None
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-project-${task.id}`}>
                      {task.projectName || (
                        <span className="text-muted-foreground text-sm">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-created-${task.id}`}>
                      {new Date(task.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {editingTaskId === task.id ? (
                        <div className="flex items-center gap-2">
                          <SearchableSelect
                            value={selectedBucket}
                            onValueChange={(v) => {
                              setSelectedBucket(v);
                              if (v !== "project") setSelectedProject("");
                            }}
                            placeholder="Set bucket"
                            triggerClassName="w-[140px]"
                            data-testid={`select-bucket-${task.id}`}
                            options={[
                              { value: "personal", label: "Personal" },
                              { value: "company_ops", label: "Company Ops" },
                              { value: "project", label: "Project" },
                            ]}
                          />
                          {selectedBucket === "project" && (
                            <SearchableSelect
                              value={selectedProject}
                              onValueChange={setSelectedProject}
                              placeholder="Pick project"
                              triggerClassName="w-[180px]"
                              data-testid={`select-project-${task.id}`}
                              options={projects.map((p) => ({
                                value: p.project_name,
                                label: p.project_name,
                              }))}
                            />
                          )}
                          <Button
                            size="sm"
                            onClick={() => handleSave(task.id)}
                            disabled={
                              classifyMutation.isPending ||
                              !selectedBucket ||
                              (selectedBucket === "project" && !selectedProject)
                            }
                            data-testid={`button-save-${task.id}`}
                          >
                            {classifyMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingTaskId(null)}
                            data-testid={`button-cancel-${task.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStartEdit(task.id)}
                          data-testid={`button-classify-${task.id}`}
                        >
                          Classify
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

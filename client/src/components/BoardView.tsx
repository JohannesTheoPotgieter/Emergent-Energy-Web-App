import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, User, Flag, GripVertical, Clock, AlertCircle } from "lucide-react";

interface BoardViewProps {
  projectName: string;
  onTaskClick: (taskId: number) => void;
}

const COLUMNS = [
  { status: "Not Started", color: "bg-gray-500", headerBg: "bg-gray-100 border-gray-300", dotColor: "bg-gray-400" },
  { status: "In Progress", color: "bg-blue-500", headerBg: "bg-blue-50 border-blue-300", dotColor: "bg-blue-400" },
  { status: "Blocked", color: "bg-red-500", headerBg: "bg-red-50 border-red-300", dotColor: "bg-red-400" },
  { status: "Done", color: "bg-green-500", headerBg: "bg-green-50 border-green-300", dotColor: "bg-green-400" },
] as const;

const PRIORITY_BORDER: Record<string, string> = {
  Urgent: "border-l-red-500",
  High: "border-l-orange-500",
  Normal: "border-l-gray-400",
  Low: "border-l-blue-400",
};

const PRIORITY_VARIANT: Record<string, string> = {
  Urgent: "bg-red-100 text-red-800",
  High: "bg-orange-100 text-orange-800",
  Normal: "bg-gray-100 text-gray-800",
  Low: "bg-blue-100 text-blue-800",
};

export default function BoardView({ projectName, onTaskClick }: BoardViewProps) {
  const queryClient = useQueryClient();
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);

  const { data: tasks = [], isLoading } = useQuery<any[]>({
    queryKey: ["operational-tasks", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/operational-tasks/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async ({ title, status }: { title: string; status: string }) => {
      await apiRequest("POST", "/api/operational-tasks", {
        projectName,
        title,
        status,
        priority: "Normal",
        percentComplete: 0,
        sortOrder: tasks.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
      setNewTaskTitle("");
      setAddingToColumn(null);
    },
  });

  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(taskId));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    const taskId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!isNaN(taskId)) {
      const task = tasks.find((t: any) => t.id === taskId);
      if (task && task.status !== newStatus) {
        updateStatusMutation.mutate({ id: taskId, status: newStatus });
      }
    }
    setDraggedTaskId(null);
  };

  const handleQuickAdd = (status: string) => {
    if (newTaskTitle.trim()) {
      createTaskMutation.mutate({ title: newTaskTitle.trim(), status });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="board-loading">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[500px]" data-testid="board-view">
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t: any) => {
          if (col.status === "Done") return t.status === "Done" || t.status === "Complete";
          return t.status === col.status;
        });

        return (
          <div
            key={col.status}
            className="flex-shrink-0 w-72 flex flex-col rounded-lg border bg-muted/30"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.status)}
            data-testid={`column-${col.status.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-lg border-b ${col.headerBg}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <span className="font-semibold text-sm">{col.status}</span>
              </div>
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {columnTasks.length}
              </Badge>
            </div>

            <ScrollArea className="flex-1 max-h-[calc(100vh-280px)]">
              <div className="p-2 space-y-2">
                {columnTasks.length === 0 && (
                  <div className="text-center text-muted-foreground text-xs py-8" data-testid={`empty-column-${col.status.toLowerCase().replace(/\s+/g, "-")}`}>
                    No tasks
                  </div>
                )}

                {columnTasks.map((task: any) => (
                  <Card
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onClick={() => onTaskClick(task.id)}
                    className={`cursor-pointer border-l-4 ${PRIORITY_BORDER[task.priority] || PRIORITY_BORDER.Normal} hover:shadow-md transition-shadow ${
                      draggedTaskId === task.id ? "opacity-50" : ""
                    }`}
                    data-testid={`task-card-${task.id}`}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start gap-1">
                        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5 cursor-grab" />
                        <span className="text-sm font-medium leading-tight flex-1">{task.title}</span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge className={`text-[10px] px-1.5 py-0 ${PRIORITY_VARIANT[task.priority] || PRIORITY_VARIANT.Normal}`}>
                          <Flag className="h-2.5 w-2.5 mr-0.5" />
                          {task.priority}
                        </Badge>
                        {task.isBaseline && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-300 text-purple-700">
                            BASELINE
                          </Badge>
                        )}
                      </div>

                      {task.assignees && task.assignees.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span className="truncate">{task.assignees.join(", ")}</span>
                        </div>
                      )}

                      {task.dueDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{task.dueDate}</span>
                        </div>
                      )}

                      {task.percentComplete > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{task.percentComplete}%</span>
                          </div>
                          <Progress value={task.percentComplete} className="h-1.5" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>

            <div className="p-2 border-t">
              {addingToColumn === col.status ? (
                <div className="space-y-2" data-testid={`quick-add-form-${col.status.toLowerCase().replace(/\s+/g, "-")}`}>
                  <Input
                    autoFocus
                    placeholder="Task title..."
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleQuickAdd(col.status);
                      if (e.key === "Escape") {
                        setAddingToColumn(null);
                        setNewTaskTitle("");
                      }
                    }}
                    data-testid={`quick-add-input-${col.status.toLowerCase().replace(/\s+/g, "-")}`}
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      onClick={() => handleQuickAdd(col.status)}
                      disabled={!newTaskTitle.trim() || createTaskMutation.isPending}
                      data-testid={`quick-add-submit-${col.status.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        setAddingToColumn(null);
                        setNewTaskTitle("");
                      }}
                      data-testid={`quick-add-cancel-${col.status.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground"
                  onClick={() => {
                    setAddingToColumn(col.status);
                    setNewTaskTitle("");
                  }}
                  data-testid={`quick-add-button-${col.status.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add task
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

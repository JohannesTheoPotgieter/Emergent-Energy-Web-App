import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface ProjectPlanTabProps {
  projectName: string;
}

export function ProjectPlanTab({ projectName }: ProjectPlanTabProps) {
  const { data: tasks, isLoading, error } = useQuery({
    queryKey: [`/api/project-plan/${projectName}`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-destructive">Failed to load project plan data</p>
        </CardContent>
      </Card>
    );
  }

  const taskList = tasks || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Plan</CardTitle>
        <CardDescription>
          Tasks and milestones from the Project Plan sheet • Read-only view
        </CardDescription>
      </CardHeader>
      <CardContent>
        {taskList.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No project plan data available for this project
          </p>
        ) : (
          <div className="rounded-md border overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taskList.map((task: any, idx: number) => (
                  <TableRow key={task.id || idx}>
                    <TableCell className="font-medium">{task.taskName || "-"}</TableCell>
                    <TableCell>
                      {task.taskType === "Milestone" ? (
                        <Badge variant="secondary">Milestone</Badge>
                      ) : (
                        <Badge variant="outline">Task</Badge>
                      )}
                    </TableCell>
                    <TableCell>{task.startDate ? new Date(task.startDate).toLocaleDateString() : "-"}</TableCell>
                    <TableCell>{task.endDate ? new Date(task.endDate).toLocaleDateString() : "-"}</TableCell>
                    <TableCell>
                      {task.status ? (
                        <Badge variant={task.status === "Complete" ? "default" : "outline"}>
                          {task.status}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{task.owner || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface ProjectPlanTabProps {
  projectName: string;
}

export function ProjectPlanTab({ projectName }: ProjectPlanTabProps) {
  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ["project-plan", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/project-plan/${encodeURIComponent(projectName)}`);
      if (!res.ok) throw new Error("Failed to fetch project plan");
      return res.json();
    },
    enabled: !!projectName,
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

  const taskList = Array.isArray(tasks) ? tasks : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Plan</CardTitle>
        <CardDescription>
          Programme tasks and milestones • {taskList.length} items • Read-only view
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
                  <TableHead>No.</TableHead>
                  <TableHead>Task / Programme</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Actual %</TableHead>
                  <TableHead>Expected %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taskList.map((task: any, idx: number) => {
                  const isSection = task.taskNo && !task.taskNo.includes(".");
                  const actualPct = task.actualPctComplete != null ? (task.actualPctComplete * 100).toFixed(0) : null;
                  const expectedPct = task.expectedPctComplete != null ? (task.expectedPctComplete * 100).toFixed(0) : null;
                  const delta = actualPct && expectedPct ? parseFloat(actualPct) - parseFloat(expectedPct) : null;
                  
                  return (
                    <TableRow key={task.id || idx} className={isSection ? "bg-muted/50 font-semibold" : ""}>
                      <TableCell className="font-mono text-sm">{task.taskNo || "-"}</TableCell>
                      <TableCell className={isSection ? "font-semibold" : ""}>
                        {task.highLevelProgramme || "-"}
                      </TableCell>
                      <TableCell>{task.actualStart ? new Date(task.actualStart).toLocaleDateString() : "-"}</TableCell>
                      <TableCell>{task.durationDays != null ? `${task.durationDays}d` : "-"}</TableCell>
                      <TableCell>{task.actualEnd ? new Date(task.actualEnd).toLocaleDateString() : "-"}</TableCell>
                      <TableCell>
                        {actualPct != null ? (
                          <Badge variant={parseFloat(actualPct) >= 100 ? "default" : "outline"}>
                            {actualPct}%
                          </Badge>
                        ) : "-"}
                      </TableCell>
                      <TableCell>
                        {expectedPct != null ? (
                          <span className={delta != null && delta < -10 ? "text-destructive font-medium" : ""}>
                            {expectedPct}%
                          </span>
                        ) : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

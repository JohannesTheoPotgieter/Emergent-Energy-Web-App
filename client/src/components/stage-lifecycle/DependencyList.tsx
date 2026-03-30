import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStageDependencies, useResolveDependency, useEscalateDependency } from "@/hooks/use-stage-lifecycle";
import type { ProjectStageDependency } from "@shared/schema";
import { CheckCircle2, AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

interface DependencyListProps {
  projectId: number;
  stageCode?: string;
}

const STATUS_COLOR: Record<string, string> = {
  WAITING: "bg-amber-100 text-amber-700",
  RESOLVED: "bg-green-100 text-green-700",
  ESCALATED: "bg-red-100 text-red-700",
  BYPASSED: "bg-gray-100 text-gray-600",
};

export function DependencyList({ projectId, stageCode }: DependencyListProps) {
  const { data, isLoading } = useStageDependencies(projectId, stageCode);
  const resolveMutation = useResolveDependency(projectId);
  const escalateMutation = useEscalateDependency(projectId);

  if (isLoading) {
    return <Card><CardContent className="py-4"><Loader2 className="h-4 w-4 animate-spin" /></CardContent></Card>;
  }

  const deps = data?.dependencies ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cross-Department Dependencies</CardTitle>
      </CardHeader>
      <CardContent>
        {deps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dependencies.</p>
        ) : (
          <div className="space-y-2">
            {deps.map((dep: ProjectStageDependency) => {
              const isOverdue = dep.dueDate && new Date(dep.dueDate) < new Date() && dep.status === 'WAITING';

              return (
                <div key={dep.id} className={`rounded border p-2 text-sm ${isOverdue ? 'border-red-200 bg-red-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{dep.fromDepartment}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{dep.toDepartment}</span>
                    <Badge variant="outline" className={`text-[10px] ml-auto ${STATUS_COLOR[dep.status] || ''}`}>
                      {dep.status}
                    </Badge>
                    {isOverdue && (
                      <Badge variant="destructive" className="text-[10px]">Overdue</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-muted-foreground">{dep.description}</p>
                  {dep.dueDate && (
                    <p className="text-xs text-muted-foreground mt-0.5">Due: {dep.dueDate}</p>
                  )}
                  {dep.status === 'WAITING' && (
                    <div className="flex gap-1 mt-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        onClick={() => resolveMutation.mutate(dep.id)}
                        disabled={resolveMutation.isPending}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Resolve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs text-red-600"
                        onClick={() => escalateMutation.mutate({ depId: dep.id })}
                        disabled={escalateMutation.isPending}
                      >
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Escalate
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

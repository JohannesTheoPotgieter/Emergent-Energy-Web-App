import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Layers, Pencil, Check, X } from "lucide-react";

export function StageDefinitionsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ definitions: any[] }>({
    queryKey: ["/api/admin/stage-definitions"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const updateMutation = useMutation({
    mutationFn: async ({ id, stageName, description }: { id: number; stageName: string; description: string }) => {
      const res = await apiRequest("PUT", `/api/admin/stage-definitions/${id}`, { stageName, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stage-definitions"] });
      setEditingId(null);
    },
  });

  const startEdit = (def: any) => {
    setEditingId(def.id);
    setEditName(def.stageName);
    setEditDesc(def.description || "");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Stage Definitions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="animate-pulse h-24 bg-muted rounded" />
        ) : (
          <div className="space-y-2">
            {(data?.definitions ?? []).map((def: any) => (
              <div key={def.id} className="flex items-center gap-2 border rounded p-2">
                <Badge variant="outline" className="text-[10px] shrink-0 w-10 justify-center">
                  {def.stageSequence}
                </Badge>
                {editingId === def.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="h-7 text-xs" placeholder="Stage name"
                    />
                    <Input
                      value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                      className="h-7 text-xs flex-1" placeholder="Description"
                    />
                    <Button
                      variant="ghost" size="sm" className="h-6 px-1"
                      onClick={() => updateMutation.mutate({ id: def.id, stageName: editName, description: editDesc })}
                    >
                      <Check className="h-3 w-3 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => setEditingId(null)}>
                      <X className="h-3 w-3 text-red-600" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{def.stageName}</span>
                      <span className="text-xs text-muted-foreground ml-2">{def.stageCode}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!def.isActive && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                      <span className="text-xs text-muted-foreground">{def.defaultOwnerRole || "-"}</span>
                      <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => startEdit(def)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import {
  useProjectAccess, useAddProjectAccess, useUpdateProjectAccess, useRemoveProjectAccess,
  type ProjectAccessRecord,
} from "@/hooks/use-project-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Users, Plus, Trash2, Pencil } from "lucide-react";
import { PROJECT_ROLES, ACCESS_LEVELS } from "@shared/schema/stage-lifecycle";

const ACCESS_COLORS: Record<string, string> = {
  owner: "bg-blue-100 text-blue-800",
  contributor: "bg-green-100 text-green-800",
  viewer: "bg-gray-100 text-gray-600",
  none: "bg-red-100 text-red-800",
};

export function ProjectTeamTab({ projectId }: { projectId: number }) {
  const { data, isLoading } = useProjectAccess(projectId);
  const addMutation = useAddProjectAccess(projectId);
  const updateMutation = useUpdateProjectAccess(projectId);
  const removeMutation = useRemoveProjectAccess(projectId);

  const [addOpen, setAddOpen] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState("pm");
  const [newAccessLevel, setNewAccessLevel] = useState("contributor");
  const [newCanEdit, setNewCanEdit] = useState(false);
  const [newCanApprove, setNewCanApprove] = useState(false);

  const handleAdd = () => {
    if (!newUserId) return;
    addMutation.mutate({
      userId: Number(newUserId),
      roleOnProject: newRole,
      accessLevel: newAccessLevel,
      canEdit: newCanEdit,
      canApprove: newCanApprove,
    }, {
      onSuccess: () => {
        setAddOpen(false);
        setNewUserId("");
      },
    });
  };

  const team = data?.team ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Project Team
            <Badge variant="secondary">{team.length}</Badge>
          </div>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add Member
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="animate-pulse h-20 bg-muted rounded" />
        ) : team.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No team members assigned yet.</p>
        ) : (
          <div className="border rounded overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-left font-medium">Name</th>
                  <th className="p-2 text-left font-medium">Role</th>
                  <th className="p-2 text-left font-medium">Access</th>
                  <th className="p-2 text-center font-medium">Edit</th>
                  <th className="p-2 text-center font-medium">Approve</th>
                  <th className="p-2 text-left font-medium">Stages</th>
                  <th className="p-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {team.map((m: ProjectAccessRecord) => (
                  <tr key={m.id} className="border-b">
                    <td className="p-2">
                      <div>
                        <span className="font-medium">{m.userName}</span>
                        <span className="text-muted-foreground ml-1">({m.userRole})</span>
                      </div>
                      <span className="text-muted-foreground">{m.userEmail}</span>
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className="text-[10px]">{m.roleOnProject}</Badge>
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className={`text-[10px] ${ACCESS_COLORS[m.accessLevel] || ""}`}>
                        {m.accessLevel}
                      </Badge>
                    </td>
                    <td className="p-2 text-center">{m.canEdit ? "Yes" : "-"}</td>
                    <td className="p-2 text-center">{m.canApprove ? "Yes" : "-"}</td>
                    <td className="p-2">
                      {m.stagesVisible.length === 0 ? (
                        <span className="text-muted-foreground">All</span>
                      ) : (
                        <span className="text-muted-foreground">{m.stagesVisible.join(", ")}</span>
                      )}
                    </td>
                    <td className="p-2">
                      <Button
                        variant="ghost" size="sm" className="h-6 px-1 text-red-600"
                        onClick={() => removeMutation.mutate(m.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Member Dialog */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium">User ID</label>
                <Input
                  type="number"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  placeholder="Enter user ID"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Project Role</label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Access Level</label>
                <Select value={newAccessLevel} onValueChange={setNewAccessLevel}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCESS_LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={newCanEdit} onChange={(e) => setNewCanEdit(e.target.checked)} />
                  Can Edit
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={newCanApprove} onChange={(e) => setNewCanApprove(e.target.checked)} />
                  Can Approve
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!newUserId}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

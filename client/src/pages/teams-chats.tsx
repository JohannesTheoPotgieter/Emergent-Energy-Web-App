import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Users,
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  Building2,
  FolderKanban,
  Send,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Shield,
  Hash,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import CreateTaskFromSourceDialog from "@/components/CreateTaskFromSourceDialog";

interface ChatMember {
  id: number;
  groupId: number;
  userId: number;
  role: string;
  userName: string;
  userRole: string;
  userEmail: string;
  addedAt: string;
}

interface ChatGroup {
  id: number;
  name: string;
  groupType: string;
  department: string | null;
  projectName: string | null;
  description: string | null;
  teamsChatId: string | null;
  members: ChatMember[];
  memberCount: number;
  isMember: boolean;
  isGroupAdmin: boolean;
  canManage: boolean;
  createdAt: string;
}

interface ChatMessage {
  id: number;
  groupId: number;
  content: string;
  senderName: string | null;
  senderUserId: number | null;
  userName: string | null;
  isFromTeams: boolean;
  createdAt: string;
}

const DEPARTMENTS = [
  "Executive",
  "Project Management",
  "Engineering",
  "Finance",
  "Quality",
  "Project Development",
  "Construction",
  "Operations",
];

export default function TeamsChatsPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("department");
  const [selectedGroup, setSelectedGroup] = useState<ChatGroup | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskSource, setTaskSource] = useState<any>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupType, setNewGroupType] = useState("department");
  const [newGroupDept, setNewGroupDept] = useState("");
  const [newGroupProject, setNewGroupProject] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);

  const { data: groups = [], isLoading } = useQuery<ChatGroup[]>({
    queryKey: ["/api/teams/groups"],
  });

  const { data: allUsers = [] } = useQuery<Array<{ id: number; name: string; username: string; role: string }>>({
    queryKey: ["/api/eng/users"],
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) =>
      data
        .filter((p: any) => p.is_active !== false)
        .map((p: any) => ({ project_name: p.project_name }))
        .sort((a, b) => a.project_name.localeCompare(b.project_name)),
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/teams/groups", selectedGroup?.id, "messages"],
    queryFn: async () => {
      if (!selectedGroup) return [];
      const res = await fetch(`/api/teams/groups/${selectedGroup.id}/messages`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedGroup,
    refetchInterval: selectedGroup ? 10000 : false,
  });

  const createGroupMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/teams/groups", data),
    onSuccess: () => {
      toast({ title: "Group created" });
      setShowCreateDialog(false);
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to create group", description: err.message, variant: "destructive" }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/teams/groups/${id}`),
    onSuccess: () => {
      toast({ title: "Group deleted" });
      setSelectedGroup(null);
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to delete group", description: err.message, variant: "destructive" }),
  });

  const addMembersMutation = useMutation({
    mutationFn: ({ groupId, userIds }: { groupId: number; userIds: number[] }) =>
      apiRequest("POST", `/api/teams/groups/${groupId}/members`, { userIds }),
    onSuccess: () => {
      toast({ title: "Members added" });
      setShowAddMemberDialog(false);
      setSelectedMembers([]);
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to add members", description: err.message, variant: "destructive" }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: number; userId: number }) =>
      apiRequest("DELETE", `/api/teams/groups/${groupId}/members/${userId}`),
    onSuccess: () => {
      toast({ title: "Member removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to remove member", description: err.message, variant: "destructive" }),
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ groupId, content }: { groupId: number; content: string }) =>
      apiRequest("POST", `/api/teams/groups/${groupId}/messages`, { content }),
    onSuccess: () => {
      setMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups", selectedGroup?.id, "messages"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to send message", description: err.message, variant: "destructive" }),
  });

  const resetCreateForm = () => {
    setNewGroupName("");
    setNewGroupType("department");
    setNewGroupDept("");
    setNewGroupProject("");
    setNewGroupDesc("");
  };

  const departmentGroups = groups.filter(g => g.groupType === "department");
  const projectGroups = groups.filter(g => g.groupType === "project");

  const handleCreateTask = (msg: ChatMessage) => {
    setTaskSource({
      sourceType: "teams",
      subject: msg.content.slice(0, 100),
      sender: msg.userName || msg.senderName || "Unknown",
      receivedAt: msg.createdAt,
      snippet: msg.content,
    });
    setTaskDialogOpen(true);
  };

  if (selectedGroup) {
    const freshGroup = groups.find(g => g.id === selectedGroup.id) || selectedGroup;
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4" data-testid="teams-group-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedGroup(null)} data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {freshGroup.groupType === "department" ? (
                <Building2 className="h-5 w-5 text-blue-600" />
              ) : (
                <FolderKanban className="h-5 w-5 text-green-600" />
              )}
              <h1 className="text-xl font-bold" data-testid="text-group-name">{freshGroup.name}</h1>
              <Badge variant="outline" className="text-xs">
                {freshGroup.groupType === "department" ? freshGroup.department : freshGroup.projectName}
              </Badge>
            </div>
            {freshGroup.description && (
              <p className="text-sm text-muted-foreground mt-1">{freshGroup.description}</p>
            )}
          </div>
          {freshGroup.canManage && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddMemberDialog(true)}
                data-testid="button-add-members"
              >
                <UserPlus className="h-4 w-4 mr-1" />
                Add Members
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm("Delete this group? This cannot be undone.")) {
                    deleteGroupMutation.mutate(freshGroup.id);
                  }
                }}
                data-testid="button-delete-group"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Messages
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="h-[400px] overflow-y-auto p-4 space-y-3" data-testid="messages-container">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">
                      No messages yet. Start the conversation!
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMe = msg.senderUserId === user?.id;
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                          data-testid={`message-${msg.id}`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-xs font-medium text-muted-foreground">
                              {isMe ? "You" : msg.userName || msg.senderName}
                            </span>
                            {msg.isFromTeams && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">Teams</Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground/60">
                              {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          <div
                            className={`rounded-xl px-3 py-2 max-w-[80%] text-sm group relative ${
                              isMe
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            {msg.content}
                            {!isMe && (
                              <button
                                className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                                onClick={() => handleCreateTask(msg)}
                                title="Create task from message"
                                data-testid={`button-msg-to-task-${msg.id}`}
                              >
                                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t p-3 flex gap-2">
                  <Input
                    placeholder="Type a message..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && messageText.trim()) {
                        e.preventDefault();
                        sendMessageMutation.mutate({ groupId: freshGroup.id, content: messageText });
                      }
                    }}
                    disabled={sendMessageMutation.isPending}
                    data-testid="input-message"
                  />
                  <Button
                    size="icon"
                    onClick={() => {
                      if (messageText.trim()) {
                        sendMessageMutation.mutate({ groupId: freshGroup.id, content: messageText });
                      }
                    }}
                    disabled={!messageText.trim() || sendMessageMutation.isPending}
                    data-testid="button-send-message"
                  >
                    {sendMessageMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Members ({freshGroup.memberCount})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                <div className="space-y-1 max-h-[350px] overflow-y-auto" data-testid="members-list">
                  {freshGroup.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50"
                      data-testid={`member-${m.userId}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                          {m.userName?.charAt(0) || "?"}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.userName}</p>
                          <p className="text-[10px] text-muted-foreground">{m.userRole}</p>
                        </div>
                        {m.role === "admin" && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">Admin</Badge>
                        )}
                      </div>
                      {freshGroup.canManage && m.userId !== user?.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMemberMutation.mutate({ groupId: freshGroup.id, userId: m.userId })}
                          data-testid={`button-remove-member-${m.userId}`}
                        >
                          <UserMinus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Dialog open={showAddMemberDialog} onOpenChange={setShowAddMemberDialog}>
          <DialogContent className="sm:max-w-md" data-testid="dialog-add-members">
            <DialogHeader>
              <DialogTitle>Add Members to {freshGroup.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select team members to add to this group.
              </p>
              <div className="max-h-[300px] overflow-y-auto space-y-1 border rounded-lg p-2">
                {allUsers
                  .filter(u => !freshGroup.members.some(m => m.userId === u.id))
                  .map(u => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer"
                      data-testid={`checkbox-user-${u.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedMembers.includes(u.id)}
                        onChange={(e) => {
                          setSelectedMembers(prev =>
                            e.target.checked
                              ? [...prev, u.id]
                              : prev.filter(id => id !== u.id)
                          );
                        }}
                        className="rounded"
                      />
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.role}</p>
                      </div>
                    </label>
                  ))}
              </div>
              {selectedMembers.length > 0 && (
                <p className="text-xs text-muted-foreground">{selectedMembers.length} selected</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowAddMemberDialog(false); setSelectedMembers([]); }}>
                Cancel
              </Button>
              <Button
                onClick={() => addMembersMutation.mutate({ groupId: freshGroup.id, userIds: selectedMembers })}
                disabled={selectedMembers.length === 0 || addMembersMutation.isPending}
                data-testid="button-confirm-add-members"
              >
                {addMembersMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-1" />
                )}
                Add {selectedMembers.length} Member{selectedMembers.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <CreateTaskFromSourceDialog
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
          source={taskSource}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="teams-chats-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <MessageSquare className="h-6 w-6 text-purple-600" />
            Teams Chat Groups
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Department and project group chats for team collaboration
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-group">
          <Plus className="h-4 w-4 mr-1" />
          New Group
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="groups-tabs">
        <TabsList>
          <TabsTrigger value="department" data-testid="tab-department">
            <Building2 className="h-4 w-4 mr-1.5" />
            Department Groups
          </TabsTrigger>
          <TabsTrigger value="project" data-testid="tab-project">
            <FolderKanban className="h-4 w-4 mr-1.5" />
            Project Groups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="department" className="mt-4" data-testid="tab-content-department">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : departmentGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <Building2 className="h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Department Groups</h3>
                <p className="text-muted-foreground text-center text-sm">
                  Create a department group to start team collaboration.
                </p>
                <Button variant="outline" onClick={() => { setNewGroupType("department"); setShowCreateDialog(true); }}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create Department Group
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {departmentGroups.map(g => renderGroupCard(g))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="project" className="mt-4" data-testid="tab-content-project">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : projectGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <FolderKanban className="h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Project Groups</h3>
                <p className="text-muted-foreground text-center text-sm">
                  Create a project group chat to coordinate with your team.
                </p>
                <Button variant="outline" onClick={() => { setNewGroupType("project"); setShowCreateDialog(true); }}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create Project Group
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {projectGroups.map(g => renderGroupCard(g))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={(v) => { setShowCreateDialog(v); if (!v) resetCreateForm(); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-create-group">
          <DialogHeader>
            <DialogTitle>Create Chat Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Group Type</Label>
              <Select value={newGroupType} onValueChange={setNewGroupType}>
                <SelectTrigger data-testid="select-group-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="department">Department Group</SelectItem>
                  <SelectItem value="project">Project Group</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Group Name</Label>
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder={newGroupType === "department" ? "e.g. Engineering Team" : "e.g. Coega Steels Team"}
                data-testid="input-group-name"
              />
            </div>

            {newGroupType === "department" && (
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={newGroupDept} onValueChange={setNewGroupDept}>
                  <SelectTrigger data-testid="select-department">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {newGroupType === "project" && (
              <div className="space-y-1.5">
                <Label>Project</Label>
                <Select value={newGroupProject} onValueChange={setNewGroupProject}>
                  <SelectTrigger data-testid="select-project">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProjects.map(p => (
                      <SelectItem key={p.project_name} value={p.project_name}>{p.project_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                rows={2}
                placeholder="Brief description of this group's purpose"
                data-testid="input-group-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetCreateForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                createGroupMutation.mutate({
                  name: newGroupName,
                  groupType: newGroupType,
                  department: newGroupType === "department" ? newGroupDept : null,
                  projectName: newGroupType === "project" ? newGroupProject : null,
                  description: newGroupDesc || null,
                });
              }}
              disabled={!newGroupName.trim() || createGroupMutation.isPending}
              data-testid="button-confirm-create-group"
            >
              {createGroupMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function renderGroupCard(g: ChatGroup) {
    return (
      <Card
        key={g.id}
        className="cursor-pointer hover:border-primary/30 transition-colors"
        onClick={() => setSelectedGroup(g)}
        data-testid={`group-card-${g.id}`}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                g.groupType === "department" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
              }`}>
                {g.groupType === "department" ? (
                  <Building2 className="h-5 w-5" />
                ) : (
                  <FolderKanban className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-sm truncate">{g.name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className="text-[10px]">
                    {g.groupType === "department" ? g.department : g.projectName}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                  </span>
                </div>
                {g.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{g.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {g.isMember && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">Joined</Badge>
              )}
              {g.canManage && (
                <Shield className="h-3.5 w-3.5 text-amber-500" />
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
}

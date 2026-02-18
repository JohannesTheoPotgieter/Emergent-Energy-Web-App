import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  Flag,
  Search,
  Shield,
  Loader2,
  Plus,
  Trash2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

interface TriageEmail {
  id: string;
  subject: string;
  sender: string | null;
  senderEmail: string | null;
  receivedAt: string;
  snippet: string | null;
  webLink: string | null;
  isRead: boolean;
  hasAttachments: boolean;
  flagStatus: string | null;
  matchedRule?: string;
  matchType?: string;
}

interface TriageRule {
  id: number;
  ruleType: string;
  value: string;
  enabled: boolean;
}

interface TriageInboxData {
  flagged: TriageEmail[];
  keywordMatches: TriageEmail[];
  senderMatches: TriageEmail[];
  rules: TriageRule[];
}

export default function TriageInboxPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("inbox");
  const [newRuleType, setNewRuleType] = useState("keyword");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [createTaskEmailId, setCreateTaskEmailId] = useState<string | null>(null);
  const [taskBucket, setTaskBucket] = useState("personal");
  const [taskProjectName, setTaskProjectName] = useState("");

  const { data: triageData, isLoading: triageLoading } = useQuery<TriageInboxData>({
    queryKey: ["/api/mytool/triage-inbox"],
    enabled: isAdmin,
  });

  const { data: triageRules = [], isLoading: rulesLoading } = useQuery<TriageRule[]>({
    queryKey: ["/api/mytool/triage-rules"],
    enabled: isAdmin,
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({ project_name: p.project_name })),
    enabled: isAdmin && taskBucket === "project",
  });

  const createTaskMutation = useMutation({
    mutationFn: (data: {
      outlookMessageId: string;
      subject: string;
      sender: string;
      receivedAt: string;
      snippet: string;
      webLink: string;
      targetType: string;
    }) => apiRequest("POST", "/api/outlook/email-to-task", data),
    onSuccess: () => {
      toast({ title: "Task created from email" });
      setCreateTaskEmailId(null);
      setTaskBucket("personal");
      setTaskProjectName("");
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-inbox"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to create task", description: err.message, variant: "destructive" }),
  });

  const createRuleMutation = useMutation({
    mutationFn: (data: { ruleType: string; value: string }) =>
      apiRequest("POST", "/api/mytool/triage-rules", data),
    onSuccess: () => {
      toast({ title: "Rule created" });
      setNewRuleValue("");
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-inbox"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to create rule", description: err.message, variant: "destructive" }),
  });

  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/mytool/triage-rules/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-inbox"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to update rule", description: err.message, variant: "destructive" }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/mytool/triage-rules/${id}`),
    onSuccess: () => {
      toast({ title: "Rule deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/triage-inbox"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to delete rule", description: err.message, variant: "destructive" }),
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="admin-access-required">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Shield className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Admin Access Required</h2>
            <p className="text-muted-foreground text-center">
              You need admin privileges to access the email triage inbox.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleCreateTask = (email: TriageEmail) => {
    createTaskMutation.mutate({
      outlookMessageId: email.id,
      subject: email.subject || "(No subject)",
      sender: email.sender || email.senderEmail || "",
      receivedAt: email.receivedAt,
      snippet: email.snippet?.slice(0, 200) || "",
      webLink: email.webLink || "",
      targetType: "new",
    });
  };

  const flagged = triageData?.flagged || [];
  const keywordMatches = triageData?.keywordMatches || [];
  const senderMatches = triageData?.senderMatches || [];
  const totalItems = flagged.length + keywordMatches.length + senderMatches.length;

  function renderEmailCard(email: TriageEmail, groupPrefix: string) {
    const isCreating = createTaskEmailId === email.id;
    return (
      <Card key={email.id} className="border-border/50" data-testid={`${groupPrefix}-email-${email.id}`}>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {!email.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                <h4 className="font-medium text-sm truncate" data-testid={`email-subject-${email.id}`}>
                  {email.subject || "(No subject)"}
                </h4>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5" data-testid={`email-sender-${email.id}`}>
                {email.sender || email.senderEmail || "Unknown sender"}
              </p>
              <p className="text-xs text-muted-foreground" data-testid={`email-time-${email.id}`}>
                {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}
              </p>
            </div>
            {email.matchedRule && (
              <Badge variant="outline" className="text-[10px] shrink-0" data-testid={`email-match-${email.id}`}>
                {email.matchType}: {email.matchedRule}
              </Badge>
            )}
          </div>
          {email.snippet && (
            <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`email-snippet-${email.id}`}>
              {email.snippet}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            {!isCreating ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setCreateTaskEmailId(email.id)}
                data-testid={`button-create-task-${email.id}`}
              >
                <Plus className="h-3 w-3 mr-1" />
                Create Task
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 w-full" data-testid={`task-form-${email.id}`}>
                <Select value={taskBucket} onValueChange={setTaskBucket}>
                  <SelectTrigger className="h-7 text-xs w-28" data-testid={`select-bucket-${email.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                    <SelectItem value="company_ops">Company Ops</SelectItem>
                  </SelectContent>
                </Select>
                {taskBucket === "project" && (
                  <Select value={taskProjectName} onValueChange={setTaskProjectName}>
                    <SelectTrigger className="h-7 text-xs w-40" data-testid={`select-project-${email.id}`}>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {allProjects.map((p) => (
                        <SelectItem key={p.project_name} value={p.project_name}>
                          {p.project_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={createTaskMutation.isPending}
                  onClick={() => handleCreateTask(email)}
                  data-testid={`button-confirm-task-${email.id}`}
                >
                  {createTaskMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setCreateTaskEmailId(null);
                    setTaskBucket("personal");
                    setTaskProjectName("");
                  }}
                  data-testid={`button-cancel-task-${email.id}`}
                >
                  Cancel
                </Button>
              </div>
            )}
            {email.webLink && (
              <a
                href={email.webLink}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`link-outlook-${email.id}`}
              >
                <Button size="sm" variant="ghost" className="h-7 text-xs">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open in Outlook
                </Button>
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="triage-inbox-page">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Email Triage Inbox</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="triage-tabs">
        <TabsList data-testid="triage-tabs-list">
          <TabsTrigger value="inbox" data-testid="tab-trigger-inbox">
            <Mail className="h-4 w-4 mr-1.5" />
            Triage Inbox
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-trigger-rules">
            <Shield className="h-4 w-4 mr-1.5" />
            Triage Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="space-y-6 mt-4" data-testid="tab-content-inbox">
          {triageLoading ? (
            <div className="flex items-center justify-center py-12" data-testid="triage-loading">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading triage items...</span>
            </div>
          ) : totalItems === 0 ? (
            <Card data-testid="triage-empty">
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <Mail className="h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Triage Items</h3>
                <p className="text-muted-foreground text-center text-sm">
                  No emails match your triage rules. Add rules in the Triage Rules tab to start monitoring.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {flagged.length > 0 && (
                <div className="space-y-3" data-testid="group-flagged">
                  <div className="flex items-center gap-2">
                    <Flag className="h-4 w-4 text-red-500" />
                    <h2 className="text-lg font-semibold">Flagged Emails</h2>
                    <Badge variant="secondary" className="text-xs">{flagged.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {flagged.map((email) => renderEmailCard(email, "flagged"))}
                  </div>
                </div>
              )}

              {keywordMatches.length > 0 && (
                <div className="space-y-3" data-testid="group-keyword">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-amber-500" />
                    <h2 className="text-lg font-semibold">Keyword Matches</h2>
                    <Badge variant="secondary" className="text-xs">{keywordMatches.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {keywordMatches.map((email) => renderEmailCard(email, "keyword"))}
                  </div>
                </div>
              )}

              {senderMatches.length > 0 && (
                <div className="space-y-3" data-testid="group-sender">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-blue-500" />
                    <h2 className="text-lg font-semibold">Sender/Domain Matches</h2>
                    <Badge variant="secondary" className="text-xs">{senderMatches.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {senderMatches.map((email) => renderEmailCard(email, "sender"))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="rules" className="space-y-6 mt-4" data-testid="tab-content-rules">
          <Card data-testid="add-rule-card">
            <CardHeader>
              <CardTitle className="text-base">Add New Rule</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3" data-testid="add-rule-form">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Type</label>
                  <Select value={newRuleType} onValueChange={setNewRuleType}>
                    <SelectTrigger className="w-36" data-testid="select-rule-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">Keyword</SelectItem>
                      <SelectItem value="sender">Sender</SelectItem>
                      <SelectItem value="domain">Domain</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs text-muted-foreground">Value</label>
                  <Input
                    placeholder={
                      newRuleType === "keyword"
                        ? "e.g. invoice, urgent"
                        : newRuleType === "sender"
                          ? "e.g. john@example.com"
                          : "e.g. example.com"
                    }
                    value={newRuleValue}
                    onChange={(e) => setNewRuleValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newRuleValue.trim()) {
                        createRuleMutation.mutate({ ruleType: newRuleType, value: newRuleValue.trim() });
                      }
                    }}
                    data-testid="input-rule-value"
                  />
                </div>
                <Button
                  onClick={() => {
                    if (newRuleValue.trim()) {
                      createRuleMutation.mutate({ ruleType: newRuleType, value: newRuleValue.trim() });
                    }
                  }}
                  disabled={!newRuleValue.trim() || createRuleMutation.isPending}
                  data-testid="button-add-rule"
                >
                  {createRuleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Rule
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="rules-list-card">
            <CardHeader>
              <CardTitle className="text-base">Existing Rules</CardTitle>
            </CardHeader>
            <CardContent>
              {rulesLoading ? (
                <div className="flex items-center justify-center py-8" data-testid="rules-loading">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : triageRules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="rules-empty">
                  No triage rules yet. Add one above to start monitoring emails.
                </div>
              ) : (
                <div className="space-y-2" data-testid="rules-list">
                  {triageRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border/50"
                      data-testid={`rule-item-${rule.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={
                            rule.ruleType === "keyword"
                              ? "default"
                              : rule.ruleType === "sender"
                                ? "secondary"
                                : "outline"
                          }
                          className="text-xs"
                          data-testid={`rule-type-badge-${rule.id}`}
                        >
                          {rule.ruleType}
                        </Badge>
                        <span className="text-sm font-medium" data-testid={`rule-value-${rule.id}`}>
                          {rule.value}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(checked) =>
                            toggleRuleMutation.mutate({ id: rule.id, enabled: checked })
                          }
                          data-testid={`switch-rule-${rule.id}`}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => deleteRuleMutation.mutate(rule.id)}
                          disabled={deleteRuleMutation.isPending}
                          data-testid={`button-delete-rule-${rule.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
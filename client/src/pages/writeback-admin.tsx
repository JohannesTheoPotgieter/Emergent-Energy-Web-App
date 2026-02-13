import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Plus, Pencil, Trash2, Play, Eye, RotateCcw, FileSpreadsheet,
  AlertCircle, CheckCircle, Clock, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

interface WritebackMapping {
  id: number;
  name: string;
  projectName: string | null;
  workbookPath: string;
  sheetName: string;
  cellAddress: string;
  sourceField: string;
  entityType: string;
  dataTransform: string | null;
  validationRule: string | null;
  allowedRoles: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface AuditEntry {
  id: number;
  mappingId: number | null;
  workbookPath: string;
  sheetName: string;
  cellAddress: string;
  previousValue: string | null;
  newValue: string;
  status: string;
  projectId: string | null;
  actorId: number | null;
  errorMessage: string | null;
  appliedAt: string;
  rolledBackAt: string | null;
}

const ENTITY_TYPES = ["project", "expense", "inflow", "plan"];
const TRANSFORMS = ["none", "number", "currency", "percentage", "date", "uppercase", "lowercase"];
const VALIDATIONS = ["none", "required", "numeric", "positive", "date"];

function MappingForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: WritebackMapping;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    projectName: initial?.projectName || "",
    workbookPath: initial?.workbookPath || "",
    sheetName: initial?.sheetName || "",
    cellAddress: initial?.cellAddress || "",
    sourceField: initial?.sourceField || "",
    entityType: initial?.entityType || "project",
    dataTransform: initial?.dataTransform || "",
    validationRule: initial?.validationRule || "",
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Mapping Name</Label>
          <Input
            data-testid="input-mapping-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Project Status Update"
          />
        </div>
        <div>
          <Label>Project (optional)</Label>
          <Input
            data-testid="input-project-name"
            value={form.projectName}
            onChange={(e) => setForm({ ...form, projectName: e.target.value })}
            placeholder="Leave blank for all projects"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Workbook Path</Label>
          <Input
            data-testid="input-workbook-path"
            value={form.workbookPath}
            onChange={(e) => setForm({ ...form, workbookPath: e.target.value })}
            placeholder="uploads/tracker.xlsx"
          />
        </div>
        <div>
          <Label>Sheet Name</Label>
          <Input
            data-testid="input-sheet-name"
            value={form.sheetName}
            onChange={(e) => setForm({ ...form, sheetName: e.target.value })}
            placeholder="e.g. Summary"
          />
        </div>
        <div>
          <Label>Cell Address</Label>
          <Input
            data-testid="input-cell-address"
            value={form.cellAddress}
            onChange={(e) => setForm({ ...form, cellAddress: e.target.value })}
            placeholder="e.g. B5"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Entity Type</Label>
          <Select value={form.entityType} onValueChange={(v) => setForm({ ...form, entityType: v })}>
            <SelectTrigger data-testid="select-entity-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Source Field</Label>
          <Input
            data-testid="input-source-field"
            value={form.sourceField}
            onChange={(e) => setForm({ ...form, sourceField: e.target.value })}
            placeholder="e.g. totalBudget, status"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Data Transform</Label>
          <Select
            value={form.dataTransform || "none"}
            onValueChange={(v) => setForm({ ...form, dataTransform: v === "none" ? "" : v })}
          >
            <SelectTrigger data-testid="select-transform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSFORMS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Validation Rule</Label>
          <Select
            value={form.validationRule || "none"}
            onValueChange={(v) => setForm({ ...form, validationRule: v === "none" ? "" : v })}
          >
            <SelectTrigger data-testid="select-validation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALIDATIONS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-mapping">Cancel</Button>
        <Button
          onClick={() => onSave({
            ...form,
            dataTransform: form.dataTransform || null,
            validationRule: form.validationRule || null,
            projectName: form.projectName || null,
          })}
          disabled={!form.name || !form.workbookPath || !form.sheetName || !form.cellAddress || !form.sourceField}
          data-testid="button-save-mapping"
        >
          {initial ? "Update" : "Create"} Mapping
        </Button>
      </div>
    </div>
  );
}

export default function WritebackAdminPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("mappings");
  const [editingMapping, setEditingMapping] = useState<WritebackMapping | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [previewWorkbook, setPreviewWorkbook] = useState("");
  const [previewResults, setPreviewResults] = useState<any[] | null>(null);
  const [executeWorkbook, setExecuteWorkbook] = useState("");

  const { data: mappings = [], isLoading: loadingMappings } = useQuery<WritebackMapping[]>({
    queryKey: ["/api/writeback-mappings"],
  });

  const { data: auditLogs = [], isLoading: loadingAudit } = useQuery<AuditEntry[]>({
    queryKey: ["/api/writeback-audit"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/writeback-mappings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/writeback-mappings"] });
      setShowCreateForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/writeback-mappings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/writeback-mappings"] });
      setEditingMapping(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/writeback-mappings/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/writeback-mappings"] }),
  });

  const previewMutation = useMutation({
    mutationFn: (workbookPath: string) =>
      apiRequest("POST", "/api/writeback/preview", { workbookPath }).then((r) => r.json()),
    onSuccess: (data) => setPreviewResults(data),
  });

  const executeMutation = useMutation({
    mutationFn: (workbookPath: string) =>
      apiRequest("POST", "/api/writeback/execute", { workbookPath }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/writeback-audit"] });
      setActiveTab("audit");
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: (auditId: number) =>
      apiRequest("POST", `/api/writeback/rollback/${auditId}`).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/writeback-audit"] }),
  });

  const uniqueWorkbooks = Array.from(new Set(mappings.map((m) => m.workbookPath)));

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">You do not have admin privileges to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/admin">
              <Button variant="ghost" size="sm" data-testid="button-back-admin">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
                <FileSpreadsheet className="h-6 w-6" />
                Excel Writeback Manager
              </h1>
              <p className="text-sm text-muted-foreground">
                Configure cell mappings to write dashboard data back to Excel workbooks
              </p>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-writeback">
            <TabsTrigger value="mappings" data-testid="tab-mappings">
              Mappings ({mappings.length})
            </TabsTrigger>
            <TabsTrigger value="execute" data-testid="tab-execute">
              Execute
            </TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit">
              Audit Log ({auditLogs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mappings" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-mapping">
                    <Plus className="h-4 w-4 mr-1" /> New Mapping
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create Writeback Mapping</DialogTitle>
                  </DialogHeader>
                  <MappingForm
                    onSave={(data) => createMutation.mutate(data)}
                    onCancel={() => setShowCreateForm(false)}
                  />
                </DialogContent>
              </Dialog>
            </div>

            {loadingMappings ? (
              <div className="text-center py-8 text-muted-foreground">Loading mappings...</div>
            ) : mappings.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>No writeback mappings configured yet.</p>
                  <p className="text-sm mt-1">Create a mapping to define how dashboard data maps to Excel cells.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Workbook</TableHead>
                      <TableHead>Sheet</TableHead>
                      <TableHead>Cell</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Transform</TableHead>
                      <TableHead className="w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((m) => (
                      <TableRow key={m.id} data-testid={`row-mapping-${m.id}`}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>{m.projectName || <span className="text-muted-foreground">All</span>}</TableCell>
                        <TableCell className="text-xs font-mono max-w-[150px] truncate">{m.workbookPath}</TableCell>
                        <TableCell>{m.sheetName}</TableCell>
                        <TableCell className="font-mono">{m.cellAddress}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{m.entityType}</Badge>
                          <span className="ml-1 text-xs">.{m.sourceField}</span>
                        </TableCell>
                        <TableCell>
                          {m.dataTransform && <Badge variant="secondary">{m.dataTransform}</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setEditingMapping(m)}
                                  data-testid={`button-edit-${m.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Edit Mapping</DialogTitle>
                                </DialogHeader>
                                {editingMapping && editingMapping.id === m.id && (
                                  <MappingForm
                                    initial={editingMapping}
                                    onSave={(data) => updateMutation.mutate({ id: m.id, data })}
                                    onCancel={() => setEditingMapping(null)}
                                  />
                                )}
                              </DialogContent>
                            </Dialog>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("Delete this mapping?")) deleteMutation.mutate(m.id);
                              }}
                              data-testid={`button-delete-${m.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="execute" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5" /> Execute Writeback
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Select Workbook</Label>
                  {uniqueWorkbooks.length > 0 ? (
                    <Select value={executeWorkbook} onValueChange={setExecuteWorkbook}>
                      <SelectTrigger data-testid="select-execute-workbook">
                        <SelectValue placeholder="Choose a workbook..." />
                      </SelectTrigger>
                      <SelectContent>
                        {uniqueWorkbooks.map((wb) => (
                          <SelectItem key={wb} value={wb}>{wb}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">No workbooks configured. Create mappings first.</p>
                  )}
                </div>

                {executeWorkbook && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPreviewWorkbook(executeWorkbook);
                        previewMutation.mutate(executeWorkbook);
                      }}
                      disabled={previewMutation.isPending}
                      data-testid="button-preview-writeback"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      {previewMutation.isPending ? "Loading..." : "Preview Changes"}
                    </Button>
                    <Button
                      onClick={() => {
                        if (confirm("This will write data to the Excel file. Continue?")) {
                          executeMutation.mutate(executeWorkbook);
                        }
                      }}
                      disabled={executeMutation.isPending}
                      data-testid="button-execute-writeback"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      {executeMutation.isPending ? "Writing..." : "Execute Writeback"}
                    </Button>
                  </div>
                )}

                {executeMutation.isSuccess && executeMutation.data && (
                  <div className="mt-4 p-4 rounded border bg-green-50 border-green-200">
                    <div className="flex items-center gap-2 text-green-700 font-medium">
                      <CheckCircle className="h-4 w-4" />
                      Writeback completed successfully
                    </div>
                    <p className="text-sm text-green-600 mt-1">
                      Output: {executeMutation.data.outputPath}
                    </p>
                  </div>
                )}

                {executeMutation.isError && (
                  <div className="mt-4 p-4 rounded border bg-red-50 border-red-200">
                    <div className="flex items-center gap-2 text-red-700 font-medium">
                      <AlertCircle className="h-4 w-4" />
                      Writeback failed
                    </div>
                  </div>
                )}

                {previewResults && previewResults.length > 0 && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle className="text-sm">Preview: {previewWorkbook}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Mapping</TableHead>
                            <TableHead>Sheet</TableHead>
                            <TableHead>Cell</TableHead>
                            <TableHead>Current Value</TableHead>
                            <TableHead>New Value</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewResults.map((p: any, i: number) => (
                            <TableRow key={i} data-testid={`row-preview-${i}`}>
                              <TableCell className="font-medium">{p.mappingName}</TableCell>
                              <TableCell>{p.sheetName}</TableCell>
                              <TableCell className="font-mono">{p.cellAddress}</TableCell>
                              <TableCell className="text-muted-foreground">{p.currentValue ?? "—"}</TableCell>
                              <TableCell className={p.willChange ? "font-medium text-blue-600" : ""}>
                                {p.newValue ?? "—"}
                              </TableCell>
                              <TableCell>
                                {p.error ? (
                                  <Badge variant="destructive">{p.error}</Badge>
                                ) : p.willChange ? (
                                  <Badge className="bg-blue-100 text-blue-700">Will Change</Badge>
                                ) : (
                                  <Badge variant="secondary">No Change</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" /> Audit Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingAudit ? (
                  <div className="text-center py-8 text-muted-foreground">Loading audit log...</div>
                ) : auditLogs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No writeback operations recorded yet.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Workbook</TableHead>
                        <TableHead>Sheet</TableHead>
                        <TableHead>Cell</TableHead>
                        <TableHead>Previous</TableHead>
                        <TableHead>New</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLogs.map((log) => (
                        <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                          <TableCell className="text-xs">
                            {new Date(log.appliedAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs font-mono max-w-[120px] truncate">
                            {log.workbookPath}
                          </TableCell>
                          <TableCell>{log.sheetName}</TableCell>
                          <TableCell className="font-mono">{log.cellAddress}</TableCell>
                          <TableCell className="text-muted-foreground">{log.previousValue ?? "—"}</TableCell>
                          <TableCell className="font-medium">{log.newValue}</TableCell>
                          <TableCell>
                            {log.status === "applied" && !log.rolledBackAt && (
                              <Badge className="bg-green-100 text-green-700">Applied</Badge>
                            )}
                            {log.status === "applied" && log.rolledBackAt && (
                              <Badge variant="outline">Rolled Back</Badge>
                            )}
                            {log.status === "failed" && (
                              <Badge variant="destructive">Failed</Badge>
                            )}
                            {log.status === "skipped" && (
                              <Badge variant="secondary">Skipped</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {log.status === "applied" && !log.rolledBackAt && log.previousValue !== null && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm("Rollback this change? The previous value will be restored.")) {
                                    rollbackMutation.mutate(log.id);
                                  }
                                }}
                                disabled={rollbackMutation.isPending}
                                data-testid={`button-rollback-${log.id}`}
                              >
                                <RotateCcw className="h-4 w-4 mr-1" />
                                Rollback
                              </Button>
                            )}
                            {log.errorMessage && (
                              <span className="text-xs text-red-500" title={log.errorMessage}>
                                <AlertCircle className="h-3 w-3 inline" />
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

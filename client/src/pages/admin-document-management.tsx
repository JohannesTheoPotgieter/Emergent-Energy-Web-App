/**
 * D6 — Document Management admin (approval requirements + SharePoint root).
 *
 * Super-user only. Mounted at /admin/document-management. Lets COO/CEO
 * (or any user with the documents_admin permission) edit the approval
 * requirements that attach to bound discipline folders, and configure the
 * company "Active Projects" SharePoint root used by the browse-and-bind flow.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { SharepointRootPicker, type PickedRoot } from "@/components/admin/SharepointRootPicker";
import { RequirementDialog } from "@/components/documents/RequirementDialog";
import {
  useApprovalRequirements,
  useCompanySharepointRoots,
  useUpsertCompanyRoot,
  useTestCompanyRoot,
  type CompanySharepointRoot,
  type CompanyRootTestResult,
} from "@/hooks/use-document-management-admin";
import { isSuperAdmin } from "@/lib/access-control";
import type { DocumentApprovalRequirement } from "@shared/schema";
import {
  Plus, Pencil, AlertTriangle, FolderTree, ShieldCheck, Loader2,
  RefreshCw, CheckCircle2,
} from "lucide-react";

export default function AdminDocumentManagementPage() {
  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  if (!isSuperAdmin(tokenRole, companyRole)) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Document Management Administration"
            subtitle="Approval requirements + SharePoint root"
          />
        }
      >
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
            <p className="text-sm font-medium">
              Only COO and CEO admins can edit document management settings.
            </p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Document Management Administration"
          subtitle="Approval requirements + the Active Projects SharePoint root"
        />
      }
    >
      <Tabs defaultValue="requirements" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="requirements" data-testid="tab-doc-requirements">
            <ShieldCheck className="h-4 w-4 mr-2" />
            Approval requirements
          </TabsTrigger>
          <TabsTrigger value="sharepoint" data-testid="tab-doc-sharepoint">
            <FolderTree className="h-4 w-4 mr-2" />
            SharePoint root
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requirements" className="mt-4">
          <RequirementsTab />
        </TabsContent>

        <TabsContent value="sharepoint" className="mt-4">
          <SharepointRootTab />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

// =========================================================================
// Approval requirements tab
// =========================================================================

function RequirementsTab() {
  const { data, isLoading, error } = useApprovalRequirements();

  const [editing, setEditing] = useState<DocumentApprovalRequirement | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => data?.requirements ?? [], [data]);
  const activeCount = rows.filter((r) => r.active).length;

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load approval requirements" />;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {activeCount} active · {rows.length - activeCount} inactive
          </div>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setCreating(true)}
            data-testid="btn-add-requirement"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add requirement
          </Button>
        </div>

        <Table data-testid="requirements-table">
          <TableHeader>
            <TableRow>
              <TableHead>Target</TableHead>
              <TableHead>File pattern</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Approver roles</TableHead>
              <TableHead className="text-center">All required</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid={`requirement-row-${r.id}`}>
                <TableCell className="text-xs">
                  {r.discipline ? (
                    <span className="inline-flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px]">{r.discipline}</Badge>
                      {r.subfolderPattern ? <span className="font-mono text-muted-foreground">/{r.subfolderPattern}</span> : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.fileNamePattern ?? "(any file)"}</TableCell>
                <TableCell className="text-sm font-medium">{r.displayName}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(r.approverRoles ?? []).map((role) => (
                      <Badge key={role} variant="outline" className="text-[10px]">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {r.requiresAllApprovers ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
                      All
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Any one</Badge>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {r.active ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-muted">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditing(r)}
                    data-testid={`btn-edit-requirement-${r.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No approval requirements configured.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {creating && (
        <RequirementDialog
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <RequirementDialog
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

// =========================================================================
// SharePoint root tab
// =========================================================================

function SharepointRootTab() {
  const companyRoots = useCompanySharepointRoots();
  const activeProjectsRoot = (companyRoots.data?.roots ?? []).find(
    (r) => r.kind === "active_projects",
  );

  return (
    <div className="space-y-4">
      <CompanyRootCard root={activeProjectsRoot} isLoading={companyRoots.isLoading} />
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Project document folders are connected per discipline from each project's documents page
          using the browse-and-bind picker. There is no bulk provisioning step — bind the SharePoint
          folder for each discipline directly where you work.
        </CardContent>
      </Card>
    </div>
  );
}

function CompanyRootCard(props: {
  root: CompanySharepointRoot | undefined;
  isLoading: boolean;
}) {
  const { root, isLoading } = props;
  const upsert = useUpsertCompanyRoot();
  const testRoot = useTestCompanyRoot();
  const [testResult, setTestResult] = useState<CompanyRootTestResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState({
    displayName: "Active Projects",
    rootPath: "01 - Clients/01 - active projects (1)",
    driveId: "",
    rootItemId: "",
  });

  const configured = Boolean(root?.driveId);

  function startEdit() {
    if (root) {
      setForm({
        displayName: root.displayName,
        rootPath: root.rootPath,
        driveId: root.driveId ?? "",
        rootItemId: root.rootItemId ?? "",
      });
    }
    setTestResult(null);
    setEditing(true);
  }

  function patchForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((s) => ({ ...s, [key]: value }));
    setTestResult(null);
  }

  function handlePicked(picked: PickedRoot) {
    setForm((s) => ({
      ...s,
      driveId: picked.driveId,
      rootItemId: picked.rootItemId,
      rootPath: picked.rootPath || s.rootPath,
      displayName: s.displayName.trim() ? s.displayName : picked.displayName,
    }));
    setTestResult(null);
    setEditing(true);
    toast({
      title: "SharePoint folder selected",
      description: `${picked.driveName}${picked.rootPath ? `/${picked.rootPath}` : ""} — review and Save.`,
    });
  }

  async function save() {
    try {
      await upsert.mutateAsync({
        kind: "active_projects",
        displayName: form.displayName,
        driveId: form.driveId.trim() || null,
        rootItemId: form.rootItemId.trim() || null,
        rootPath: form.rootPath,
      });
      toast({ title: "Saved", description: "Active Projects root updated." });
      setEditing(false);
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function testConnection() {
    if (!form.driveId.trim()) {
      toast({
        title: "Drive ID required",
        description: "Paste the Graph drive ID before testing this SharePoint root.",
        variant: "destructive",
      });
      return;
    }
    try {
      const result = await testRoot.mutateAsync({
        kind: "active_projects",
        driveId: form.driveId.trim() || null,
        rootItemId: form.rootItemId.trim() || null,
        rootPath: form.rootPath.trim() || null,
      });
      setTestResult(result);
      toast({
        title: result.ok ? "SharePoint root reachable" : "SharePoint root test failed",
        description: result.ok
          ? `${result.rootName ?? "Root"} returned ${result.childCount ?? 0} item${(result.childCount ?? 0) === 1 ? "" : "s"}.`
          : result.nextAction ?? result.message ?? "Check the SharePoint configuration.",
        variant: result.ok ? undefined : "destructive",
      });
    } catch (err) {
      toast({
        title: "SharePoint root test failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Card data-testid="active-projects-root-card">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Active Projects SharePoint root</h3>
          {isLoading ? (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Loading…
            </Badge>
          ) : configured ? (
            <Badge
              variant="outline"
              className="ml-auto text-[10px] bg-emerald-50 text-emerald-700"
              data-testid="active-projects-root-status"
            >
              Configured
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="ml-auto text-[10px] bg-amber-50 text-amber-800"
              data-testid="active-projects-root-status"
            >
              Not configured — provisioning blocked
            </Badge>
          )}
        </div>

        {!editing ? (
          <>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>
                <span className="font-medium">Path:</span>{" "}
                <span className="font-mono">{root?.rootPath ?? "—"}</span>
              </div>
              <div>
                <span className="font-medium">Drive ID:</span>{" "}
                <span className="font-mono">{root?.driveId ?? "—"}</span>
              </div>
              <div>
                <span className="font-medium">Root item ID:</span>{" "}
                <span className="font-mono">{root?.rootItemId ?? "—"}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setPickerOpen(true)}
                data-testid="btn-browse-active-projects-root"
              >
                <FolderTree className="h-3.5 w-3.5 mr-1" />
                Browse SharePoint
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={startEdit}
                data-testid="btn-edit-active-projects-root"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                {configured ? "Edit" : "Configure"}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Display name</Label>
                <Input
                  value={form.displayName}
                  onChange={(e) => patchForm("displayName", e.target.value)}
                  data-testid="input-active-projects-root-display-name"
                />
              </div>
              <div className="space-y-1">
                <Label>SharePoint path</Label>
                <Input
                  value={form.rootPath}
                  onChange={(e) => patchForm("rootPath", e.target.value)}
                  data-testid="input-active-projects-root-path"
                />
              </div>
              <div className="space-y-1">
                <Label>Graph drive ID</Label>
                <Input
                  value={form.driveId}
                  onChange={(e) => patchForm("driveId", e.target.value)}
                  placeholder="b!xxxxxx..."
                  data-testid="input-active-projects-root-drive-id"
                />
              </div>
              <div className="space-y-1">
                <Label>Graph item ID (parent folder)</Label>
                <Input
                  value={form.rootItemId}
                  onChange={(e) => patchForm("rootItemId", e.target.value)}
                  placeholder="01XXXXXXXXXXXXX..."
                  data-testid="input-active-projects-root-item-id"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Easiest: use <strong>Browse SharePoint</strong> to pick the folder and fill these in
              automatically. In dev (mock connector), placeholder IDs are auto-seeded.
            </p>
            {testResult && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-rose-200 bg-rose-50 text-rose-900"
                }`}
                data-testid="active-projects-root-test-result"
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  {testResult.ok ? "Connection OK" : "Connection failed"}
                  {!testResult.ok && testResult.failureCategory ? ` · ${testResult.failureCategory}` : ""}
                </div>
                {testResult.ok ? (
                  <p className="mt-1 text-emerald-800">
                    {testResult.rootName ?? "Root"} reachable · {testResult.childCount ?? 0} item{(testResult.childCount ?? 0) === 1 ? "" : "s"} found.
                  </p>
                ) : (
                  <>
                    {testResult.message && <p className="mt-1">{testResult.message}</p>}
                    {testResult.nextAction && (
                      <p className="mt-1 text-rose-700">{testResult.nextAction}</p>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={testConnection}
                disabled={testRoot.isPending || !form.driveId.trim()}
                data-testid="btn-test-active-projects-root"
              >
                {testRoot.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                Test
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={upsert.isPending}
                data-testid="btn-save-active-projects-root"
              >
                {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <SharepointRootPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handlePicked}
        />
      </CardContent>
    </Card>
  );
}

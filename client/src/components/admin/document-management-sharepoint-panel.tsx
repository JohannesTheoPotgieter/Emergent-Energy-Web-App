import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderTree,
  HardDriveUpload,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useCompanySharepointRoots,
  useTestCompanyRoot,
  useUpsertCompanyRoot,
  type CompanyRootTestResult,
} from "@/hooks/use-document-management-admin";
import { useDocumentRoots } from "@/components/documents/use-documents";

const ACTIVE_PROJECTS_KIND = "active_projects";
const DEFAULT_DISPLAY_NAME = "Active Projects";
const DEFAULT_ROOT_PATH = "01 - Clients/01 - active projects (1)";

interface RootForm {
  displayName: string;
  rootPath: string;
  driveId: string;
  rootItemId: string;
}

function defaultForm(): RootForm {
  return {
    displayName: DEFAULT_DISPLAY_NAME,
    rootPath: DEFAULT_ROOT_PATH,
    driveId: "",
    rootItemId: "",
  };
}

function rootStatusBadge(configured: boolean, verified: boolean) {
  if (verified) {
    return <Badge className="bg-emerald-600">Verified</Badge>;
  }
  if (configured) {
    return <Badge variant="outline" className="bg-amber-50 text-amber-800">Configured - test needed</Badge>;
  }
  return <Badge variant="outline" className="bg-rose-50 text-rose-800">Not configured</Badge>;
}

function StatusLine({
  ok,
  label,
  helper,
}: {
  ok: boolean;
  label: string;
  helper: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{helper}</div>
      </div>
    </div>
  );
}

function DocumentSurfaceCard({
  title,
  description,
  href,
  testId,
  icon,
  ready,
}: {
  title: string;
  description: string;
  href: string;
  testId: string;
  icon: "engineering" | "quality";
  ready: boolean;
}) {
  const Icon = icon === "quality" ? ShieldCheck : FolderTree;
  return (
    <div className="rounded-lg border bg-muted/20 p-3" data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-background p-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {ready ? (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700">Ready</Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-50 text-amber-800">Needs setup</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
              <Link href={href}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RootTestResultPanel({ result }: { result: CompanyRootTestResult }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-rose-200 bg-rose-50 text-rose-900"
      }`}
      data-testid="integration-active-projects-root-test-result"
    >
      <div className="flex items-center gap-1.5 font-medium">
        {result.ok ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" />
        )}
        {result.ok ? "Connection OK" : "Connection failed"}
        {!result.ok && result.failureCategory ? ` - ${result.failureCategory}` : ""}
      </div>
      {result.ok ? (
        <div className="mt-1 space-y-1">
          <p>
            {result.rootName ?? "Root"} reachable. {result.childCount ?? 0} item
            {(result.childCount ?? 0) === 1 ? "" : "s"} found.
          </p>
          {result.firstFiveChildren && result.firstFiveChildren.length > 0 && (
            <p className="text-emerald-800">
              First items: {result.firstFiveChildren.map((item) => item.name).join(", ")}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-1 space-y-1">
          {result.message && <p>{result.message}</p>}
          {result.nextAction && <p className="text-rose-700">{result.nextAction}</p>}
        </div>
      )}
    </div>
  );
}

export function DocumentManagementSharePointPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const companyRoots = useCompanySharepointRoots();
  const documentRoots = useDocumentRoots();
  const upsertRoot = useUpsertCompanyRoot();
  const testRoot = useTestCompanyRoot();
  const [form, setForm] = useState<RootForm>(() => defaultForm());
  const [testResult, setTestResult] = useState<CompanyRootTestResult | null>(null);

  const activeProjectsRoot = useMemo(
    () => companyRoots.data?.roots.find((root) => root.kind === ACTIVE_PROJECTS_KIND),
    [companyRoots.data],
  );

  const savedForm = useMemo<RootForm>(() => ({
    displayName: activeProjectsRoot?.displayName ?? DEFAULT_DISPLAY_NAME,
    rootPath: activeProjectsRoot?.rootPath ?? DEFAULT_ROOT_PATH,
    driveId: activeProjectsRoot?.driveId ?? "",
    rootItemId: activeProjectsRoot?.rootItemId ?? "",
  }), [activeProjectsRoot]);

  useEffect(() => {
    setForm(savedForm);
    setTestResult(null);
  }, [savedForm]);

  const configured = Boolean(activeProjectsRoot?.driveId);
  const verified = Boolean(testResult?.ok);
  const companyRootCount = documentRoots.data?.company.length ?? 0;
  const browserRootsLoaded = Boolean(documentRoots.data) && !documentRoots.error;
  // Project document surfaces are folder-keyed (provisioned per project); the
  // shared Active Projects root being configured is the readiness signal here.
  const documentSurfacesReady = configured;
  const dirty =
    form.displayName !== savedForm.displayName ||
    form.rootPath !== savedForm.rootPath ||
    form.driveId !== savedForm.driveId ||
    form.rootItemId !== savedForm.rootItemId;

  function patchForm<K extends keyof RootForm>(key: K, value: RootForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setTestResult(null);
  }

  async function handleSave() {
    if (!form.displayName.trim() || !form.rootPath.trim()) {
      toast({
        title: "Display name and path are required",
        description: "Add the Active Projects display name and SharePoint path before saving.",
        variant: "destructive",
      });
      return;
    }

    try {
      await upsertRoot.mutateAsync({
        kind: ACTIVE_PROJECTS_KIND,
        displayName: form.displayName.trim(),
        driveId: form.driveId.trim() || null,
        rootItemId: form.rootItemId.trim() || null,
        rootPath: form.rootPath.trim(),
        sortOrder: 0,
        active: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["documents", "roots"] });
      toast({ title: "Document SharePoint root saved" });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleTest() {
    if (!form.driveId.trim()) {
      toast({
        title: "Drive ID required",
        description: "Paste the SharePoint document-library Drive ID before testing.",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await testRoot.mutateAsync({
        kind: ACTIVE_PROJECTS_KIND,
        driveId: form.driveId.trim() || null,
        rootItemId: form.rootItemId.trim() || null,
        rootPath: form.rootPath.trim() || null,
      });
      setTestResult(result);
      toast({
        title: result.ok ? "Document SharePoint root reachable" : "Document SharePoint root failed",
        description: result.ok
          ? `${result.rootName ?? "Root"} returned ${result.childCount ?? 0} item${(result.childCount ?? 0) === 1 ? "" : "s"}.`
          : result.nextAction ?? result.message ?? "Check the SharePoint root configuration.",
        variant: result.ok ? undefined : "destructive",
      });
    } catch (err) {
      toast({
        title: "Document SharePoint root test failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Card data-testid="document-management-sharepoint-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <HardDriveUpload className="h-5 w-5 text-emerald-600" />
              Engineering & Quality Document Management
              {rootStatusBadge(configured, verified)}
            </CardTitle>
            <CardDescription className="mt-1">
              Maintain the shared Active Clients SharePoint root used by the Engineering and
              Quality document browsers. Test it here before provisioning project folders.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void companyRoots.refetch();
              void documentRoots.refetch();
            }}
            data-testid="btn-integration-refresh-document-roots"
            aria-label="Refresh document management SharePoint status"
          >
            <RefreshCw className={`h-4 w-4 ${companyRoots.isFetching || documentRoots.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DocumentSurfaceCard
            title="Engineering Document Management"
            description="Drawings, specs, NCR evidence and calibration certificates."
            href="/engineering/documents"
            testId="integration-engineering-documents-card"
            icon="engineering"
            ready={documentSurfacesReady}
          />
          <DocumentSurfaceCard
            title="Quality Document Management"
            description="NCR evidence, ITP sign-offs, audit reports and commissioning packs."
            href="/quality/documents"
            testId="integration-quality-documents-card"
            icon="quality"
            ready={documentSurfacesReady}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <StatusLine
            ok={configured}
            label="Active Projects root"
            helper={configured ? "Drive ID is saved." : "Paste the Drive ID and folder item ID below."}
          />
          <StatusLine
            ok={browserRootsLoaded}
            label="Browser roots"
            helper={
              browserRootsLoaded
                ? `${companyRootCount} company root${companyRootCount === 1 ? "" : "s"} visible.`
                : "The document browser roots endpoint could not be loaded."
            }
          />
        </div>

        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Shared Active Projects SharePoint root</h3>
            <Button asChild size="sm" variant="outline" className="ml-auto">
              <Link href="/admin/document-management">
                <FolderTree className="h-3.5 w-3.5" />
                Taxonomy & provisioning
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="integration-active-projects-root-display-name">Display name</Label>
              <Input
                id="integration-active-projects-root-display-name"
                value={form.displayName}
                onChange={(event) => patchForm("displayName", event.target.value)}
                data-testid="input-integration-active-projects-root-display-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="integration-active-projects-root-path">SharePoint path</Label>
              <Input
                id="integration-active-projects-root-path"
                value={form.rootPath}
                onChange={(event) => patchForm("rootPath", event.target.value)}
                data-testid="input-integration-active-projects-root-path"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="integration-active-projects-root-drive-id">Graph drive ID</Label>
              <Input
                id="integration-active-projects-root-drive-id"
                value={form.driveId}
                onChange={(event) => patchForm("driveId", event.target.value)}
                placeholder="b!xxxxxx..."
                data-testid="input-integration-active-projects-root-drive-id"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="integration-active-projects-root-item-id">Graph item ID</Label>
              <Input
                id="integration-active-projects-root-item-id"
                value={form.rootItemId}
                onChange={(event) => patchForm("rootItemId", event.target.value)}
                placeholder="01XXXXXXXXXXXXX..."
                data-testid="input-integration-active-projects-root-item-id"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The Engineering and Quality document pages share this root. After saving and testing it,
            use Taxonomy & provisioning to create or verify the per-project folders.
          </p>

          {testResult && <RootTestResultPanel result={testResult} />}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={testRoot.isPending || !form.driveId.trim()}
              data-testid="btn-integration-test-active-projects-root"
            >
              {testRoot.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Test
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={upsertRoot.isPending || (!dirty && configured)}
              data-testid="btn-integration-save-active-projects-root"
            >
              {upsertRoot.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/use-api-mutation";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useProjectFolders, usePublicFolderTaxonomy } from "@/hooks/use-document-management-admin";
import type { ProjectDocumentDomain } from "@shared/project-document-register";

interface GraphItem {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  webUrl?: string;
  lastModifiedDateTime?: string;
}

interface RegisterDocument {
  id: number;
  documentType: string;
  discipline: string | null;
  revision: string | null;
  status: string;
  reviewStatus: string;
  currentRevision: boolean;
  superseded: boolean;
  dueDate: string | null;
  approvedAt: string | null;
  sharepoint: {
    driveId: string | null;
    itemId: string | null;
    webUrl: string | null;
    folderPath: string | null;
    fileName: string | null;
  };
  sync: {
    lastSyncedAt: string | null;
    confidence: string;
  };
  flag: "ok" | "amber" | "red";
  defects: Array<{ code: string; severity: "red" | "amber"; message: string }>;
}

interface RegisterResponse {
  projectId: number;
  domain: ProjectDocumentDomain;
  permissions: {
    canCreate: boolean;
    canLink: boolean;
    canEditMetadata: boolean;
    canSubmitForReview: boolean;
    canApprove: boolean;
    canMarkSuperseded: boolean;
  };
  summary: {
    total: number;
    linked: number;
    approved: number;
    pendingReview: number;
    redDefects: number;
    missingLinks: number;
    lastSyncedAt: string | null;
    syncConfidence: string;
  };
  documents: RegisterDocument[];
}

interface ProjectDocumentRegisterPanelProps {
  projectId: number;
  projectName: string;
  domain: ProjectDocumentDomain;
}

const DOMAIN_LABEL: Record<ProjectDocumentDomain, string> = {
  engineering: "Engineering",
  quality: "Quality",
};

const DEFAULT_TYPE: Record<ProjectDocumentDomain, string> = {
  engineering: "Drawing / SLD",
  quality: "QA Evidence",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Not synced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced";
  return date.toLocaleString();
}

function flagClass(flag: RegisterDocument["flag"]) {
  if (flag === "red") return "border-red-200 bg-red-50 text-red-700";
  if (flag === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function flagLabel(flag: RegisterDocument["flag"]) {
  if (flag === "red") return "Red defect";
  if (flag === "amber") return "Attention";
  return "Ready";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json() as Promise<T>;
}

export function ProjectDocumentRegisterPanel({
  projectId,
  projectName,
  domain,
}: ProjectDocumentRegisterPanelProps) {
  const queryClient = useQueryClient();
  const [parentItemId, setParentItemId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<GraphItem | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [form, setForm] = useState({
    documentType: DEFAULT_TYPE[domain],
    discipline: domain === "engineering" ? "Electrical" : "",
    revision: "",
    dueDate: "",
  });

  const registerQuery = useQuery({
    queryKey: ["project-document-register", projectId, domain],
    queryFn: () =>
      fetchJson<RegisterResponse>(
        `/api/projects/${projectId}/document-register?domain=${domain}`,
      ),
  });

  // Folder-first browsing: pick a provisioned project_folders folder, then
  // browse within it via the canonical folder-keyed endpoints (the cutover
  // off the deprecated project_sharepoint_roots table).
  const foldersQuery = useProjectFolders(projectId);
  const taxonomy = usePublicFolderTaxonomy();

  const folderOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const t of taxonomy.data?.taxonomy ?? []) labels.set(t.internalKey, t.displayName);
    return (foldersQuery.data?.folders ?? [])
      .filter((f) => f.taxonomyKey !== "_project_root_" && !!f.itemId)
      .sort((a, b) => a.taxonomyKey.localeCompare(b.taxonomyKey))
      .map((f) => ({ id: f.id, label: labels.get(f.taxonomyKey) ?? f.taxonomyKey }));
  }, [foldersQuery.data, taxonomy.data]);

  const childrenQuery = useQuery({
    queryKey: [
      "project-document-register",
      projectId,
      "folder",
      selectedFolderId,
      "children",
      parentItemId ?? "__root__",
    ],
    enabled: selectedFolderId != null,
    queryFn: () => {
      const qs = parentItemId ? `?parentItemId=${encodeURIComponent(parentItemId)}` : "";
      return fetchJson<{ items: GraphItem[] }>(
        `/api/projects/${projectId}/folders/${selectedFolderId}/children${qs}`,
      );
    },
  });

  const linkMutation = useApiMutation({
    mutationFn: async () => {
      if (selectedFolderId == null || !selectedFile) throw new Error("Select a SharePoint file first.");
      const res = await apiRequest("POST", `/api/projects/${projectId}/document-register/link`, {
        domain,
        folderId: selectedFolderId,
        itemId: selectedFile.id,
        documentType: form.documentType.trim(),
        discipline: form.discipline.trim() || null,
        revision: form.revision.trim() || null,
        dueDate: form.dueDate.trim() || null,
        requiresPrengSignoff: domain === "engineering" && /preng|sign.?off/i.test(form.documentType),
        closeOutEvidenceRequired: domain === "quality" && /close|ncr|snag/i.test(form.documentType),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-document-register", projectId, domain] });
      setSelectedFile(null);
      setForm({
        documentType: DEFAULT_TYPE[domain],
        discipline: domain === "engineering" ? "Electrical" : "",
        revision: "",
        dueDate: "",
      });
    },
    errorToast: "Could not link document",
  });

  const updateMutation = useApiMutation({
    mutationFn: async (input: { id: number; patch: Record<string, unknown> }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/projects/${projectId}/document-register/${input.id}`,
        input.patch,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-document-register", projectId, domain] });
    },
    errorToast: "Could not update document",
  });

  const response = registerQuery.data;
  const documents = response?.documents ?? [];
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;
  const folders = (childrenQuery.data?.items ?? []).filter((item) => item.isFolder);
  const files = (childrenQuery.data?.items ?? []).filter((item) => !item.isFolder);

  return (
    <div className="space-y-4" data-testid={`project-${domain}-documents`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold">{DOMAIN_LABEL[domain]} Documents</h3>
            <p className="text-xs text-muted-foreground">{projectName}</p>
          </div>
        </div>
        <Badge variant="outline" className={response?.summary.redDefects ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}>
          {response?.summary.redDefects ?? 0} red defects
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-5">
        {[
          ["Total", response?.summary.total ?? 0],
          ["Linked", response?.summary.linked ?? 0],
          ["Approved", response?.summary.approved ?? 0],
          ["Review", response?.summary.pendingReview ?? 0],
          ["Missing links", response?.summary.missingLinks ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border bg-muted/20 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Register
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {registerQuery.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading documents...</div>
            ) : documents.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No linked {domain} documents yet.</div>
            ) : (
              <div className="divide-y">
                {documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => setSelectedDocumentId(document.id)}
                    className="w-full text-left px-4 py-3 hover:bg-muted/40"
                    data-testid={`project-document-row-${domain}-${document.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className={`text-[10px] ${flagClass(document.flag)}`}>
                        {flagLabel(document.flag)}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {document.sharepoint.fileName || document.documentType}
                          </span>
                          {document.revision && (
                            <Badge variant="secondary" className="text-[10px]">
                              Rev {document.revision}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {document.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground truncate">
                          {document.documentType}
                          {document.discipline ? ` · ${document.discipline}` : ""}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileCheck className="h-4 w-4" />
              Detail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedDocument ? (
              <>
                <div>
                  <div className="text-sm font-semibold">
                    {selectedDocument.sharepoint.fileName || selectedDocument.documentType}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last sync: {formatDate(selectedDocument.sync.lastSyncedAt)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Type</span>
                    <div className="font-medium">{selectedDocument.documentType}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Review</span>
                    <div className="font-medium">{selectedDocument.reviewStatus.replace(/_/g, " ")}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Folder</span>
                    <div className="font-mono truncate">{selectedDocument.sharepoint.folderPath || "Missing"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Graph IDs</span>
                    <div className="font-medium">
                      {selectedDocument.sharepoint.driveId && selectedDocument.sharepoint.itemId ? "Present" : "Missing"}
                    </div>
                  </div>
                </div>

                {selectedDocument.defects.length > 0 && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3">
                    <div className="text-xs font-semibold text-red-800 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Red defects
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-red-700">
                      {selectedDocument.defects.map((defect) => (
                        <li key={defect.code}>{defect.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {selectedDocument.sharepoint.webUrl && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={selectedDocument.sharepoint.webUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        Open
                      </a>
                    </Button>
                  )}
                  {response?.permissions.canSubmitForReview && selectedDocument.reviewStatus === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateMutation.mutate({
                          id: selectedDocument.id,
                          patch: { status: "submitted_for_review", reviewStatus: "submitted_for_review" },
                        })
                      }
                    >
                      Submit
                    </Button>
                  )}
                  {response?.permissions.canApprove && selectedDocument.reviewStatus !== "approved" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          id: selectedDocument.id,
                          patch: { status: "approved", reviewStatus: "approved" },
                        })
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                  )}
                  {response?.permissions.canMarkSuperseded && !selectedDocument.superseded && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateMutation.mutate({
                          id: selectedDocument.id,
                          patch: { status: "superseded", superseded: true, currentRevision: false },
                        })
                      }
                    >
                      Supersede
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Select a linked document to review it.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4" />
            SharePoint folders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {foldersQuery.isLoading ? (
            <div className="p-3 text-sm text-muted-foreground">Loading project folders…</div>
          ) : folderOptions.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              No provisioned folders for this project yet.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value={selectedFolderId != null ? String(selectedFolderId) : ""}
                  onValueChange={(v) => {
                    setSelectedFolderId(Number(v));
                    setParentItemId(null);
                    setSelectedFile(null);
                  }}
                >
                  <SelectTrigger className="h-8 w-[16rem]" data-testid={`project-${domain}-folder-select`}>
                    <SelectValue placeholder="Choose a folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {folderOptions.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedFolderId != null && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => setParentItemId(null)}>
                    Folder root
                  </Button>
                )}
              </div>

              {selectedFolderId == null ? (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  Pick a folder above to browse its files.
                </div>
              ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="rounded-md border divide-y max-h-80 overflow-auto">
                  {childrenQuery.isLoading ? (
                    <div className="p-3 text-sm text-muted-foreground">Loading SharePoint folder...</div>
                  ) : folders.length === 0 && files.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No files found in this folder.</div>
                  ) : (
                    <>
                      {folders.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => {
                            setParentItemId(folder.id);
                            setSelectedFile(null);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-muted/40 flex items-center gap-2"
                        >
                          <Folder className="h-4 w-4 text-amber-600" />
                          <span className="text-sm truncate">{folder.name}</span>
                        </button>
                      ))}
                      {files.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => setSelectedFile(file)}
                          className={`w-full px-3 py-2 text-left hover:bg-muted/40 flex items-center gap-2 ${
                            selectedFile?.id === file.id ? "bg-primary/5" : ""
                          }`}
                        >
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm truncate">{file.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>

                <div className="rounded-md border p-3 space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Selected file</div>
                    <div className="text-sm font-medium truncate">
                      {selectedFile?.name ?? "No file selected"}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Document type</Label>
                      <Input
                        value={form.documentType}
                        onChange={(event) => setForm((prev) => ({ ...prev, documentType: event.target.value }))}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Discipline</Label>
                      <Input
                        value={form.discipline}
                        onChange={(event) => setForm((prev) => ({ ...prev, discipline: event.target.value }))}
                        className="h-8"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Revision</Label>
                        <Input
                          value={form.revision}
                          onChange={(event) => setForm((prev) => ({ ...prev, revision: event.target.value }))}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Due date</Label>
                        <Input
                          type="date"
                          value={form.dueDate}
                          onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!selectedFile || !response?.permissions.canLink || linkMutation.isPending}
                    onClick={() => linkMutation.mutate()}
                  >
                    {linkMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Link file
                  </Button>
                </div>
              </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSubmitDocument } from "@/hooks/use-controlled-documents";
import { toast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api-error";
import { getQueryFn } from "@/lib/queryClient";
import { Loader2, Send, FileText } from "lucide-react";
import type { ControlledDocumentType } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  documentType: ControlledDocumentType;
  /** Optional: pre-fill sharepointPath if user clicked a file in a drafts picker. */
  draftFile?: { fileName: string; sharepointPath: string; sharepointDriveId?: string; sharepointItemId?: string; fileSizeBytes?: number };
  onSubmitted?: () => void;
}

interface AssignableUser {
  id: number;
  name: string;
  username?: string;
  role: string;
  email?: string;
}

const SUPER_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN"]);

/**
 * Submit a draft file for approval. One approver dropdown per required
 * role slot on the document type. Each dropdown is filtered to users who
 * hold that role — super-users (COO/CEO) are always included as
 * fallback approvers.
 */
export function DocumentSubmitDialog({
  open, onOpenChange, projectId, documentType, draftFile, onSubmitted,
}: Props) {
  const requiredRoles = (documentType.defaultApproverRoles ?? []) as string[];
  const submitMut = useSubmitDocument(projectId);

  const [fileName, setFileName] = useState(draftFile?.fileName ?? "");
  const [sharepointPath, setSharepointPath] = useState(draftFile?.sharepointPath ?? "");
  const [comment, setComment] = useState("");
  const [approverIds, setApproverIds] = useState<Array<number | null>>(() => requiredRoles.map(() => null));

  useEffect(() => {
    if (draftFile) {
      setFileName(draftFile.fileName);
      setSharepointPath(draftFile.sharepointPath);
    }
  }, [draftFile]);

  useEffect(() => {
    setApproverIds(requiredRoles.map(() => null));
  }, [requiredRoles.join("|")]);

  // Fetch all assignable users; filter per role slot.
  const usersQuery = useQuery<AssignableUser[]>({
    queryKey: ["/api/users/assignable"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: open,
  });
  const allUsers = usersQuery.data ?? [];

  const candidatesForRole = useMemo(() => {
    const map = new Map<string, AssignableUser[]>();
    for (const role of requiredRoles) {
      const list = allUsers.filter(
        (u) => u.role === role || SUPER_ROLES.has(u.role),
      );
      // Sort: exact-role matches first, super-users second
      list.sort((a, b) => {
        const aExact = a.role === role ? 0 : 1;
        const bExact = b.role === role ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return (a.name || "").localeCompare(b.name || "");
      });
      map.set(role, list);
    }
    return map;
  }, [allUsers, requiredRoles.join("|")]);

  const canSubmit = !!fileName.trim() && !!sharepointPath.trim() && approverIds.every((id) => id !== null);
  const busy = submitMut.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await submitMut.mutateAsync({
        typeKey: documentType.typeKey,
        fileName: fileName.trim(),
        sharepointPath: sharepointPath.trim(),
        sharepointDriveId: draftFile?.sharepointDriveId,
        sharepointItemId: draftFile?.sharepointItemId,
        fileSizeBytes: draftFile?.fileSizeBytes,
        submitComment: comment.trim() || undefined,
        approverUserIds: approverIds.filter((id): id is number => id !== null),
      });
      toast({ title: "Submitted for approval", description: `${documentType.displayName} submitted.` });
      setComment("");
      onOpenChange(false);
      onSubmitted?.();
    } catch (err) {
      toast({
        title: "Submit failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="document-submit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Submit for approval
          </DialogTitle>
          <DialogDescription>
            {documentType.displayName}
            {documentType.description && (
              <span className="block text-xs mt-1 text-muted-foreground">{documentType.description}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="file-name" className="text-xs">File name</Label>
            <Input
              id="file-name"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="e.g. Costing_v4_Final.xlsx"
              data-testid="input-file-name"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sharepoint-path" className="text-xs">SharePoint path</Label>
            <Input
              id="sharepoint-path"
              value={sharepointPath}
              onChange={(e) => setSharepointPath(e.target.value)}
              placeholder="e.g. Projects/ABC/BD/Cost Proposal/Costing/Drafts/Costing_v4.xlsx"
              data-testid="input-sharepoint-path"
            />
            <p className="text-[11px] text-muted-foreground">
              On approval the file will be moved from Drafts into Approved. Any current Approved file is moved to History.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="submit-comment" className="text-xs">Comment (optional)</Label>
            <Textarea
              id="submit-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="e.g. Final after client negotiation"
              data-testid="input-submit-comment"
            />
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-medium text-foreground flex items-center gap-2">
              Approvers
              {documentType.requiresAllApprovers ? (
                <Badge variant="outline" className="text-[10px]">All required</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Any one</Badge>
              )}
            </div>
            {requiredRoles.map((role, idx) => {
              const candidates = candidatesForRole.get(role) ?? [];
              return (
                <div key={`${role}-${idx}`} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{role}</Label>
                  <Select
                    value={approverIds[idx] != null ? String(approverIds[idx]) : undefined}
                    onValueChange={(v) => {
                      setApproverIds((prev) => {
                        const next = [...prev];
                        next[idx] = Number(v);
                        return next;
                      });
                    }}
                  >
                    <SelectTrigger data-testid={`select-approver-${idx}`}>
                      <SelectValue placeholder={`Pick ${role} approver`} />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No users with approval authority for this role.
                        </div>
                      ) : (
                        candidates.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name}
                            <span className="text-muted-foreground ml-2 text-[10px]">
                              ({u.role}{SUPER_ROLES.has(u.role) && u.role !== role ? " — super-user" : ""})
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || busy} data-testid="btn-confirm-submit">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

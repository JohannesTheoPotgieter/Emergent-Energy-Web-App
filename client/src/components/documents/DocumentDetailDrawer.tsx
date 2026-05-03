import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Lock, ExternalLink, CheckCircle2, X, Upload } from "lucide-react";
import {
  useDocumentDetail,
  useDocumentRevisions,
  useDocumentComments,
  useCheckout,
  useDiscardCheckout,
  useCreateComment,
} from "./use-documents";
import { CheckinDialog } from "./CheckinDialog";
import type { DocumentRootScope, GraphItem } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: DocumentRootScope;
  rootId: number;
  itemId: string | null;
  onRename: (item: GraphItem) => void;
}

export function DocumentDetailDrawer({ open, onOpenChange, scope, rootId, itemId, onRename }: Props) {
  const detail = useDocumentDetail(scope, rootId, itemId);
  const documentId = detail.data?.managedDocument?.id ?? null;
  const revisions = useDocumentRevisions(documentId);
  const comments = useDocumentComments(documentId);
  const checkout = useCheckout();
  const discard = useDiscardCheckout();
  const createComment = useCreateComment();
  const [commentBody, setCommentBody] = useState("");
  const [checkinOpen, setCheckinOpen] = useState(false);

  const item = detail.data?.item ?? null;
  const lock = detail.data?.lock ?? null;

  async function submitComment() {
    if (!documentId || !commentBody.trim()) return;
    await createComment.mutateAsync({ documentId, body: commentBody.trim() });
    setCommentBody("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="documents-detail-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-start gap-2">
            <span className="text-base">{item?.name ?? "Document"}</span>
            {lock && (
              <Badge variant="outline" className="text-[10px]">
                <Lock className="h-3 w-3 mr-1" />
                Checked out
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>
        {!item && <p className="text-sm text-muted-foreground py-6">Loading…</p>}
        {item && (
          <>
            <div className="flex flex-wrap gap-2 mt-3">
              {item.webUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={item.webUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Open in SharePoint
                  </a>
                </Button>
              )}
              {!item.isFolder && documentId && !lock && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => checkout.mutate(documentId)}
                  disabled={checkout.isPending}
                  data-testid="documents-checkout-button"
                >
                  <Lock className="h-3.5 w-3.5 mr-1" />
                  Check out
                </Button>
              )}
              {!item.isFolder && documentId && lock && (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setCheckinOpen(true)}
                    data-testid="documents-checkin-open"
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" />
                    Check in
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => discard.mutate(documentId)}
                    disabled={discard.isPending}
                    data-testid="documents-discard-button"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Discard checkout
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRename(item)}
                data-testid="documents-rename-button"
              >
                Rename
              </Button>
            </div>

            <Tabs defaultValue="info" className="mt-4">
              <TabsList>
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="revisions">Revisions</TabsTrigger>
                <TabsTrigger value="comments">Comments</TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="mt-3 space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Path</span>
                  <p className="break-all">{item.path}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Modified</span>
                  <p>{item.lastModifiedDateTime ?? "—"} · {item.lastModifiedBy?.displayName ?? ""}</p>
                </div>
                {detail.data?.managedDocument && (
                  <div>
                    <span className="text-muted-foreground text-xs">State</span>
                    <p>
                      <Badge variant="secondary" className="mt-1">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {detail.data.managedDocument.state}
                      </Badge>
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="revisions" className="mt-3">
                {!documentId && (
                  <p className="text-xs text-muted-foreground">Revisions are tracked after the first upload.</p>
                )}
                {documentId && (
                  <ul className="space-y-2 text-sm" data-testid="documents-revisions-list">
                    {(revisions.data?.revisions ?? []).map((r) => (
                      <li key={r.id} className="border rounded-md p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">Revision {r.revisionNumber}</span>
                          {r.isCurrent && <Badge variant="secondary">Current</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.uploadedAt).toLocaleString()} · {r.sizeBytes ?? "—"} bytes
                        </p>
                        {r.notes && <p className="text-xs mt-1">{r.notes}</p>}
                      </li>
                    ))}
                    {revisions.data?.revisions.length === 0 && (
                      <li className="text-xs text-muted-foreground">No revisions yet.</li>
                    )}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="comments" className="mt-3 space-y-3">
                {!documentId && (
                  <p className="text-xs text-muted-foreground">Comments are available once the file is tracked.</p>
                )}
                {documentId && (
                  <>
                    <ul className="space-y-2 text-sm" data-testid="documents-comments-list">
                      {(comments.data?.comments ?? []).map((c) => (
                        <li key={c.id} className="border rounded-md p-2">
                          <p className="text-xs text-muted-foreground">
                            {new Date(c.createdAt).toLocaleString()}
                          </p>
                          <p className="whitespace-pre-wrap text-sm mt-1">{c.body}</p>
                        </li>
                      ))}
                      {comments.data?.comments.length === 0 && (
                        <li className="text-xs text-muted-foreground">No comments yet.</li>
                      )}
                    </ul>
                    <div className="space-y-2">
                      <Textarea
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        placeholder="Add a comment. Mention people with @username."
                        rows={3}
                        data-testid="documents-comment-input"
                      />
                      <Button
                        size="sm"
                        disabled={!commentBody.trim() || createComment.isPending}
                        onClick={submitComment}
                        data-testid="documents-comment-submit"
                      >
                        {createComment.isPending ? "Posting…" : "Post comment"}
                      </Button>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>

            <CheckinDialog open={checkinOpen} onOpenChange={setCheckinOpen} documentId={documentId} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

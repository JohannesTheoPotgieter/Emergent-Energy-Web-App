import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUploadDocument } from "./use-documents";
import { SharePointErrorAlert } from "./SharePointErrorAlert";
import type { DocumentRootScope } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: DocumentRootScope;
  rootId: number;
  parentItemId: string | null;
}

export function UploadDialog({ open, onOpenChange, scope, rootId, parentItemId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploader = useUploadDocument();

  async function submit() {
    if (!file) return;
    setError(null);
    try {
      await uploader.mutateAsync({ scope, rootId, parentItemId, file });
      onOpenChange(false);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="documents-upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload file</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            ref={fileRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="documents-upload-input"
          />
          <p className="text-xs text-muted-foreground">Files up to 4 MiB. Larger files will be added in a later update.</p>
          <SharePointErrorAlert error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!file || uploader.isPending} data-testid="documents-upload-submit">
            {uploader.isPending ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

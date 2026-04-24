import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateFolder } from "./use-documents";
import type { DocumentRootScope } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: DocumentRootScope;
  rootId: number;
  parentItemId: string | null;
}

export function NewFolderDialog({ open, onOpenChange, scope, rootId, parentItemId }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createFolder = useCreateFolder();

  async function submit() {
    setError(null);
    try {
      await createFolder.mutateAsync({ scope, rootId, parentItemId, name: name.trim() });
      onOpenChange(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create folder");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="documents-new-folder-dialog">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-folder-name">Name</Label>
          <Input
            id="new-folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={200}
            data-testid="documents-new-folder-name"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || createFolder.isPending}
            data-testid="documents-new-folder-submit"
          >
            {createFolder.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRenameItem, type BrowseTarget } from "./use-documents";
import { SharePointErrorAlert } from "./SharePointErrorAlert";
import type { GraphItem } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: BrowseTarget;
  item: GraphItem | null;
}

export function RenameDialog({ open, onOpenChange, target, item }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const rename = useRenameItem();

  useEffect(() => {
    if (open && item) setName(item.name);
  }, [open, item]);

  async function submit() {
    if (!item) return;
    setError(null);
    try {
      await rename.mutateAsync({ target, itemId: item.id, name: name.trim() });
      onOpenChange(false);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="documents-rename-dialog">
        <DialogHeader>
          <DialogTitle>Rename {item?.isFolder ? "folder" : "file"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-name">New name</Label>
          <Input
            id="rename-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={200}
            data-testid="documents-rename-input"
          />
          <SharePointErrorAlert error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || rename.isPending}
            data-testid="documents-rename-submit"
          >
            {rename.isPending ? "Renaming…" : "Rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

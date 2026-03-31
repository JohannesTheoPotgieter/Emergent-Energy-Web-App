import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Loader2, Bold, Italic, List, ListOrdered, Minus } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

interface LatestUpdateEditorProps {
  projectName: string;
  displayName?: string;
  latestUpdate: string | null;
  latestUpdateBy: string | null;
  latestUpdateAt: string | null;
  onSave: (value: string | null) => Promise<void>;
  testIdSuffix?: string;
}

export function LatestUpdateCell({ projectName, displayName, latestUpdate, latestUpdateBy, latestUpdateAt }: {
  projectName: string;
  displayName?: string;
  latestUpdate: string | null;
  latestUpdateBy: string | null;
  latestUpdateAt: string | null;
}) {
  const metaLine = [
    latestUpdateBy,
    latestUpdateAt ? formatRelativeTime(latestUpdateAt) : null,
  ].filter(Boolean).join(", ");

  return (
    <>
      {latestUpdate ? (
        <>
          <p className="text-[10px] text-foreground leading-snug line-clamp-2 whitespace-pre-line">
            {latestUpdate}
          </p>
          {metaLine && (
            <p className="text-[9px] text-muted-foreground mt-0.5">{metaLine}</p>
          )}
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground italic">No update</span>
      )}
      <Pencil className="inline-block ml-1 h-2.5 w-2.5 opacity-0 group-hover:opacity-60 text-muted-foreground" />
    </>
  );
}

export default function LatestUpdateEditor({
  projectName,
  displayName,
  latestUpdate,
  latestUpdateBy,
  latestUpdateAt,
  onSave,
  testIdSuffix,
}: LatestUpdateEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [value, setValue] = useState(latestUpdate || "");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(latestUpdate || "");
  }, [latestUpdate]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(200, Math.min(el.scrollHeight, 500)) + "px";
  }, []);

  useEffect(() => {
    if (dialogOpen) {
      setTimeout(() => {
        autoResize();
        textareaRef.current?.focus();
        const len = textareaRef.current?.value.length || 0;
        textareaRef.current?.setSelectionRange(len, len);
      }, 50);
    }
  }, [dialogOpen, autoResize]);

  const insertFormatting = (prefix: string, suffix: string = "") => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.substring(start, end);
    const before = value.substring(0, start);
    const after = value.substring(end);
    const newText = before + prefix + selected + suffix + after;
    setValue(newText);
    setTimeout(() => {
      el.focus();
      const newPos = start + prefix.length + selected.length + suffix.length;
      el.setSelectionRange(
        selected.length > 0 ? start + prefix.length : newPos,
        selected.length > 0 ? start + prefix.length + selected.length : newPos
      );
      autoResize();
    }, 0);
  };

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed === (latestUpdate || "")) { setDialogOpen(false); return; }
    setSaving(true);
    try {
      await onSave(trimmed || null);
    } catch {
    }
    setSaving(false);
    setDialogOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  const metaLine = [
    latestUpdateBy,
    latestUpdateAt ? formatRelativeTime(latestUpdateAt) : null,
  ].filter(Boolean).join(", ");

  const label = displayName || projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");
  const charCount = value.length;

  return (
    <>
      <div
        className="cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 group min-w-0"
        onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
        data-interactive="true"
        data-testid={testIdSuffix ? `text-latest-update-${testIdSuffix}` : undefined}
      >
        <LatestUpdateCell
          projectName={projectName}
          displayName={displayName}
          latestUpdate={latestUpdate}
          latestUpdateBy={latestUpdateBy}
          latestUpdateAt={latestUpdateAt}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setValue(latestUpdate || ""); setDialogOpen(false); } }}>
        <DialogContent className="max-w-2xl" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-4 w-4" />
              Update Status — {label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <div className="flex items-center gap-0.5 border-b pb-1.5">
              <Toggle
                size="sm"
                aria-label="Bold"
                className="h-7 w-7 p-0"
                onPressedChange={() => insertFormatting("**", "**")}
                data-testid="btn-format-bold"
              >
                <Bold className="h-3.5 w-3.5" />
              </Toggle>
              <Toggle
                size="sm"
                aria-label="Italic"
                className="h-7 w-7 p-0"
                onPressedChange={() => insertFormatting("_", "_")}
                data-testid="btn-format-italic"
              >
                <Italic className="h-3.5 w-3.5" />
              </Toggle>
              <div className="w-px h-4 bg-border mx-1" />
              <Toggle
                size="sm"
                aria-label="Bullet list"
                className="h-7 w-7 p-0"
                onPressedChange={() => insertFormatting("• ")}
                data-testid="btn-format-bullet"
              >
                <List className="h-3.5 w-3.5" />
              </Toggle>
              <Toggle
                size="sm"
                aria-label="Numbered list"
                className="h-7 w-7 p-0"
                onPressedChange={() => insertFormatting("1. ")}
                data-testid="btn-format-number"
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </Toggle>
              <Toggle
                size="sm"
                aria-label="Separator"
                className="h-7 w-7 p-0"
                onPressedChange={() => insertFormatting("\n───\n")}
                data-testid="btn-format-separator"
              >
                <Minus className="h-3.5 w-3.5" />
              </Toggle>
            </div>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); autoResize(); }}
              onKeyDown={handleKeyDown}
              placeholder="Write a status update for this project...&#10;&#10;Tip: Use bullet points (•) to structure your update. Press Ctrl+Enter to save."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed shadow-none transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-y whitespace-pre-wrap break-words"
              style={{ minHeight: "200px", maxHeight: "500px" }}
              data-testid={testIdSuffix ? `input-latest-update-${testIdSuffix}` : undefined}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>
                {metaLine && <span>Last updated: {metaLine}</span>}
              </div>
              <span>{charCount} character{charCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <span className="text-[10px] text-muted-foreground mr-auto hidden sm:inline">Ctrl+Enter to save</span>
            <Button variant="outline" onClick={() => { setValue(latestUpdate || ""); setDialogOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} data-testid={testIdSuffix ? `button-save-update-${testIdSuffix}` : undefined}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

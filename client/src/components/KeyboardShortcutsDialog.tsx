import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";
import { getKeyboardShortcutList } from "@/hooks/use-keyboard-nav";

/**
 * Keyboard shortcuts help dialog. Opened via "?" key (dispatched by
 * useKeyboardNav).
 */
export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handle = () => setOpen(true);
    window.addEventListener("open-keyboard-help", handle as EventListener);
    return () => window.removeEventListener("open-keyboard-help", handle as EventListener);
  }, []);

  const shortcuts = getKeyboardShortcutList();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="keyboard-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Press the leader key <Kbd>g</Kbd> then a letter to jump. Press <Kbd>⌘K</Kbd> to search anything. Press <Kbd>?</Kbd> to open this dialog.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Navigation</p>
            <ul className="space-y-1">
              {shortcuts.map(({ keys, label }) => (
                <li key={keys} className="flex items-center justify-between text-sm py-1">
                  <span>{label}</span>
                  <KeyCombo combo={keys} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Global</p>
            <ul className="space-y-1">
              <li className="flex items-center justify-between text-sm py-1">
                <span>Open command palette / search</span>
                <KeyCombo combo="⌘K" />
              </li>
              <li className="flex items-center justify-between text-sm py-1">
                <span>Close dialogs / lose focus</span>
                <KeyCombo combo="Esc" />
              </li>
              <li className="flex items-center justify-between text-sm py-1">
                <span>Show this help</span>
                <KeyCombo combo="?" />
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeyCombo({ combo }: { combo: string }) {
  const parts = combo.split(" ");
  return (
    <span className="flex items-center gap-1">
      {parts.map((p, i) => (
        <Kbd key={i}>{p}</Kbd>
      ))}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/70 text-[11px] font-mono font-medium">
      {children}
    </kbd>
  );
}
